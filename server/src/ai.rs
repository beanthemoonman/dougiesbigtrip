//! Server-side bot AI (Phase 11). Each bot runs an FSM (search ↔ engage ↔
//! reposition) and drives the SAME tick_movement function humans use. Bots now
//! navigate via a hand-authored waypoint graph (nav_graph.rs) instead of
//! straight-line walking or fixed patrol routes.
//!
//! See docs/plan-phase11-bot-ai.md.

use nalgebra::Vector3;
use sim::constants::{EYE_HEIGHT_STANDING, FIXED_DT};
use sim::input::Buttons;
use sim::shapecast;
use sim::world::SimWorld;

use crate::nav_graph::NavGraph;

const SIGHT_RANGE: f64 = 40.0;
const SIGHT_HALF_FOV_COS: f64 = 0.258819; // cos(75°)
const WAYPOINT_RADIUS: f64 = 0.6;
const TURN_RATE: f64 = 6.0; // rad/s — normal difficulty
const REACTION_TIME: f64 = 0.5; // s
const LOSE_MEMORY: f64 = 4.0; // s

/// How many ticks a node stays "recently visited" for the search-spread bonus.
const VISIT_RECENCY_TICKS: u32 = 64 * 8; // ~8 s at 64 Hz

/// Weights for the search-goal selection metric. Bots spread out from teammates
/// and avoid nodes that were recently visited by anyone on the team.
const W_TEAMMATE_DIST: f64 = 3.0;
const W_RECENCY: f64 = 2.0;
/// Per-node tactical weight multiplier. Curve/flank nodes are high, spine/killbox
/// nodes are low.
const W_TACTICAL: f64 = 10.0;
/// Penalty per teammate who already has this node as their active path goal.
/// Gently encourages bots to pick different nodes rather than converging.
const W_GOAL_CONFLICT: f64 = 20.0;

/// Caution: bots in search mode pause to scan every few seconds instead of
/// rushing between nodes. Move for ~2.5 s, then stop ± scan for ~1.5 s.
const CAUTION_MOVE_TICKS: u32 = 64 * 5 / 2;  // 2.5 s
const CAUTION_PAUSE_TICKS: u32 = 64 * 3 / 2; // 1.5 s
/// Per-bot tick variation so bots don't pause in lockstep.
const CAUTION_JITTER: u32 = 64; // ±1 s variation

/// Slow-scan yaw rate during caution pauses (rad/s).
const SCAN_RATE: f64 = 1.0;

/// In search mode, bots walk at a reduced duty cycle (press FORWARD only 3 of
/// every 4 ticks) so they move at roughly 50-60% of their normal ground speed.
const SEARCH_DUTY_ON: u32 = 3;
const SEARCH_DUTY_PERIOD: u32 = 4;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BotMode {
    Search,
    Engage,
    Reposition,
    Dead,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CautionPhase {
    Moving,
    Pausing,
}

pub struct Bot {
    pub mode: BotMode,
    pub yaw: f64,
    pub aim_yaw: f64,
    pub aim_pitch: f64,
    pub target_slot: Option<usize>,
    pub last_known: Option<Vector3<f64>>,
    pub reaction_timer: f64,
    pub lost_timer: f64,
    /// Graph node the bot is currently walking toward (the next hop in a path).
    pub path_goal_node: usize,
    /// Graph node the bot is currently at (nearest node to its position last frame).
    pub current_node: usize,
    pub caution_timer: u32,
    pub caution_phase: CautionPhase,
    /// Deterministic per-bot tick offset for de-synchronising caution timers.
    pub tick_offset: u32,
}

impl Bot {
    pub fn new(start_node: usize, tick_offset: u32) -> Self {
        let base_move = CAUTION_MOVE_TICKS + (tick_offset % CAUTION_JITTER);
        Self {
            mode: BotMode::Search,
            yaw: 0.0,
            aim_yaw: 0.0,
            aim_pitch: 0.0,
            target_slot: None,
            last_known: None,
            reaction_timer: 0.0,
            lost_timer: 0.0,
            path_goal_node: start_node,
            current_node: start_node,
            caution_timer: base_move,
            caution_phase: CautionPhase::Moving,
            tick_offset,
        }
    }
}

/// Shared search state across all bots: per-node last-visited tick.
/// Maps a node index → server tick when any bot last arrived at it.
pub struct SearchState {
    pub last_visited: Vec<u32>,
}

impl SearchState {
    pub fn new(node_count: usize) -> Self {
        Self { last_visited: vec![0; node_count] }
    }
}

fn angle_delta(a: f64, b: f64) -> f64 {
    let mut d = (b - a) % (std::f64::consts::PI * 2.0);
    if d > std::f64::consts::PI { d -= std::f64::consts::PI * 2.0; }
    if d <= -std::f64::consts::PI { d += std::f64::consts::PI * 2.0; }
    d
}

fn step_angle(current: f64, target: f64, max_step: f64) -> f64 {
    let d = angle_delta(current, target);
    if d.abs() <= max_step { target } else { current + d.signum() * max_step }
}

fn forward_dir(yaw: f64) -> (f64, f64) {
    (-yaw.sin(), -yaw.cos())
}

fn can_see(
    world: &SimWorld,
    bot_feet: &Vector3<f64>,
    bot_yaw: f64,
    target_feet: &Vector3<f64>,
    exclude_collider: sim::ColliderHandle,
) -> bool {
    let eye = Vector3::new(bot_feet.x, bot_feet.y + EYE_HEIGHT_STANDING, bot_feet.z);
    let target_eye = Vector3::new(
        target_feet.x,
        target_feet.y + EYE_HEIGHT_STANDING,
        target_feet.z,
    );
    let to = target_eye - eye;
    let dist = to.norm();
    if dist < 1e-6 { return true; }
    if dist > SIGHT_RANGE { return false; }
    let dir = to / dist;
    let (fx, fz) = forward_dir(bot_yaw);
    if dir.x * fx + dir.z * fz < SIGHT_HALF_FOV_COS { return false; }
    let mut normal = Vector3::zeros();
    shapecast::ray_cast(
        &world.physics,
        eye.x, eye.y, eye.z,
        dir.x, dir.y, dir.z,
        dist - 0.1,
        &mut normal,
        Some(exclude_collider),
    )
    .is_none()
}

/// Pick a search goal node using the shared spec:
///   max over i of  w1·min_distance_to_any_teammate_at_node_i
///                 + w2·(ticks_since_node_i_was_last_visited)
///                 + w3·node_tactical_weight
///                 - w4·(count of teammates whose path_goal is i)
/// Tie-broken by smallest node index (deterministic).
fn pick_search_node(
    bot_node: usize,
    graph: &NavGraph,
    search: &SearchState,
    teammate_positions: &[&Vector3<f64>],
    teammate_goals: &[usize],
    server_tick: u32,
) -> usize {
    let mut best_node = bot_node;
    let mut best_score = f64::NEG_INFINITY;

    for i in 0..graph.node_count() {
        let Some(n) = graph.node(i) else { continue };

        let mut min_dist = f64::MAX;
        for &pos in teammate_positions {
            let dx = n[0] - pos.x;
            let dz = n[2] - pos.z;
            let dsq = dx * dx + dz * dz;
            if dsq < min_dist { min_dist = dsq; }
        }
        let min_dist = min_dist.sqrt().min(40.0); // cap at sight range

        let ticks_since = server_tick.saturating_sub(search.last_visited[i]);
        let recency_bonus = (ticks_since as f64).min(VISIT_RECENCY_TICKS as f64);

        let tactical = graph.weight(i);

        let conflicts = teammate_goals.iter().filter(|&&g| g == i).count() as f64;

        let score = W_TEAMMATE_DIST * min_dist + W_RECENCY * recency_bonus
            + W_TACTICAL * tactical - W_GOAL_CONFLICT * conflicts;

        if score > best_score {
            best_score = score;
            best_node = i;
        }
    }
    best_node
}

/// Tick the bot's AI and return (buttons, yaw) for tick_movement.
/// `player_positions` provides feet positions of all occupied slots (by index).
/// `alive` indicates which slots are alive.
pub fn tick_bot(
    bot: &mut Bot,
    world: &SimWorld,
    bot_feet: &Vector3<f64>,
    bot_collider: sim::ColliderHandle,
    player_positions: &[Option<Vector3<f64>>],
    alive: &[bool],
    graph: &NavGraph,
    search: &mut SearchState,
    teammate_positions: &[&Vector3<f64>],
    teammate_goals: &[usize],
    server_tick: u32,
) -> (u16, f64) {
    if bot.mode == BotMode::Dead {
        return (0, bot.yaw);
    }

    let dt = FIXED_DT;

    // Update current_node from position. `at_node` (arrival at the path goal) is
    // consumed in the move block below to trigger a search re-pick.
    bot.current_node = graph.nearest_node(bot_feet.x, bot_feet.y, bot_feet.z);
    let at_node = graph.at_node(bot.path_goal_node, bot_feet.x, bot_feet.y, bot_feet.z);

    // --- Perception ---
    let mut sees = false;
    let mut target_feet = Vector3::zeros();
    if let Some(ts) = bot.target_slot {
        if ts < alive.len() && alive[ts] {
            if let Some(ref p) = player_positions[ts] {
                target_feet = *p;
                sees = can_see(world, bot_feet, bot.yaw, &target_feet, bot_collider);
            }
        }
    }
    // If current target is dead/lost, scan for another.
    if bot.target_slot.is_none_or(|ts| ts >= alive.len() || !alive[ts]) {
        bot.target_slot = None;
        for (i, a) in alive.iter().enumerate() {
            if !a { continue; }
            if let Some(ref p) = player_positions[i] {
                if i != bot.target_slot.unwrap_or(usize::MAX) {
                    if can_see(world, bot_feet, bot.yaw, p, bot_collider) {
                        bot.target_slot = Some(i);
                        bot.last_known = Some(*p);
                        sees = true;
                        target_feet = *p;
                        break;
                    }
                }
            }
        }
    }

    // --- FSM transitions ---
    match bot.mode {
        BotMode::Search | BotMode::Reposition => {
            if sees {
                bot.mode = BotMode::Engage;
                bot.reaction_timer = REACTION_TIME;
                bot.last_known = Some(target_feet);
            } else if bot.mode == BotMode::Reposition {
                bot.lost_timer += dt;
                // Give up: either timer elapsed OR reached last_known without re-acquiring.
                let gave_up = bot.lost_timer >= LOSE_MEMORY;
                let arrived = if let Some(lk) = &bot.last_known {
                    let ln = graph.nearest_node(lk.x, lk.y, lk.z);
                    bot.current_node == ln || graph.at_node(ln, bot_feet.x, bot_feet.y, bot_feet.z)
                } else {
                    false
                };
                if gave_up || arrived {
                    bot.mode = BotMode::Search;
                    bot.target_slot = None;
                    bot.last_known = None;
                }
            }
        }
        BotMode::Engage => {
            if sees {
                bot.last_known = Some(target_feet);
            } else {
                bot.mode = BotMode::Reposition;
                bot.lost_timer = 0.0;
            }
        }
        BotMode::Dead => {}
    }

    // --- Act ---
    if bot.mode == BotMode::Engage {
        // Stand and aim: no movement, track target with turn-rate cap.
        if bot.reaction_timer > 0.0 {
            bot.reaction_timer -= dt;
        } else if let Some(ref target) = bot.last_known {
            let eye = Vector3::new(bot_feet.x, bot_feet.y + EYE_HEIGHT_STANDING, bot_feet.z);
            let aim_point = Vector3::new(target.x, target.y + EYE_HEIGHT_STANDING, target.z);
            let to_target = aim_point - eye;
            let desired_pitch = (to_target.y / to_target.norm()).asin();
            let desired_yaw = (-to_target.x).atan2(-to_target.z);
            let max_step = TURN_RATE * dt;
            bot.aim_yaw = step_angle(bot.aim_yaw, desired_yaw, max_step);
            bot.aim_pitch = step_angle(bot.aim_pitch, desired_pitch, max_step);
            bot.yaw = bot.aim_yaw;
        }
        return (0, bot.yaw);
    }

    // Moving states: pick a graph node goal and walk toward its next hop.
    if bot.mode == BotMode::Search {
        // --- Caution: stop-and-scan rhythm ---
        bot.caution_timer = bot.caution_timer.saturating_sub(1);
        if bot.caution_timer == 0 {
            match bot.caution_phase {
                CautionPhase::Moving => {
                    bot.caution_phase = CautionPhase::Pausing;
                    bot.caution_timer = CAUTION_PAUSE_TICKS + (bot.tick_offset.wrapping_mul(13) % CAUTION_JITTER);
                }
                CautionPhase::Pausing => {
                    bot.caution_phase = CautionPhase::Moving;
                    bot.caution_timer = CAUTION_MOVE_TICKS + (bot.tick_offset.wrapping_mul(7) % CAUTION_JITTER);
                }
            }
        }

        if bot.caution_phase == CautionPhase::Pausing {
            // Slowly scan: rotate yaw at SCAN_RATE rad/s with a sign that flips
            // every ~2 s so the bot pans left, then right.
            let scan_dir = if ((server_tick.wrapping_add(bot.tick_offset)) / 128) % 2 == 0 { 1.0 } else { -1.0 };
            bot.yaw += scan_dir * SCAN_RATE * dt;
            return (0, bot.yaw);
        }

        // Moving: update goal on arrival.
        if at_node || bot.path_goal_node == bot.current_node {
            let new_goal = pick_search_node(
                bot.current_node, graph, search,
                teammate_positions, teammate_goals, server_tick,
            );
            // Claim the node so the next bot picks a different one.
            search.last_visited[new_goal] = server_tick;
            bot.path_goal_node = new_goal;
        }
    } else if bot.mode == BotMode::Reposition {
        // Navigate toward last_known via the graph.
        if let Some(ref lk) = bot.last_known {
            let goal_node = graph.nearest_node(lk.x, lk.y, lk.z);
            bot.path_goal_node = goal_node;
        }
    }

    // Walk toward the next hop toward path_goal_node.
    let (target_x, target_z) = graph.next_hop(bot.current_node, bot.path_goal_node);
    let dx = target_x - bot_feet.x;
    let dz = target_z - bot_feet.z;
    let dist_sq = dx * dx + dz * dz;

    let mut buttons: u16 = 0;
    if dist_sq > WAYPOINT_RADIUS * WAYPOINT_RADIUS {
        // In search mode, reduced-speed duty cycle: only press FORWARD on some ticks.
        let allow_move = if bot.mode == BotMode::Search {
            (server_tick.wrapping_add(bot.tick_offset)) % SEARCH_DUTY_PERIOD < SEARCH_DUTY_ON
        } else {
            true
        };
        if allow_move {
            bot.yaw = (-dx).atan2(-dz);
            buttons = Buttons::FORWARD;
        }
    }

    (buttons, bot.yaw)
}
