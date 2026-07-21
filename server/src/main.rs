//! Authoritative deathmatch server (Phase 6.3 — one human).
//!
//! A single 64 Hz game-loop task owns the native `sim` world and the slot
//! table. Each WebSocket connection runs two tasks (read → decode CommandFrame
//! → game loop; game loop → outbound queue → write). The loop consumes one
//! command per slot per tick, applies the SAME movement tick the client
//! predicts with (WASM-share), and broadcasts a full Snapshot every tick.
//!
//! See docs/netcode.md §6. Delta snapshots / remote-entity interpolation /
//! bots / lag comp arrive in 6.4–6.6.

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU8, Ordering};

use futures_util::{SinkExt, StreamExt};
use sim::constants::FIXED_DT;
use sim::map;
use sim::movement::{tick_movement, PlayerState};
use sim::protocol::{
    CommandFrame, EntityState, GameEvent, Join, RoundState, Shot, Snapshot, Welcome, EV_KILL,
    F_ALIVE, F_DUCKED, F_TEAM_CT, SPECTATOR,
};
use sim::world::SimWorld;
use sim::{ColliderHandle, RigidBodyHandle};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{accept_hdr_async, tungstenite::Message};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};

mod ai;
mod game;

// Bot patrol waypoints (de_douglas map, same as TS botDefs patrol routes).
// Each bot is assigned one waypoint set.
static PATROL_CT: &[(f64, f64, f64)] = &[
    (-16.0, 0.05, 14.0), (-12.0, 0.05, 4.0), (-16.0, 0.05, 24.0),
];
static PATROL_T: &[(f64, f64, f64)] = &[
    (-16.0, 0.05, -14.0), (-12.0, 0.05, -4.0), (-16.0, 0.05, -24.0),
];

#[derive(Clone, Copy)]
struct BotSpawn {
    feet: [f64; 3],
    waypoints: &'static [(f64, f64, f64)],
}

const DEFAULT_BIND: &str = "127.0.0.1:9876";
const MAX_SLOTS: usize = 10;
const MAX_SPECTATORS: usize = 7; // ceil(2/3 * MAX_SLOTS) = ceil(6.666) = 7
const SEED: u32 = 1;
const MAP_JSON: &str = include_str!("../../assets/maps/de_douglas.json");

/// Phase 9 advisory capacity counters for the GET /status HTTP endpoint (Gate 1).
/// Updated by the game loop; read by handle_conn before the WebSocket handshake.
static ACTIVE_HUMANS: AtomicU8 = AtomicU8::new(0);
static SPECTATOR_COUNT: AtomicU8 = AtomicU8::new(0);

type Out = mpsc::UnboundedSender<Vec<u8>>;

/// Messages from connection tasks into the single game loop.
enum Ev {
    /// New WebSocket connection: register it, get back a conn_id.
    Connect {
        out: Out,
        slot_tx: oneshot::Sender<u8>, // assigned slot after JoinTeam, or SPECTATOR
        reply: oneshot::Sender<Option<u32>>, // Some(conn_id), or None if refused (full)
    },
    /// Client sent a Join message with their team choice.
    JoinTeam {
        conn_id: u32,
        team: u8, // 0=T, 1=CT, 2=SPEC
    },
    /// Per-tick command from an assigned player.
    Cmd {
        slot: u8,
        frame: CommandFrame,
    },
    /// A player left; free their slot back to a bot.
    Leave {
        slot: u8,
    },
    /// A pending connection dropped before sending Join.
    PendingDrop {
        conn_id: u32,
    },
    /// A spectator disconnected.
    SpecDrop {
        conn_id: u32,
    },
}

struct Slot {
    occupied: bool,
    is_human: bool,
    out: Option<Out>,
    /// Phase 9: a human waiting to spawn on the next Reset (bot still plays the slot).
    pending_human: Option<Out>,
    body_handle: RigidBodyHandle,
    collider_handle: ColliderHandle,
    player: PlayerState,
    bot: Option<ai::Bot>,
    bot_spawn: BotSpawn,
    queue: VecDeque<CommandFrame>,
    last_buttons: u16,
    last_yaw: f32,
    last_pitch: f32,
    last_shot: Option<Shot>,
    ack_seq: u32,
    team_ct: bool,
    alive: bool,
    health: u8,
    armor: u8,
    weapon: u8,
    ammo: u8,
}

async fn game_loop(mut events: mpsc::UnboundedReceiver<Ev>) {
    let mut world = SimWorld::new();
    let spawn = map::load(&mut world, MAP_JSON);
    world.ensure_broad_phase_ready();

    let mut slots: Vec<Slot> = (0..MAX_SLOTS)
        .map(|i| {
            let team_ct = i % 2 == 1;
            let s = if team_ct { spawn.ct } else { spawn.t };
            let (body_handle, collider_handle) = if i == 0 {
                (
                    world.player_rigid_body_handle(0),
                    world.player_collider_handle(0),
                )
            } else {
                world.add_player_body()
            };
            world.sync_player_body(body_handle, collider_handle, s[0], s[1], s[2], false);

            let waypoints: &'static [(f64, f64, f64)] = if team_ct {
                PATROL_CT
            } else {
                PATROL_T
            };
            let bot = Some(ai::Bot::new(waypoints));

            Slot {
                occupied: true,       // filled by bot
                is_human: false,
                out: None,
                pending_human: None,
                body_handle,
                collider_handle,
                player: PlayerState::new(s[0], s[1], s[2]),
                bot,
                bot_spawn: BotSpawn { feet: s, waypoints },
                queue: VecDeque::new(),
                last_buttons: 0,
                last_yaw: 0.0,
                last_pitch: 0.0,
                last_shot: None,
                ack_seq: 0,
                team_ct,
                alive: true,
                health: 100,
                armor: 0,
                weapon: 1,
                ammo: 30,
            }
        })
        .collect();

    // Phase 9: spectators and connections waiting for a team choice.
    let mut spectators: Vec<(u32, Out)> = Vec::new();
    // Keyed by conn_id so entries are freed on Join/drop (no unbounded growth,
    // no wraparound aliasing). conn_id is a monotonic u32 — a distinct sentinel
    // (None on the reply channel) signals "refused", so ids never collide with it.
    let mut pending_conns: std::collections::HashMap<u32, (Out, oneshot::Sender<u8>)> =
        std::collections::HashMap::new();
    let mut next_conn_id: u32 = 0;

    let mut server_tick: u32 = 0;
    let mut interval = tokio::time::interval(std::time::Duration::from_secs_f64(FIXED_DT));
    let mut round = game::State::new();

    loop {
        tokio::select! {
            _ = interval.tick() => {
                server_tick = server_tick.wrapping_add(1);

                // Count alive per team for the round FSM (post-combat from previous tick).
                let mut t_alive = 0usize;
                let mut ct_alive = 0usize;
                for s in &slots {
                    if s.occupied && s.alive {
                        if s.team_ct { ct_alive += 1; } else { t_alive += 1; }
                    }
                }

                let round_ev = game::tick(&mut round, t_alive, ct_alive);
                let is_live = round.phase == game::Phase::Live;

                if round_ev == game::RoundEvent::Reset {
                    for s in &mut slots {
                        if !s.occupied { continue; }
                        // Phase 9: promote pending humans at round start.
                        if s.pending_human.is_some() {
                            s.is_human = true;
                            ACTIVE_HUMANS.fetch_add(1, Ordering::Relaxed);
                            s.out = s.pending_human.take();
                            s.bot = None;
                        }
                        let bf = s.bot_spawn.feet;
                        s.player.reset(bf[0], bf[1], bf[2]);
                        s.alive = true;
                        s.health = 100;
                        s.armor = 0;
                        s.weapon = 1;
                        s.ammo = 30;
                        s.queue.clear();
                        s.last_buttons = 0;
                        s.last_shot = None;
                        s.ack_seq = 0;
                        world.sync_player_body(
                            s.body_handle, s.collider_handle,
                            bf[0], bf[1], bf[2], false,
                        );
                    }
                    println!("round {} begin", round.round_number);
                }

                // Build arrays of positions and alive flags so bots can perceive each other.
                let positions: Vec<Option<nalgebra::Vector3<f64>>> = slots
                    .iter()
                    .map(|s| if s.occupied { Some(s.player.position) } else { None })
                    .collect();
                let alive: Vec<bool> = slots.iter().map(|s| s.alive).collect();

                for (_idx, slot) in slots.iter_mut().enumerate() {
                    if !slot.occupied { continue; }

                    if !slot.alive {
                        // Consume queued human commands to keep ack_seq advancing.
                        if slot.is_human {
                            while slot.queue.len() > 1 { slot.queue.pop_front(); }
                            if let Some(cmd) = slot.queue.pop_front() {
                                slot.ack_seq = cmd.seq;
                            }
                        }
                        continue;
                    }

                    // Human inputs: consume even during freeze to advance ack_seq.
                    if slot.is_human {
                        if let Some(cmd) = slot.queue.pop_front() {
                            slot.last_buttons = if is_live { cmd.buttons } else { 0 };
                            slot.last_yaw = cmd.yaw;
                            slot.last_pitch = cmd.pitch;
                            slot.last_shot = if is_live { cmd.shot } else { None };
                            slot.ack_seq = cmd.seq;
                        } else {
                            slot.last_shot = None;
                        }
                    } else if let Some(ref mut bot) = slot.bot {
                        if is_live {
                            let (buttons, yaw) = ai::tick_bot(
                                bot,
                                &world,
                                &slot.player.position,
                                slot.collider_handle,
                                &positions,
                                &alive,
                            );
                            slot.last_buttons = buttons;
                            slot.last_yaw = yaw as f32;
                            slot.last_pitch = 0.0;
                        }
                    }

                    // Only tick movement during Live phase.
                    if is_live {
                        world.sync_player_body(
                            slot.body_handle,
                            slot.collider_handle,
                            slot.player.position.x,
                            slot.player.position.y,
                            slot.player.position.z,
                            slot.player.ducked,
                        );
                        tick_movement(
                            &mut world,
                            &mut slot.player,
                            slot.last_buttons,
                            slot.last_yaw as f64,
                            FIXED_DT,
                            Some(slot.collider_handle),
                        );
                    }
                }

                // Shot resolution (6.6): raycast from eyePos along dir against all
                // other slots' colliders. Collect shots first, then apply damage
                // in a separate pass to avoid aliasing slots.
                let mut frame_events: Vec<GameEvent> = Vec::new();

                // Collect shooters: (shooter_idx, shot) for all alive slots with shots.
                let mut shooters: Vec<(usize, Shot)> = Vec::new();
                for (shooter_idx, s) in slots.iter().enumerate() {
                    if !s.alive {
                        continue;
                    }
                    let Some(ref shot) = s.last_shot else { continue };
                    let pe = &s.player.position;
                    if (shot.eye_pos[0] as f64 - pe.x).abs() > 5.0
                        || (shot.eye_pos[1] as f64 - pe.y - sim::constants::EYE_HEIGHT_STANDING)
                            .abs()
                            > 5.0
                        || (shot.eye_pos[2] as f64 - pe.z).abs() > 5.0
                    {
                        continue;
                    }
                    shooters.push((shooter_idx, *shot));
                }

                for (shooter_idx, shot) in shooters {
                    // Consume the shot (clear it).
                    if let Some(slot) = slots.get_mut(shooter_idx) {
                        slot.last_shot = None;
                    }

                    let eye_x = shot.eye_pos[0] as f64;
                    let eye_y = shot.eye_pos[1] as f64;
                    let eye_z = shot.eye_pos[2] as f64;
                    let dir_x = shot.dir[0] as f64;
                    let dir_y = shot.dir[1] as f64;
                    let dir_z = shot.dir[2] as f64;

                    let shooter_coll = slots[shooter_idx].collider_handle;
                    let mut hit_normal = nalgebra::Vector3::zeros();
                    let hit = sim::shapecast::ray_cast(
                        &world.physics,
                        eye_x, eye_y, eye_z,
                        dir_x, dir_y, dir_z,
                        100.0,
                        &mut hit_normal,
                        Some(shooter_coll),
                    );

                    if let Some(dist) = hit {
                        let hit_x = eye_x + dir_x * dist;
                        let hit_y = eye_y + dir_y * dist;
                        let hit_z = eye_z + dir_z * dist;
                        let mut best_slot: Option<usize> = None;
                        let mut best_dist_sq = f64::MAX;
                        for (ts, ts_slot) in slots.iter().enumerate() {
                            if ts == shooter_idx || !ts_slot.occupied || !ts_slot.alive {
                                continue;
                            }
                            let tp = &ts_slot.player.position;
                            let dx = hit_x - tp.x;
                            let dy = hit_y - tp.y;
                            let dz = hit_z - tp.z;
                            let dsq = dx * dx + dy * dy + dz * dz;
                            if dsq < best_dist_sq {
                                best_dist_sq = dsq;
                                best_slot = Some(ts);
                            }
                        }
                        if let Some(ts) = best_slot {
                            if best_dist_sq < 2.25 {
                                let target = &mut slots[ts];
                                let dmg = 30u8.min(target.health);
                                target.health -= dmg;
                                if target.health == 0 {
                                    target.alive = false;
                                    let bf = target.bot_spawn.feet;
                                    target.player.reset(bf[0], bf[1], bf[2]);
                                    frame_events.push(GameEvent {
                                        tag: EV_KILL,
                                        slot: ts as u8,
                                        by: shooter_idx as u8,
                                    });
                                    println!("slot {shooter_idx} killed slot {ts}");
                                }
                            }
                        }
                    }
                }

                let snapshot = build_snapshot(&slots, &round, server_tick, frame_events);
                for slot in &slots {
                    if let (true, Some(out)) = (slot.occupied, &slot.out) {
                        let mut snap = snapshot.clone();
                        snap.ack_seq = slot.ack_seq;
                        let _ = out.send(snap.encode());
                    }
                }
                // Also send snapshots to spectators so they can see the match.
                for (_cid, out) in &spectators {
                    let _ = out.send(snapshot.encode());
                }
            }
            Some(ev) = events.recv() => match ev {
                Ev::Connect { out, slot_tx, reply } => {
                    let active_humans: usize = slots.iter().filter(|s| s.is_human).count();
                    let full = active_humans >= MAX_SLOTS && spectators.len() >= MAX_SPECTATORS;
                    if full {
                        let _ = slot_tx.send(SPECTATOR);
                        let _ = reply.send(None);
                        let bye_bytes = sim::protocol::Bye { reason: "full".into() }.encode();
                        let _ = out.send(bye_bytes);
                        // Don't register the connection — handle_conn sees the None
                        // reply, drains the Bye, and closes the socket.
                    } else {
                    let conn_id = next_conn_id;
                    next_conn_id += 1;
                    let w = Welcome {
                        your_slot: SPECTATOR,
                        map: "de_douglas".into(),
                        seed: SEED,
                        server_tick,
                        max_players: MAX_SLOTS as u8,
                        players: active_humans as u8,
                        spectators: spectators.len() as u8,
                        spec_cap: MAX_SPECTATORS as u8,
                    };
                    let _ = out.send(w.encode());
                    pending_conns.insert(conn_id, (out, slot_tx));
                    let _ = reply.send(Some(conn_id));
                    println!("conn {conn_id} connected (pending)");
                    }
                }
                Ev::JoinTeam { conn_id, team } => {
                    // Stale or invalid conn_id → no entry → ignored.
                    if let Some((out, slot_tx)) = pending_conns.remove(&conn_id) {
                    // Count active + pending humans before the loop (avoids borrow conflict).
                    let player_count = slots.iter()
                        .filter(|s| s.is_human || s.pending_human.is_some()).count() as u8;
                    match team {
                        0 | 1 => {
                            let target_ct = team == 1;
                            let mut out_opt = Some(out);
                            let mut found_slot: Option<u8> = None;
                            for (i, s) in slots.iter_mut().enumerate() {
                                if s.team_ct != target_ct { continue; }
                                if s.is_human || s.pending_human.is_some() { continue; }
                                found_slot = Some(i as u8);
                                let o = out_opt.take().unwrap();
                                if round.phase == game::Phase::Live {
                                    s.pending_human = Some(o);
                                } else {
                                    let sp = if target_ct { spawn.ct } else { spawn.t };
                                    s.is_human = true;
                                    ACTIVE_HUMANS.fetch_add(1, Ordering::Relaxed);
                                    s.alive = true;
                                    s.health = 100;
                                    s.armor = 0;
                                    s.weapon = 1;
                                    s.ammo = 30;
                                    s.out = Some(o);
                                    s.queue.clear();
                                    s.ack_seq = 0;
                                    s.last_buttons = 0;
                                    s.player.reset(sp[0], sp[1], sp[2]);
                                    world.sync_player_body(
                                        s.body_handle, s.collider_handle,
                                        sp[0], sp[1], sp[2], false,
                                    );
                                    s.bot = None;
                                }
                                break;
                            }
                            if let Some(assigned_slot) = found_slot {
                                let _ = slot_tx.send(assigned_slot);
                                let w2 = Welcome {
                                    your_slot: assigned_slot,
                                    map: "de_douglas".into(),
                                    seed: SEED,
                                    server_tick,
                                    max_players: MAX_SLOTS as u8,
                                    players: player_count,
                                    spectators: spectators.len() as u8,
                                    spec_cap: MAX_SPECTATORS as u8,
                                };
                                let s = &slots[assigned_slot as usize];
                                let target = if s.pending_human.is_some() {
                                    s.pending_human.as_ref().unwrap()
                                } else {
                                    s.out.as_ref().unwrap()
                                };
                                let _ = target.send(w2.encode());
                                println!("conn {conn_id} assigned to slot {assigned_slot} (team {})",
                                    if target_ct { "CT" } else { "T" });
                            } else if let Some(o) = out_opt {
                                let _ = slot_tx.send(SPECTATOR);
                                spectators.push((conn_id, o));
                                SPECTATOR_COUNT.fetch_add(1, Ordering::Relaxed);
                                println!("conn {conn_id} forced to spectate (team full)");
                            }
                        }
                        2 => {
                            let _ = slot_tx.send(SPECTATOR);
                            spectators.push((conn_id, out));
                            SPECTATOR_COUNT.fetch_add(1, Ordering::Relaxed);
                            println!("conn {conn_id} joined as spectator");
                        }
                        _ => { let _ = slot_tx.send(SPECTATOR); }
                    }
                    }
                }
                Ev::PendingDrop { conn_id } => {
                    if pending_conns.remove(&conn_id).is_some() {
                        println!("conn {conn_id} disconnected before Join");
                    }
                }
                Ev::SpecDrop { conn_id } => {
                    if let Some(pos) = spectators.iter().position(|(id, _)| *id == conn_id) {
                        spectators.remove(pos);
                        SPECTATOR_COUNT.fetch_sub(1, Ordering::Relaxed);
                        println!("spectator {conn_id} disconnected");
                    }
                }
                Ev::Cmd { slot, frame } => {
                    if let Some(s) = slots.get_mut(slot as usize) {
                        if s.is_human {
                            s.queue.push_back(frame);
                        }
                    }
                }
                Ev::Leave { slot } => {
                    if let Some(s) = slots.get_mut(slot as usize) {
                        // Only decrement if this slot was actually counted. A pending
                        // human (joined during Live, not yet promoted) never bumped
                        // ACTIVE_HUMANS, so decrementing here would underflow the u8.
                        if s.is_human {
                            ACTIVE_HUMANS.fetch_sub(1, Ordering::Relaxed);
                        }
                        s.is_human = false;
                        s.alive = true;
                        s.health = 100;
                        s.armor = 0;
                        s.weapon = 1;
                        s.ammo = 30;
                        s.out = None;
                        s.pending_human = None;
                        s.queue.clear();
                        // Respawn a bot into this slot.
                        let feet = s.bot_spawn.feet;
                        s.player.reset(feet[0], feet[1], feet[2]);
                        world.sync_player_body(
                            s.body_handle, s.collider_handle,
                            feet[0], feet[1], feet[2], false,
                        );
                        s.bot = Some(ai::Bot::new(s.bot_spawn.waypoints));
                        println!("slot {slot} left (bot respawned)");
                    }
                }
            }
        }
    }
}

fn build_snapshot(slots: &[Slot], round: &game::State, server_tick: u32, events: Vec<GameEvent>) -> Snapshot {
    let entities = slots
        .iter()
        .enumerate()
        .filter(|(_, s)| s.occupied && s.alive)
        .map(|(i, s)| {
            let p = &s.player;
            let mut flags = F_ALIVE;
            if p.ducked {
                flags |= F_DUCKED;
            }
            if s.team_ct {
                flags |= F_TEAM_CT;
            }
            EntityState {
                slot: i as u8,
                flags,
                pos: [p.position.x as f32, p.position.y as f32, p.position.z as f32],
                vel: [p.velocity.x as f32, p.velocity.y as f32, p.velocity.z as f32],
                yaw: s.last_yaw,
                pitch: s.last_pitch,
                health: s.health,
                armor: s.armor,
                weapon: s.weapon,
                ammo: s.ammo,
            }
        })
        .collect();
    Snapshot {
        server_tick,
        ack_seq: 0,
        entities,
        events,
        round: RoundState {
            phase: round.phase_value(),
            time_left_ms: round.time_left_ms,
            score_t: round.score_t,
            score_ct: round.score_ct,
        },
    }
}

async fn handle_conn(stream: TcpStream, addr: SocketAddr, events: mpsc::UnboundedSender<Ev>) {
    let ws = match accept_hdr_async(stream, |req: &Request, _resp: Response| -> Result<Response, ErrorResponse> {
        if req.uri().path() == "/status" {
            // Gate 1: GET /status returns advisory capacity info (JSON).
            let players = ACTIVE_HUMANS.load(Ordering::Relaxed);
            let spectators = SPECTATOR_COUNT.load(Ordering::Relaxed);
            let json = format!(
                "{{\"players\":{},\"maxPlayers\":{},\"spectators\":{},\"specCap\":{}}}",
                players, MAX_SLOTS, spectators, MAX_SPECTATORS,
            );
            let err_resp = Response::builder()
                .status(200)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Some(json))
                .unwrap();
            return Err(err_resp);
        }
        Ok(_resp)
    }).await {
        Ok(ws) => ws,
        Err(_) => return,
    };
    let (mut tx, mut rx) = ws.split();

    // Register with the game loop — gets a conn_id and slot back.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (slot_tx, slot_rx) = oneshot::channel::<u8>();
    let (reply_tx, reply_rx) = oneshot::channel::<Option<u32>>();
    if events
        .send(Ev::Connect {
            out: out_tx,
            slot_tx,
            reply: reply_tx,
        })
        .is_err()
    {
        return;
    }
    // None → refused (server full) or the loop is gone: drain the Bye and close.
    let conn_id = match reply_rx.await {
        Ok(Some(id)) => id,
        _ => {
            while let Some(msg) = out_rx.recv().await {
                let _ = tx.send(Message::Binary(msg.into())).await;
            }
            let _ = tx.close().await;
            return;
        }
    };
    println!("[{addr}] connected → conn {conn_id}");

    // Writer task: drain outbound queue to the socket.
    let writer = tokio::spawn(async move {
        while let Some(bytes) = out_rx.recv().await {
            if tx.send(Message::Binary(bytes.into())).await.is_err() {
                break;
            }
        }
    });

    // Reader loop: first message is Join, then await slot assignment, then CommandFrames.
    let my_slot: u8;
    loop {
        match rx.next().await {
            Some(Ok(Message::Binary(data))) => {
                // First message must be Join.
                if let Some(join) = Join::decode(&data) {
                    let _ = events.send(Ev::JoinTeam { conn_id, team: join.team });
                    break;
                }
                // Backwards compat: old client sends Cmd first; treat as T auto-join.
                let _ = events.send(Ev::JoinTeam { conn_id, team: 0 });
                break;
            }
            Some(Ok(Message::Close(_))) | None => {
                let _ = events.send(Ev::PendingDrop { conn_id });
                writer.abort();
                return;
            }
            _ => continue,
        }
    }

    // Wait for the game loop to assign us a slot (or tell us we're a spectator).
    my_slot = slot_rx.await.unwrap_or(SPECTATOR);
    if my_slot == SPECTATOR {
        // Spectator: just drain reader and close on disconnect.
        while let Some(Ok(msg)) = rx.next().await {
            if let Message::Close(_) = msg { break; }
        }
        let _ = events.send(Ev::SpecDrop { conn_id });
        writer.abort();
        return;
    }

    // Player: read CommandFrames and forward to game loop.
    while let Some(Ok(msg)) = rx.next().await {
        match msg {
            Message::Binary(data) => {
                if let Some(frame) = CommandFrame::decode(&data) {
                    let _ = events.send(Ev::Cmd { slot: my_slot, frame });
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    let _ = events.send(Ev::Leave { slot: my_slot });
    writer.abort();
}

#[tokio::main]
async fn main() {
    let (events_tx, events_rx) = mpsc::unbounded_channel::<Ev>();
    tokio::spawn(game_loop(events_rx));

    // SERVER_BIND overrides the default (tests use an isolated port).
    let bind = std::env::var("SERVER_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());
    let listener = TcpListener::bind(&bind).await.expect("bind");
    println!("deathmatch server listening on ws://{bind}");

    while let Ok((stream, addr)) = listener.accept().await {
        tokio::spawn(handle_conn(stream, addr, events_tx.clone()));
    }
}
