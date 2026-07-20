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

use futures_util::{SinkExt, StreamExt};
use sim::constants::FIXED_DT;
use sim::map;
use sim::movement::{tick_movement, PlayerState};
use sim::protocol::{
    CommandFrame, EntityState, GameEvent, RoundState, Shot, Snapshot, Welcome, EV_KILL,
    F_ALIVE, F_DUCKED, F_TEAM_CT, SPECTATOR,
};
use sim::world::SimWorld;
use sim::{ColliderHandle, RigidBodyHandle};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{accept_async, tungstenite::Message};

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
const SEED: u32 = 1;
const MAP_JSON: &str = include_str!("../../assets/maps/de_douglas.json");

type Out = mpsc::UnboundedSender<Vec<u8>>;

/// Messages from connection tasks into the single game loop.
enum Ev {
    Join {
        out: Out,
        reply: oneshot::Sender<u8>, // assigned slot, or SPECTATOR
    },
    Cmd {
        slot: u8,
        frame: CommandFrame,
    },
    Leave {
        slot: u8,
    },
}

struct Slot {
    occupied: bool,
    is_human: bool,
    out: Option<Out>,
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
            }
        })
        .collect();

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
                        if !s.alive {
                            let bf = s.bot_spawn.feet;
                            s.player.reset(bf[0], bf[1], bf[2]);
                            s.alive = true;
                            s.health = 100;
                            world.sync_player_body(
                                s.body_handle, s.collider_handle,
                                bf[0], bf[1], bf[2], false,
                            );
                        }
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
                        // Each client gets its own ackSeq — re-encode per slot.
                        let mut snap = snapshot.clone();
                        snap.ack_seq = slot.ack_seq;
                        let _ = out.send(snap.encode());
                    }
                }
            }
            Some(ev) = events.recv() => match ev {
                Ev::Join { out, reply } => {
                    match slots.iter().position(|s| !s.is_human) {
                        Some(i) => {
                            let team_ct = slots[i].team_ct;
                            let spawn_pt = if team_ct { spawn.ct } else { spawn.t };
                            let s = &mut slots[i];
                            s.occupied = true;
                            s.is_human = true;
                            s.alive = true;
                            s.health = 100;
                            s.out = Some(out);
                            s.queue.clear();
                            s.ack_seq = 0;
                            s.last_buttons = 0;
                            s.last_yaw = 0.0;
                            s.player.reset(spawn_pt[0], spawn_pt[1], spawn_pt[2]);
                            world.sync_player_body(
                                s.body_handle, s.collider_handle,
                                spawn_pt[0], spawn_pt[1], spawn_pt[2], false,
                            );
                            s.bot = None; // evict the bot
                            let _ = reply.send(i as u8);
                            println!("slot {i} joined (human; bot evicted)");
                        }
                        None => {
                            let _ = reply.send(SPECTATOR);
                        }
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
                        s.is_human = false;
                        s.alive = true;
                        s.health = 100;
                        s.out = None;
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
                armor: 0,
                weapon: 1,
                ammo: 30,
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
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[{addr}] handshake failed: {e}");
            return;
        }
    };
    let (mut tx, mut rx) = ws.split();

    // Ask the game loop for a slot.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (reply_tx, reply_rx) = oneshot::channel::<u8>();
    if events
        .send(Ev::Join {
            out: out_tx,
            reply: reply_tx,
        })
        .is_err()
    {
        return;
    }
    let my_slot = reply_rx.await.unwrap_or(SPECTATOR);
    println!("[{addr}] connected → slot {my_slot}");

    let welcome = Welcome {
        your_slot: my_slot,
        map: "de_douglas".into(),
        seed: SEED,
        server_tick: 0,
    };
    if tx.send(Message::Binary(welcome.encode().into())).await.is_err() {
        return;
    }

    // Writer task: drain the outbound queue to the socket.
    let writer = tokio::spawn(async move {
        while let Some(bytes) = out_rx.recv().await {
            if tx.send(Message::Binary(bytes.into())).await.is_err() {
                break;
            }
        }
    });

    // Reader loop: decode CommandFrames into the game loop.
    while let Some(Ok(msg)) = rx.next().await {
        match msg {
            Message::Binary(data) => {
                if my_slot != SPECTATOR {
                    if let Some(frame) = CommandFrame::decode(&data) {
                        let _ = events.send(Ev::Cmd {
                            slot: my_slot,
                            frame,
                        });
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    if my_slot != SPECTATOR {
        let _ = events.send(Ev::Leave { slot: my_slot });
    }
    writer.abort();
    println!("[{addr}] disconnected");
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
