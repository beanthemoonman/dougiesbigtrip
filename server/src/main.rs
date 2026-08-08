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
use sim::constants::{EYE_HEIGHT_STANDING, FIXED_DT};
use sim::map;
use sim::movement::{tick_movement, PlayerState};
use sim::protocol::{
    Bye, CommandFrame, EntityState, GameEvent, ImpactEvent, Join, RoundState, RosterEntry, Shot,
    Snapshot, Welcome, EV_FIRE, EV_KILL, F_ALIVE, F_DUCKED, F_ONGROUND, F_TEAM_CT, SPECTATOR,
};
use sim::world::SimWorld;
use sim::{ColliderHandle, RigidBodyHandle};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{accept_hdr_async, tungstenite::Message};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};

mod auth;
mod db;
mod game;
mod http;

use auth::{AuthConfig, ValidatedUser};
use sqlx::PgPool;

// Bot patrol waypoints (de_douglas map) — replaced by nav_graph in Phase 11.
// Each bot is assigned a start node from the navnode graph.
// PATROL_CT/T remain here as spawn positions (feet coords) for each side;
// the waypoint_routes are no longer used — bots pick graph nodes via spread-out search.

#[derive(Clone, Copy)]
struct BotSpawn {
    feet: [f64; 3],
}

const DEFAULT_BIND: &str = "127.0.0.1:9876";
const MAX_SLOTS: usize = 10; // slot capacity (5 T + 5 CT); keep in step with LIMITS.botCount
const MAX_SPECTATORS: usize = 4;
const SEED: u32 = 1;
/// Ducked model/hitbox scale — must equal the client's `duckScaleY(1)`
/// (`src/player/constants.ts`: DUCKED_HEIGHT / STANDING_HEIGHT).
const DUCKED_SCALE: f64 = 0.9144 / 1.8288;
/// Approximate chest height above the feet, standing. Used to pick the point on
/// the target that the along-ray distance is measured to.
const CHEST_HEIGHT: f64 = 0.9;

const MAP_JSON: &str = include_str!("../../assets/maps/de_douglas.json");
const NAVNODES_JSON: &str = include_str!("../../assets/maps/de_douglas.navnodes.json");

/// Port of `spawnRing` from `src/game/spawning.ts`. Returns the feet position for a
/// slot given its team and its 0-based index *within the team*. Preset offsets
/// reproduce the original 3v3 layout; beyond 3 per side rows step inward.
fn spawn_ring_feet(team_ct: bool, rel_index: usize, anchor: [f64; 3]) -> [f64; 3] {
    const PRESET_X: [f64; 3] = [-3.0, 2.0, 5.0];
    const PRESET_Z: [f64; 3] = [0.0, 1.0, -1.0];
    let z_sign: f64 = if team_ct { 1.0 } else { -1.0 };

    let (x_off, z_off) = if rel_index < PRESET_X.len() {
        (PRESET_X[rel_index], PRESET_Z[rel_index])
    } else {
        let row = (rel_index / PRESET_X.len()) as f64;
        let col = rel_index % PRESET_X.len();
        (PRESET_X[col] - 2.5 * row, PRESET_Z[col] - 1.5 * row)
    };

    [anchor[0] + x_off, anchor[1], anchor[2] + z_off * z_sign]
}

/// The enemy-only view of the world handed to one bot's `sim::ai::tick_bot`.
///
/// Entry `i` is `Some(pos)` only when slot `i` is occupied, alive and on the
/// opposite team to slot `idx`. Self and same-team slots are always `None`.
///
/// This filter is load-bearing, not an optimisation. `sim::ai::can_see` returns true
/// unconditionally below 1e-6 m, and every bot on a team used to share one spawn
/// coordinate — so an unfiltered array made each bot acquire *itself* as a
/// target, enter Engage, and return zero buttons forever. See the tests.
fn enemy_positions_for(
    idx: usize,
    positions: &[Option<nalgebra::Vector3<f64>>],
    occupied: &[bool],
    alive: &[bool],
    team_ct: &[bool],
) -> Vec<Option<nalgebra::Vector3<f64>>> {
    if !occupied[idx] || !alive[idx] {
        return vec![None; positions.len()];
    }
    positions
        .iter()
        .enumerate()
        .map(|(i, opt_pos)| match opt_pos {
            Some(p) if i != idx && occupied[i] && alive[i] && team_ct[i] != team_ct[idx] => Some(*p),
            _ => None,
        })
        .collect()
}

/// Phase 16.3: runtime server configuration built from compiled defaults ← env vars.
/// Validated against the same bounds as the TS `MatchConfig` validator (docs/plan-post-1.0-config-auth.md).
#[derive(Debug, Clone)]
pub struct ServerConfig {
    bind: String,
    api_bind: String,
    bot_count: usize,
    rounds_to_win: u8,
    map: String,
    freezetime_ms: u32,
    round_time_ms: u32,
    end_delay_ms: u32,
    auth_config: AuthConfig,
}

fn build_config() -> ServerConfig {
    let bind = std::env::var("SERVER_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());
    // Loopback by default: with AUTH_REQUIRED=false the admin gate is open, so
    // the API must not be reachable off-box unless someone opts in via API_BIND.
    let api_bind = std::env::var("API_BIND").unwrap_or_else(|_| "127.0.0.1:9877".to_string());

    let bot_count: usize = std::env::var("BOT_COUNT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let rounds_to_win: u8 = std::env::var("ROUNDS_TO_WIN")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(16);
    let map_name = std::env::var("MAP").unwrap_or_else(|_| "de_douglas".into());
    let freezetime_ms = std::env::var("SERVER_FREEZE_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(game::DEFAULT_FREEZETIME_MS);
    let round_time_ms = std::env::var("SERVER_ROUND_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(game::DEFAULT_ROUND_MS);
    let end_delay_ms = std::env::var("SERVER_END_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(game::DEFAULT_END_MS);

    let auth_config = AuthConfig::from_env();

    validate_config(bind, api_bind, bot_count, rounds_to_win, map_name, freezetime_ms, round_time_ms, end_delay_ms, auth_config)
        .unwrap_or_else(|errors| {
            for e in &errors { eprintln!("{e}"); }
            std::process::exit(1);
        })
}

/// Pure validation of all config knobs. Rejects out-of-bounds values with
/// one error per invalid field. Testable without touching env.
pub fn validate_config(
    bind: String,
    api_bind: String,
    bot_count: usize,
    rounds_to_win: u8,
    map_name: String,
    freezetime_ms: u32,
    round_time_ms: u32,
    end_delay_ms: u32,
    auth_config: AuthConfig,
) -> Result<ServerConfig, Vec<String>> {
    let mut errors = Vec::new();

    if bot_count < 2 || bot_count > MAX_SLOTS {
        errors.push(format!(
            "bot_count must be 2–{MAX_SLOTS} (capacity {MAX_SLOTS}), got {bot_count}",
        ));
    }

    if rounds_to_win < 1 || rounds_to_win > 30 {
        errors.push(format!("rounds_to_win must be 1–30, got {rounds_to_win}"));
    }

    let map: String = match map_name.as_str() {
        "de_douglas" => "de_douglas".to_string(),
        _ => {
            errors.push(format!("unknown map '{map_name}' (only 'de_douglas' is supported)"));
            String::new()
        }
    };

    if !errors.is_empty() {
        return Err(errors);
    }

    Ok(ServerConfig {
        bind,
        api_bind,
        bot_count,
        rounds_to_win,
        map,
        freezetime_ms,
        round_time_ms,
        end_delay_ms,
        auth_config,
    })
}

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
    /// Client sent a Join message with their team choice and optional auth token.
    JoinTeam {
        conn_id: u32,
        team: u8, // 0=T, 1=CT, 2=SPEC
        token: Option<String>,
        name: Option<String>,
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
    body_handle: RigidBodyHandle,
    collider_handle: ColliderHandle,
    player: PlayerState,
    bot: Option<sim::ai::Bot>,
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
    /// Phase 17.4: authenticated user info from the validated JWT.
    validated_user: Option<ValidatedUser>,
    /// Phase 21: server-authoritative match tally + the display handle shown on
    /// every client's scoreboard. Empty name = a bot (client renders "Bot N").
    kills: u16,
    deaths: u16,
    display_name: String,
}

async fn game_loop(
    mut events: mpsc::UnboundedReceiver<Ev>,
    config: ServerConfig,
    shared_config: std::sync::Arc<tokio::sync::RwLock<ServerConfig>>,
    pool: Option<PgPool>,
) {
    let mut world = SimWorld::new();
    let spawn = map::load(&mut world, MAP_JSON);
    world.ensure_broad_phase_ready();
    let nav_graph = sim::nav_graph::NavGraph::from_json(NAVNODES_JSON);
    let mut search_state = sim::ai::SearchState::new(nav_graph.node_count());

    // Live bot budget: seeded from startup config, re-read from the shared config
    // at each round reset so an admin edit takes effect without a restart.
    let mut bot_count = config.bot_count;

    let mut slots: Vec<Slot> = (0..MAX_SLOTS)
        .map(|i| {
            let team_ct = i % 2 == 1;
            let anchor = if team_ct { spawn.ct } else { spawn.t };
            let s = spawn_ring_feet(team_ct, i / 2, anchor);
            let (body_handle, collider_handle) = if i == 0 {
                (
                    world.player_rigid_body_handle(0),
                    world.player_collider_handle(0),
                )
            } else {
                world.add_player_body()
            };
            world.sync_player_body(body_handle, collider_handle, s[0], s[1], s[2], false);

            // Only fill the first bot_count slots; remainder stay vacant for future humans.
            let occupied = i < bot_count;
            let start_node = if team_ct { 7 } else { 0 };
            let bot = if occupied { Some(sim::ai::Bot::new(start_node, i as u32 * 17)) } else { None };

            Slot {
                occupied,
                is_human: false,
                out: None,
                body_handle,
                collider_handle,
                player: PlayerState::new(s[0], s[1], s[2]),
                bot,
                bot_spawn: BotSpawn { feet: s },
                queue: VecDeque::new(),
                last_buttons: 0,
                last_yaw: 0.0,
                last_pitch: 0.0,
                last_shot: None,
                ack_seq: 0,
                team_ct,
                alive: occupied, // vacant slots start dead
                health: 100,
                armor: 0,
                weapon: 1,
                ammo: 30,
                validated_user: None,
                kills: 0,
                deaths: 0,
                display_name: String::new(),
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
    let mut last_roster_sig: u64 = 0;
    let mut interval = tokio::time::interval(std::time::Duration::from_secs_f64(FIXED_DT));
    let mut round = game::State::new(
        config.rounds_to_win,
        config.freezetime_ms,
        config.round_time_ms,
        config.end_delay_ms,
    );

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
                    // Phase 20.1: apply any admin config edit at the round boundary —
                    // the only point where changing bot count / rounds-to-win is safe.
                    // Done before the respawn pass below so vacated slots stay dead and
                    // newly-occupied ones get their bot backfilled in the same pass.
                    {
                        let sc = shared_config.read().await;
                        if sc.rounds_to_win != round.rounds_to_win {
                            println!("config: rounds_to_win {} -> {}", round.rounds_to_win, sc.rounds_to_win);
                            round.rounds_to_win = sc.rounds_to_win;
                        }
                        if sc.bot_count != bot_count {
                            println!("config: bot_count {} -> {}", bot_count, sc.bot_count);
                            bot_count = sc.bot_count;
                            for (i, s) in slots.iter_mut().enumerate() {
                                // Humans hold their slot regardless of the bot budget.
                                if s.is_human { continue; }
                                s.occupied = i < bot_count;
                                if !s.occupied {
                                    s.bot = None;
                                    s.alive = false;
                                }
                            }
                        }
                    }
                    for (i, s) in slots.iter_mut().enumerate() {
                        if !s.occupied { continue; }
                        // Phase 9: a slot a human left is vacant (no bot, dead) until now —
                        // backfill a bot at round start (a bot never replaces a player mid-round).
                        if !s.is_human && s.bot.is_none() {
                            s.bot = Some(sim::ai::Bot::new(
                                if s.team_ct { 7 } else { 0 },
                                i as u32 * 17,
                            ));
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

                // Build teammate positions per slot (owned, for bot AI).
                // Each entry: positions of alive same-team members (excl. self).
                let teammate_positions: Vec<Vec<nalgebra::Vector3<f64>>> = (0..MAX_SLOTS)
                    .map(|idx| {
                        let slot = &slots[idx];
                        if !slot.occupied || !slot.alive {
                            return Vec::new();
                        }
                        let mut tm: Vec<nalgebra::Vector3<f64>> = Vec::new();
                        for (oidx, other) in slots.iter().enumerate() {
                            if oidx == idx { continue; }
                            if !other.occupied || !other.alive { continue; }
                            if other.team_ct != slot.team_ct { continue; }
                            tm.push(other.player.position);
                        }
                        tm
                    })
                    .collect();

                // Build teammate goal nodes per slot: each teammate's current
                // path_goal_node, so bots avoid picking the same node (gentle divergence).
                let teammate_goals: Vec<Vec<usize>> = (0..MAX_SLOTS)
                    .map(|idx| {
                        let slot = &slots[idx];
                        if !slot.occupied || !slot.alive {
                            return Vec::new();
                        }
                        let mut tm: Vec<usize> = Vec::new();
                        for (oidx, other) in slots.iter().enumerate() {
                            if oidx == idx { continue; }
                            if !other.occupied || !other.alive { continue; }
                            if other.team_ct != slot.team_ct { continue; }
                            if let Some(ref b) = other.bot {
                                tm.push(b.path_goal_node);
                            }
                        }
                        tm
                    })
                    .collect();

                let occupied: Vec<bool> = slots.iter().map(|s| s.occupied).collect();
                let teams: Vec<bool> = slots.iter().map(|s| s.team_ct).collect();
                let enemy_positions: Vec<Vec<Option<nalgebra::Vector3<f64>>>> = (0..MAX_SLOTS)
                    .map(|idx| enemy_positions_for(idx, &positions, &occupied, &alive, &teams))
                    .collect();

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
                            let tm_refs: Vec<&nalgebra::Vector3<f64>> =
                                teammate_positions[_idx].iter().collect();
                            let tm_goals: &[usize] = &teammate_goals[_idx];
                            let (buttons, yaw) = sim::ai::tick_bot(
                                bot,
                                &world,
                                &slot.player.position,
                                slot.collider_handle,
                                &enemy_positions[_idx],
                                &alive,
                                &nav_graph,
                                &mut search_state,
                                &tm_refs,
                                tm_goals,
                                server_tick,
                            );
                            slot.last_buttons = buttons;
                            slot.last_yaw = yaw as f32;
                            slot.last_pitch = bot.aim_pitch as f32;

                            // Bot shooting (Phase 11.5 / E.3): fire gate moved into
                            // brain.rs (on_target + reaction_timer). Check should_fire
                            // and the fire interval here; brain handles aim gating.
                            bot.fire_cooldown = (bot.fire_cooldown - FIXED_DT as f64).max(0.0);
                            slot.last_shot = if bot.should_fire && bot.fire_cooldown <= 0.0
                            {
                                bot.should_fire = false; // consume
                                const FIRE_INTERVAL: f64 = 0.125;
                                bot.fire_cooldown = FIRE_INTERVAL;
                                let r1 = sim::ai::hash01(server_tick, _idx as u32);
                                let r2 = sim::ai::hash01(_idx as u32, server_tick);
                                let sp_yaw = (r1 - 0.5) * 2.0 * sim::ai::bot::BOT_AIM_SPREAD;
                                let sp_pitch = (r2 - 0.5) * 2.0 * sim::ai::bot::BOT_AIM_SPREAD;
                                let ay = bot.aim_yaw + sp_yaw;
                                let ap = bot.aim_pitch + sp_pitch;
                                let cp = ap.cos();
                                let p = &slot.player.position;
                                Some(Shot {
                                    eye_pos: [
                                        p.x as f32,
                                        (p.y + EYE_HEIGHT_STANDING) as f32,
                                        p.z as f32,
                                    ],
                                    dir: [
                                        ((-ay.sin()) * cp) as f32,
                                        (ap.sin()) as f32,
                                        ((-ay.cos()) * cp) as f32,
                                    ],
                                })
                            } else {
                                None
                            };
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

                // Rebuild the query BVH now that every player body has been synced
                // to its current-tick position. Without this the raycasts below (and
                // bot LOS) hit a BVH frozen at startup, so no shot ever registers —
                // the browser client does the same refresh every tick.
                world.update_scene_queries();

                // Shot resolution (6.6): raycast from eyePos along dir against all
                // other slots' colliders. Collect shots first, then apply damage
                // in a separate pass to avoid aliasing slots.
                let mut frame_events: Vec<GameEvent> = Vec::new();
                let mut frame_impacts: Vec<ImpactEvent> = Vec::new();

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
                    // Every shot produces a fire event for third-person VFX (Phase 12.2).
                    frame_events.push(GameEvent {
                        tag: EV_FIRE,
                        slot: shooter_idx as u8,
                        by: 0,
                    });

                    let eye_x = shot.eye_pos[0] as f64;
                    let eye_y = shot.eye_pos[1] as f64;
                    let eye_z = shot.eye_pos[2] as f64;
                    let dir_x = shot.dir[0] as f64;
                    let dir_y = shot.dir[1] as f64;
                    let dir_z = shot.dir[2] as f64;

                    let shooter_coll = slots[shooter_idx].collider_handle;
                    let mut hit_normal = nalgebra::Vector3::zeros();
                    let world_hit = sim::shapecast::ray_cast(
                        &world.physics,
                        eye_x, eye_y, eye_z,
                        dir_x, dir_y, dir_z,
                        100.0,
                        &mut hit_normal,
                        Some(shooter_coll),
                    );
                    // One fallback for "the ray hit nothing", used by both the
                    // occlusion test and the impact position below. They used to
                    // disagree (100 vs 80), which meant a shot could count as
                    // unoccluded and still place its impact 20 m short.
                    const MAX_SHOT_RANGE: f64 = 100.0;
                    let world_dist = world_hit.unwrap_or(MAX_SHOT_RANGE);

                    // Phase E.3: replace flat-30 "nearest collider" with full
                    // hitboxRay → computeDamage pipeline. For each alive non-friendly
                    // enemy, trace the ray through their per-bone AABBs.
                    let shooter_ct = slots[shooter_idx].team_ct;
                    let mut best_target: Option<usize> = None;
                    let mut best_hitbox = sim::damage::Hitbox::Chest;
                    let mut best_t = f64::INFINITY;

                    for (ts, ts_slot) in slots.iter().enumerate() {
                        if ts == shooter_idx || !ts_slot.occupied || !ts_slot.alive {
                            continue;
                        }
                        if ts_slot.team_ct == shooter_ct {
                            continue;
                        }
                        let tp = &ts_slot.player.position;
                        let yaw = ts_slot.last_yaw as f64;
                        // Must match the client's duckScaleY(1) = DUCKED_HEIGHT /
                        // STANDING_HEIGHT = 0.9144 / 1.8288. A hand-rounded 0.6
                        // made crouched hitboxes 20% taller than the model.
                        let scale = if ts_slot.player.ducked { DUCKED_SCALE } else { 1.0 };
                        let hit_on_bone = sim::hitbox::hitbox_ray(
                            eye_x, eye_y, eye_z,
                            dir_x, dir_y, dir_z,
                            tp.x, tp.y, tp.z,
                            yaw, scale,
                        );
                        if let Some(zone) = hit_on_bone {
                            // Distance ALONG THE RAY to the target's chest, not
                            // eye-to-feet: that is what has to be compared against
                            // the distance to world geometry to decide whether a
                            // wall got there first, and what damage falloff wants.
                            let cx = tp.x - eye_x;
                            let cy = tp.y + CHEST_HEIGHT * scale - eye_y;
                            let cz = tp.z - eye_z;
                            let t_along = cx * dir_x + cy * dir_y + cz * dir_z;
                            if t_along >= 0.0 && t_along < best_t {
                                best_t = t_along;
                                best_target = Some(ts);
                                best_hitbox = zone;
                            }
                        }
                    }

                    let mut hit_surface: u8 = 0; // concrete
                    if let Some(ts) = best_target {
                        let ray_dist = best_t;
                        // Strictly nearer than the wall. The old test allowed a
                        // half-metre of slack, which let shots register through
                        // thin geometry.
                        if ray_dist <= world_dist {
                            // Bullet reached the target before hitting geometry.
                            hit_surface = 1; // flesh
                            let dmg = sim::damage::compute_damage(
                                &sim::damage::WEAPON_RIFLE,
                                ray_dist,
                                best_hitbox,
                                slots[ts].armor,
                            );
                            let target = &mut slots[ts];
                            let hp_dmg = (dmg.health as u8).min(target.health);
                            let armor_dmg = (dmg.armor as u8).min(target.armor);
                            target.health -= hp_dmg;
                            target.armor -= armor_dmg;
                            if target.health == 0 {
                                target.alive = false;
                                target.player.on_ground = false;
                                target.deaths += 1;
                                slots[shooter_idx].kills += 1;
                                frame_events.push(GameEvent {
                                    tag: EV_KILL,
                                    slot: ts as u8,
                                    by: shooter_idx as u8,
                                });
                                println!("slot {shooter_idx} killed slot {ts}");
                            }
                        }
                    }

                    // Only report an impact where something was actually struck.
                    // Emitting one unconditionally put a puff, a decal and an
                    // impact sound in mid-air at the far end of every missed
                    // shot — with `hit_normal` still zeroed, so the decal had a
                    // degenerate orientation too.
                    let impact_dist = if hit_surface == 1 { Some(best_t) } else { world_hit };
                    if let Some(dist) = impact_dist {
                        frame_impacts.push(ImpactEvent {
                            slot: shooter_idx as u8,
                            pos: [
                                (eye_x + dir_x * dist) as f32,
                                (eye_y + dir_y * dist) as f32,
                                (eye_z + dir_z * dist) as f32,
                            ],
                            normal: [
                                hit_normal.x as f32,
                                hit_normal.y as f32,
                                hit_normal.z as f32,
                            ],
                            surface: hit_surface,
                        });
                    }
                }

                // Ship the roster when it changes, plus a 1 Hz heartbeat so a
                // client that connected between changes still learns the names.
                let roster_sig = roster_signature(&slots);
                let send_roster = roster_sig != last_roster_sig || server_tick % 64 == 0;
                last_roster_sig = roster_sig;
                let snapshot = build_snapshot(&slots, &round, server_tick, frame_events, frame_impacts, send_roster);
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
                    let sc = shared_config.read().await;
                    let w = Welcome {
                        your_slot: SPECTATOR,
                        map: sc.map.clone(),
                        seed: SEED,
                        server_tick,
                        max_players: MAX_SLOTS as u8,
                        players: active_humans as u8,
                        spectators: spectators.len() as u8,
                        spec_cap: MAX_SPECTATORS as u8,
                        rounds_to_win: sc.rounds_to_win,
                    };
                    drop(sc);
                    let _ = out.send(w.encode());
                    pending_conns.insert(conn_id, (out, slot_tx));
                    let _ = reply.send(Some(conn_id));
                    println!("conn {conn_id} connected (pending)");
                    }
                }
                Ev::JoinTeam { conn_id, team, token, name } => {
                    // Stale or invalid conn_id → no entry → ignored.
                    if let Some((out, slot_tx)) = pending_conns.remove(&conn_id) {
                    // Phase 17.4: validate auth token when AUTH_REQUIRED.
                    // A refusal must `continue` the game loop, never `return` —
                    // returning here would end game_loop and freeze the server
                    // for everyone already playing.
                    let mut validated: Option<ValidatedUser> = None;
                    if config.auth_config.required {
                        let outcome = match token {
                            None => Err("no token".to_string()),
                            Some(ref t) => auth::validate_token(t, &config.auth_config).await,
                        };
                        match outcome {
                            Err(reason) => {
                                let bye = Bye { reason: format!("auth failed: {reason}") }.encode();
                                let _ = out.send(bye);
                                println!("conn {conn_id} refused — {reason}");
                                continue;
                            }
                            Ok(user) => validated = Some(user),
                        }
                    }
                    // Phase 18.3: upsert authenticated user into the DB.
                    // Detached: this is network I/O on the task that also drives the
                    // 64 Hz tick. Awaiting it here stalls the sim for *everyone* on
                    // the server for as long as the DB takes to answer (up to the
                    // pool acquire timeout). Nothing downstream reads the result.
                    if let (Some(p), Some(user)) = (&pool, &validated) {
                        let p = p.clone(); // PgPool is an Arc — cheap.
                        let sub = user.sub.clone();
                        let display_name =
                            user.name.clone().unwrap_or_else(|| "unknown".to_string());
                        tokio::spawn(async move {
                            if let Err(e) = db::upsert_user(&p, &sub, &display_name, None).await {
                                eprintln!("user upsert failed for {sub}: {e}");
                            }
                        });
                    }
                    // Count active humans before the loop (avoids borrow conflict).
                    let player_count = slots.iter()
                        .filter(|s| s.is_human).count() as u8;
                    match team {
                        0 | 1 => {
                            // Display handle: the client's picked name (trimmed, capped),
                            // falling back to the JWT name, then "player". ponytail: a
                            // 24-char cap is the only sanitisation — it rides the wire as
                            // plain text, never into SQL or a shell.
                            let display = name
                                .as_deref()
                                .map(str::trim)
                                .filter(|n| !n.is_empty())
                                .map(|n| n.chars().take(24).collect::<String>())
                                .or_else(|| validated.as_ref().and_then(|u| u.name.clone()))
                                .unwrap_or_else(|| "player".to_string());
                            let target_ct = team == 1;
                            let mut out_opt = Some(out);
                            let mut found_slot: Option<u8> = None;
                            for (i, s) in slots.iter_mut().enumerate() {
                                if s.team_ct != target_ct { continue; }
                                if s.is_human { continue; }
                                found_slot = Some(i as u8);
                                let o = out_opt.take().unwrap();
                                // Phase 9: a player replaces a bot INSTANTLY, mid-round or not.
                                let bf = s.bot_spawn.feet;
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
                                s.player.reset(bf[0], bf[1], bf[2]);
                                world.sync_player_body(
                                    s.body_handle, s.collider_handle,
                                    bf[0], bf[1], bf[2], false,
                                );
                                s.bot = None;
                                s.validated_user = validated;
                                s.display_name = display.clone();
                                s.kills = 0;
                                s.deaths = 0;
                                break;
                            }
                            if let Some(assigned_slot) = found_slot {
                                let _ = slot_tx.send(assigned_slot);
                                let sc = shared_config.read().await;
                                let w2 = Welcome {
                                    your_slot: assigned_slot,
                                    map: sc.map.clone(),
                                    seed: SEED,
                                    server_tick,
                                    max_players: MAX_SLOTS as u8,
                                    players: player_count,
                                    spectators: spectators.len() as u8,
                                    spec_cap: MAX_SPECTATORS as u8,
                                    rounds_to_win: sc.rounds_to_win,
                                };
                                drop(sc);
                                let s = &slots[assigned_slot as usize];
                                let _ = s.out.as_ref().unwrap().send(w2.encode());
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
                        if s.is_human {
                            ACTIVE_HUMANS.fetch_sub(1, Ordering::Relaxed);
                        }
                        // Phase 9: a bot never replaces a player mid-round. Vacate the slot
                        // (dead, botless) — the Reset backfill hands it a bot next round.
                        s.is_human = false;
                        s.alive = false;
                        s.out = None;
                        s.bot = None;
                        s.queue.clear();
                        s.last_shot = None;
                        s.validated_user = None;
                        s.display_name = String::new();
                        s.kills = 0;
                        s.deaths = 0;
                        println!("slot {slot} left (bot backfills next round)");
                    }
                }
            }
        }
    }
}

/// Hash of everything the roster carries. Compared tick to tick so names ship
/// only when they change (see `build_snapshot`).
fn roster_signature(slots: &[Slot]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for (i, s) in slots.iter().enumerate() {
        if s.occupied && (s.is_human || s.bot.is_some()) {
            (i as u8).hash(&mut h);
            s.display_name.hash(&mut h);
        }
    }
    h.finish()
}

fn build_snapshot(slots: &[Slot], round: &game::State, server_tick: u32, events: Vec<GameEvent>, impact_events: Vec<ImpactEvent>, send_roster: bool) -> Snapshot {
    // Include occupied-but-dead players (F_ALIVE clear) so the scoreboard sees
    // everyone mid-respawn; the client hides dead remote bodies via the flag. A
    // slot a human just left (occupied, but no bot and no human until the next
    // round backfills it) stays out — it's nobody.
    let entities = slots
        .iter()
        .enumerate()
        .filter(|(_, s)| s.occupied && (s.is_human || s.bot.is_some()))
        .map(|(i, s)| {
            let p = &s.player;
            let mut flags = 0;
            if s.alive {
                flags |= F_ALIVE;
            }
            if p.ducked {
                flags |= F_DUCKED;
            }
            if s.team_ct {
                flags |= F_TEAM_CT;
            }
            if p.on_ground {
                flags |= F_ONGROUND;
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
                kills: s.kills,
                deaths: s.deaths,
            }
        })
        .collect();
    // Names change only on join/leave, so shipping them every tick was the whole
    // thing Phase D set out to stop — moving them out of the entity record and
    // then re-sending the same list 64 times a second saved nothing. `roster` is
    // now populated only on the ticks where it actually changed; the client
    // holds the last one it saw.
    let roster: Vec<RosterEntry> = if send_roster {
        slots
            .iter()
            .enumerate()
            .filter(|(_, s)| s.occupied && (s.is_human || s.bot.is_some()))
            .map(|(i, s)| RosterEntry {
                slot: i as u8,
                name: s.display_name.clone(),
            })
            .collect()
    } else {
        Vec::new()
    };
    Snapshot {
        server_tick,
        ack_seq: 0,
        entities,
        events,
        impact_events,
        roster,
        round: RoundState {
            phase: round.phase_value(),
            time_left_ms: round.time_left_ms,
            score_t: round.score_t,
            score_ct: round.score_ct,
        },
    }
}

/// Peek the start of the stream and report whether it's a `GET /status` HTTP
/// request (vs. a WebSocket upgrade). Returns None if the peek fails.
async fn peek_is_status(stream: &TcpStream) -> Option<bool> {
    let mut buf = [0u8; 64];
    let n = stream.peek(&mut buf).await.ok()?;
    Some(buf[..n].starts_with(b"GET /status"))
}

async fn handle_conn(
    mut stream: TcpStream,
    addr: SocketAddr,
    events: mpsc::UnboundedSender<Ev>,
    shared_config: std::sync::Arc<tokio::sync::RwLock<ServerConfig>>,
) {
    // Gate 1: a plain `GET /status` HTTP request (not a WebSocket upgrade) gets a
    // well-formed HTTP/1.1 response with Content-Length and the socket closed. We
    // peek the request line off the raw TCP stream before handing it to the WS
    // handshake — tungstenite's ErrorResponse path omits Content-Length, which left
    // plain HTTP clients (curl/undici) hanging until close. ponytail: fixed-size peek
    // is enough to see the request line; a real HTTP server this is not.
    if let Some(true) = peek_is_status(&stream).await {
        let players = ACTIVE_HUMANS.load(Ordering::Relaxed);
        let spectators = SPECTATOR_COUNT.load(Ordering::Relaxed);
        // Read the shared config, not a startup clone — admin edits must show here too.
        let config = shared_config.read().await;
        let json = format!(
            "{{\"players\":{},\"maxPlayers\":{},\"spectators\":{},\"specCap\":{},\"botCount\":{},\"roundsToWin\":{},\"map\":\"{}\"}}",
            players, MAX_SLOTS, spectators, MAX_SPECTATORS, config.bot_count, config.rounds_to_win, config.map,
        );
        drop(config);
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            json.len(), json,
        );
        let _ = stream.write_all(resp.as_bytes()).await;
        let _ = stream.shutdown().await;
        return;
    }

    let ws = match accept_hdr_async(stream, |_req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        Ok(resp)
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
                    let _ = events.send(Ev::JoinTeam { conn_id, team: join.team, token: join.token, name: join.name });
                    break;
                }
                // Backwards compat: old client sends Cmd first; treat as T auto-join.
                let _ = events.send(Ev::JoinTeam { conn_id, team: 0, token: None, name: None });
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
    let mut config = build_config();

    // Phase 18.1: run DB migrations when DATABASE_URL is set.
    // Phase 18.2: load config from DB; seed with env values if absent.
    // When unset (bare `cargo run`) the server starts without a database —
    // config comes purely from env vars.
    let pool: Option<PgPool> = if let Ok(db_url) = std::env::var("DATABASE_URL") {
        match sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&db_url)
            .await
        {
            Ok(pool) => {
                // A migration failure on a *reachable* DB means a half-applied
                // schema — unlike an unreachable DB, continuing would leave the
                // server running against a database it cannot trust. Bail.
                match sqlx::migrate!("./migrations").run(&pool).await {
                    Ok(_) => println!("DB migrations applied"),
                    Err(e) => {
                        eprintln!("DB migration failed: {e}");
                        std::process::exit(1);
                    }
                }

                // Phase 18.2: override config from database row.
                // ponytail: read-only — the row is seeded once and never written
                // back, so `updated_at`/`updated_by` stay at their insert defaults.
                // The write path lands with the admin config API (Phase 18.4).
                match db::load_config(&pool).await {
                    Ok(Some((bot_count, map, rounds_to_win))) => {
                        match validate_config(
                            config.bind.clone(),
                            config.api_bind.clone(),
                            // Saturate rather than `as`-cast: a 257 in the DB
                            // must fail validation, not truncate to a valid 1.
                            usize::try_from(bot_count).unwrap_or(usize::MAX),
                            u8::try_from(rounds_to_win).unwrap_or(u8::MAX),
                            map,
                            config.freezetime_ms,
                            config.round_time_ms,
                            config.end_delay_ms,
                            config.auth_config.clone(),
                        ) {
                            Ok(db_config) => {
                                println!("Using config from database");
                                config = db_config;
                            }
                            Err(errors) => {
                                eprintln!("DB config invalid, using env config:");
                                for e in &errors { eprintln!("  {e}"); }
                            }
                        }
                    }
                    Ok(None) => {
                        if let Err(e) = db::insert_config(
                            &pool,
                            config.bot_count as i32,
                            config.map.as_str(),
                            config.rounds_to_win as i32,
                        )
                        .await
                        {
                            eprintln!("Failed to seed config into database: {e}");
                        } else {
                            println!("Initial config seeded to database");
                        }
                    }
                    Err(e) => {
                        eprintln!("DB config load failed, using env config: {e}");
                    }
                }

                Some(pool)
            }
            Err(e) => {
                eprintln!("DB connection failed (server continues without persistence): {e}");
                None
            }
        }
    } else {
        println!("DATABASE_URL not set — running without persistence");
        None
    };

    // Phase 17.4: prefetch JWKS so sync validation works in the game loop.
    // Safe to call unconditionally — returns immediately when !required.
    auth::prefetch_jwks(&config.auth_config).await;

    let shared = std::sync::Arc::new(tokio::sync::RwLock::new(config.clone()));
    let (events_tx, events_rx) = mpsc::unbounded_channel::<Ev>();
    tokio::spawn(game_loop(events_rx, config.clone(), shared.clone(), pool.clone()));

    // Phase 20.1: spawn the axum HTTP API server for /api/config, /status.
    let api_addr: std::net::SocketAddr = config.api_bind.parse().expect("invalid API_BIND");
    // Open admin only for a loopback-bound API with auth off — see ApiState::open_admin.
    let open_admin = !config.auth_config.required && api_addr.ip().is_loopback();
    if open_admin {
        println!("admin API unauthenticated (loopback bind, AUTH_REQUIRED=false)");
    }
    let api_state = http::ApiState { config: shared.clone(), pool, open_admin };
    tokio::spawn(http::serve(api_addr, api_state));

    let listener = TcpListener::bind(&config.bind).await.expect("bind");
    println!("deathmatch server listening on ws://{}", config.bind);

    while let Ok((stream, addr)) = listener.accept().await {
        tokio::spawn(handle_conn(stream, addr, events_tx.clone(), shared.clone()));
    }
}

#[cfg(test)]
mod config_tests {
    use super::*;

    fn auth_not_required() -> AuthConfig {
        AuthConfig {
            required: false,
            issuer: String::new(),
            audience: String::new(),
            jwks_url: String::new(),
        }
    }

    fn default_values() -> (String, String, usize, u8, String, u32, u32, u32, AuthConfig) {
        (
            "127.0.0.1:9876".into(), // bind
            "127.0.0.1:9877".into(), // api_bind
            6,   // bot_count
            16,  // rounds_to_win
            "de_douglas".into(), // map_name
            3_000,   // freezetime_ms
            115_000, // round_time_ms
            5_000,   // end_delay_ms
            auth_not_required(),
        )
    }

    #[test]
    fn default_config_passes() {
        let (b, ab, bc, r, m, f, rt, e, a) = default_values();
        let cfg = validate_config(b, ab, bc, r, m, f, rt, e, a).expect("default should be valid");
        assert_eq!(cfg.bot_count, 6);
        assert_eq!(cfg.rounds_to_win, 16);
        assert_eq!(cfg.map, "de_douglas");
    }

    #[test]
    fn rejects_bot_count_too_low() {
        let (b, ab, _, r, m, f, rt, e, a) = default_values();
        let err = validate_config(b, ab, 0, r, m, f, rt, e, a).unwrap_err();
        assert!(err.iter().any(|e| e.contains("bot_count")));
    }

    #[test]
    fn rejects_bot_count_above_capacity() {
        let (b, ab, _, r, m, f, rt, e, a) = default_values();
        let err = validate_config(b, ab, MAX_SLOTS + 1, r, m, f, rt, e, a).unwrap_err();
        assert!(err.iter().any(|e| e.contains("bot_count")));
    }

    #[test]
    fn rejects_rounds_to_win_zero() {
        let (b, ab, bc, _, m, f, rt, e, a) = default_values();
        let err = validate_config(b, ab, bc, 0, m, f, rt, e, a).unwrap_err();
        assert!(err.iter().any(|e| e.contains("rounds_to_win")));
    }

    #[test]
    fn rejects_rounds_to_win_too_high() {
        let (b, ab, bc, _, m, f, rt, e, a) = default_values();
        let err = validate_config(b, ab, bc, 31, m, f, rt, e, a).unwrap_err();
        assert!(err.iter().any(|e| e.contains("rounds_to_win")));
    }

    #[test]
    fn rejects_unknown_map() {
        let (b, ab, bc, r, _, f, rt, e, a) = default_values();
        let err = validate_config(b, ab, bc, r, "cs_office".into(), f, rt, e, a).unwrap_err();
        assert!(err.iter().any(|e| e.contains("unknown map")));
    }

    #[test]
    fn accepts_minimal_bot_count() {
        let (b, ab, _, r, m, f, rt, e, a) = default_values();
        let cfg = validate_config(b, ab, 2, r, m, f, rt, e, a).expect("bot_count=2 should be valid");
        assert_eq!(cfg.bot_count, 2);
    }

    #[test]
    fn accepts_max_slots_bot_count() {
        let (b, ab, _, r, m, f, rt, e, a) = default_values();
        let cfg = validate_config(b, ab, MAX_SLOTS, r, m, f, rt, e, a).expect("bot_count=MAX_SLOTS valid");
        assert_eq!(cfg.bot_count, MAX_SLOTS);
    }

    #[test]
    fn reports_all_errors_together() {
        let (b, ab, _, _, _, f, rt, e, a) = default_values();
        let err = validate_config(b, ab, 0, 0, "unknown".into(), f, rt, e, a).unwrap_err();
        assert!(err.len() >= 3);
    }
}

#[cfg(test)]
mod enemy_filter_tests {
    use super::*;
    use nalgebra::Vector3;
    use sim::input::Buttons;

    /// Ten slots, teams by parity, every member of a team stacked on one point —
    /// the exact condition that froze every bot before the filter existed.
    fn stacked_teams() -> (
        Vec<Option<Vector3<f64>>>,
        Vec<bool>,
        Vec<bool>,
        Vec<bool>,
    ) {
        let t = Vector3::new(-15.0, 0.05, -25.0);
        let ct = Vector3::new(-15.0, 0.05, 25.0);
        let positions = (0..MAX_SLOTS)
            .map(|i| Some(if i % 2 == 1 { ct } else { t }))
            .collect();
        let occupied = vec![true; MAX_SLOTS];
        let alive = vec![true; MAX_SLOTS];
        let teams = (0..MAX_SLOTS).map(|i| i % 2 == 1).collect();
        (positions, occupied, alive, teams)
    }

    #[test]
    fn filter_hides_self_and_teammates() {
        let (positions, occupied, alive, teams) = stacked_teams();
        let view = enemy_positions_for(0, &positions, &occupied, &alive, &teams);
        assert!(view[0].is_none(), "must not see itself");
        for i in (2..MAX_SLOTS).step_by(2) {
            assert!(view[i].is_none(), "must not see teammate in slot {i}");
        }
        for i in (1..MAX_SLOTS).step_by(2) {
            assert!(view[i].is_some(), "must see enemy in slot {i}");
        }
    }

    #[test]
    fn filter_hides_dead_and_vacant_enemies() {
        let (positions, mut occupied, mut alive, teams) = stacked_teams();
        alive[1] = false; // dead enemy
        occupied[3] = false; // vacant slot
        let view = enemy_positions_for(0, &positions, &occupied, &alive, &teams);
        assert!(view[1].is_none(), "dead enemy must be invisible");
        assert!(view[3].is_none(), "vacant slot must be invisible");
        assert!(view[5].is_some(), "live enemy still visible");
    }

    #[test]
    fn dead_bot_gets_an_empty_view() {
        let (positions, occupied, mut alive, teams) = stacked_teams();
        alive[0] = false;
        let view = enemy_positions_for(0, &positions, &occupied, &alive, &teams);
        assert!(view.iter().all(|p| p.is_none()));
    }

    /// The regression proper. Runs the real `tick_bot` against both the filtered
    /// and the unfiltered array from identical starting state: unfiltered, the bot
    /// targets a zero-distance "enemy" (itself / a stacked teammate), latches into
    /// Engage and emits zero buttons for good — the observed production freeze.
    /// Filtered, it walks.
    #[test]
    fn stacked_teammates_freeze_the_bot_without_the_filter() {
        let mut world = SimWorld::new();
        map::load(&mut world, MAP_JSON);
        world.ensure_broad_phase_ready();
        let graph = sim::nav_graph::NavGraph::from_json(NAVNODES_JSON);
        let (positions, occupied, alive, teams) = stacked_teams();
        let feet = positions[0].unwrap();

        let run = |view: &[Option<Vector3<f64>>], world: &mut SimWorld| -> bool {
            let (_b, coll) = world.add_player_body();
            let mut bot = sim::ai::Bot::new(0, 0);
            let mut search = sim::ai::SearchState::new(graph.node_count());
            let mut moved = false;
            for tick in 0..200 {
                let (buttons, _) = sim::ai::tick_bot(
                    &mut bot, world, &feet, coll, view, &alive, &graph,
                    &mut search, &[], &[], tick,
                );
                if buttons & Buttons::FORWARD != 0 {
                    moved = true;
                }
            }
            moved
        };

        assert!(
            !run(&positions, &mut world),
            "unfiltered positions must reproduce the freeze — if this now moves, \
             the zero-distance can_see short-circuit changed and the filter's \
             rationale needs revisiting"
        );
        let view = enemy_positions_for(0, &positions, &occupied, &alive, &teams);
        assert!(run(&view, &mut world), "filtered view must let the bot walk");
    }
}
