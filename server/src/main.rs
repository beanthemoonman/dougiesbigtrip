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
    CommandFrame, EntityState, RoundState, Snapshot, Welcome, F_ALIVE, F_DUCKED, F_TEAM_CT,
    SPECTATOR,
};
use sim::world::SimWorld;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{accept_async, tungstenite::Message};

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
    out: Option<Out>,
    player: PlayerState,
    queue: VecDeque<CommandFrame>,
    last_buttons: u16,
    last_yaw: f32,
    last_pitch: f32,
    ack_seq: u32,
    team_ct: bool,
}

async fn game_loop(mut events: mpsc::UnboundedReceiver<Ev>) {
    let mut world = SimWorld::new();
    let spawn = map::load(&mut world, MAP_JSON);
    world.ensure_broad_phase_ready();

    // ponytail: one kinematic player body in the world (mirrors WASM index-0).
    // Player-vs-player collision is 6.4 — for one human, excluding the shared
    // body from its own shapecast is exactly the single-player path.
    let handle = world.player_collider_handle();

    let mut slots: Vec<Slot> = (0..MAX_SLOTS)
        .map(|i| {
            // Alternate teams by slot parity; spawn on that team's point.
            let team_ct = i % 2 == 1;
            let s = if team_ct { spawn.ct } else { spawn.t };
            Slot {
                occupied: false,
                out: None,
                player: PlayerState::new(s[0], s[1], s[2]),
                queue: VecDeque::new(),
                last_buttons: 0,
                last_yaw: 0.0,
                last_pitch: 0.0,
                ack_seq: 0,
                team_ct,
            }
        })
        .collect();

    let mut server_tick: u32 = 0;
    let mut interval = tokio::time::interval(std::time::Duration::from_secs_f64(FIXED_DT));

    loop {
        tokio::select! {
            _ = interval.tick() => {
                server_tick = server_tick.wrapping_add(1);

                for slot in slots.iter_mut() {
                    if !slot.occupied {
                        continue;
                    }
                    // Consume one command this tick (keeps server/client 1:1 for
                    // bit-exact reconciliation). Hold last input if starved.
                    if let Some(cmd) = slot.queue.pop_front() {
                        slot.last_buttons = cmd.buttons;
                        slot.last_yaw = cmd.yaw;
                        slot.last_pitch = cmd.pitch;
                        slot.ack_seq = cmd.seq;
                    }
                    world.sync_player_body(
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
                        Some(handle),
                    );
                }

                let snapshot = build_snapshot(&slots, server_tick);
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
                    match slots.iter().position(|s| !s.occupied) {
                        Some(i) => {
                            let team_ct = slots[i].team_ct;
                            let spawn_pt = if team_ct { spawn.ct } else { spawn.t };
                            let s = &mut slots[i];
                            s.occupied = true;
                            s.out = Some(out);
                            s.queue.clear();
                            s.ack_seq = 0;
                            s.last_buttons = 0;
                            s.player.reset(spawn_pt[0], spawn_pt[1], spawn_pt[2]);
                            let _ = reply.send(i as u8);
                            println!("slot {i} joined");
                        }
                        None => {
                            let _ = reply.send(SPECTATOR);
                        }
                    }
                }
                Ev::Cmd { slot, frame } => {
                    if let Some(s) = slots.get_mut(slot as usize) {
                        if s.occupied {
                            s.queue.push_back(frame);
                        }
                    }
                }
                Ev::Leave { slot } => {
                    if let Some(s) = slots.get_mut(slot as usize) {
                        s.occupied = false;
                        s.out = None;
                        s.queue.clear();
                        println!("slot {slot} left");
                    }
                }
            }
        }
    }
}

fn build_snapshot(slots: &[Slot], server_tick: u32) -> Snapshot {
    let entities = slots
        .iter()
        .enumerate()
        .filter(|(_, s)| s.occupied)
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
                health: 100,
                armor: 0,
                weapon: 1,
                ammo: 30,
            }
        })
        .collect();
    Snapshot {
        server_tick,
        ack_seq: 0, // overwritten per client at send time
        entities,
        round: RoundState {
            phase: 1,
            time_left_ms: 0,
            score_t: 0,
            score_ct: 0,
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
