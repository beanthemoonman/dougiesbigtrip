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
/// Same-pole repulsion: every teammate pushes on nearby nodes as 1/(1+d). Was a
/// "distance to nearest teammate" bonus, which always crowned the one globally
/// farthest node — every bot then ran the identical route to it.
const W_REPEL: f64 = 60.0;
const W_RECENCY: f64 = 2.0;
/// Deterministic per-pick jitter, ~3x the tactical spread: tactical nodes stay
/// favoured, but low-weight ones still come up so routes vary run to run.
const W_RANDOM: f64 = 80.0;
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

/// Unsticking. Breakable props are not in the nav graph, so a hop can run
/// straight through a crate. Rather than teach nav about props, detect
/// "pressing FORWARD, going nowhere" and strafe out of it, like a human does.
/// Below this per-tick horizontal displacement (m) the bot counts as blocked.
const STUCK_STEP: f64 = 0.015;
const STUCK_TICKS: u32 = 24;
const SIDESTEP_TICKS: u32 = 32;
/// Two failed sidesteps in a row → treat the goal as unreachable and re-pick.
const STUCK_STRIKES: u32 = 2;

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
    /// Time until the bot may fire its weapon again (seconds). Decremented each
    /// tick; the loop in main.rs synthesises a Shot only when this reaches zero.
    pub fire_cooldown: f64,
    /// Graph node the bot is currently walking toward (the next hop in a path).
    pub path_goal_node: usize,
    /// Graph node the bot is currently at (nearest node to its position last frame).
    pub current_node: usize,
    pub caution_timer: u32,
    pub caution_phase: CautionPhase,
    /// Deterministic per-bot tick offset for de-synchronising caution timers.
    pub tick_offset: u32,
    /// Stuck detector: position last tick + how long we've been going nowhere.
    pub last_x: f64,
    pub last_z: f64,
    pub stuck_ticks: u32,
    pub sidestep_ticks: u32,
    /// Buttons::LEFT or Buttons::RIGHT while sidestepping, 0 otherwise.
    pub sidestep_dir: u16,
    pub stuck_strikes: u32,
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
            fire_cooldown: 0.0,
            path_goal_node: start_node,
            current_node: start_node,
            caution_timer: base_move,
            caution_phase: CautionPhase::Moving,
            tick_offset,
            last_x: f64::MAX,
            last_z: f64::MAX,
            stuck_ticks: 0,
            sidestep_ticks: 0,
            sidestep_dir: 0,
            stuck_strikes: 0,
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

/// Deterministic [0,1) hash of two u32s. Must stay bit-identical to
/// `navnodes.ts::hash01` — it is what lets both ports jitter their goal picks
/// the same way. Not an RNG: no stream, no state, so replays stay exact.
pub fn hash01(a: u32, b: u32) -> f64 {
    let mut h = a.wrapping_mul(0x9e37_79b1) ^ b.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2545_f491);
    h ^= h >> 13;
    f64::from(h) / 4_294_967_296.0
}

/// Pick a search goal node using the shared spec:
///   max over i of  -w1·Σ_teammates 1/(1 + distance_to_node_i)
///                 + w2·(ticks_since_node_i_was_last_visited)
///                 + w3·node_tactical_weight
///                 - w4·(count of teammates whose path_goal is i)
///                 + w5·hash01(seed + tick, i)
/// Tie-broken by smallest node index (deterministic).
fn pick_search_node(
    bot_node: usize,
    graph: &NavGraph,
    search: &SearchState,
    teammate_positions: &[&Vector3<f64>],
    teammate_goals: &[usize],
    server_tick: u32,
    seed: u32,
) -> usize {
    let mut best_node = bot_node;
    let mut best_score = f64::NEG_INFINITY;

    for i in 0..graph.node_count() {
        let Some(n) = graph.node(i) else { continue };

        let mut repel = 0.0;
        for &pos in teammate_positions {
            let dx = n[0] - pos.x;
            let dz = n[2] - pos.z;
            repel += 1.0 / (1.0 + (dx * dx + dz * dz).sqrt());
        }

        let ticks_since = server_tick.saturating_sub(search.last_visited[i]);
        let recency_bonus = (ticks_since as f64).min(VISIT_RECENCY_TICKS as f64);

        let tactical = graph.weight(i);

        let conflicts = teammate_goals.iter().filter(|&&g| g == i).count() as f64;

        let score = -W_REPEL * repel + W_RECENCY * recency_bonus
            + W_TACTICAL * tactical - W_GOAL_CONFLICT * conflicts
            + W_RANDOM * hash01(seed.wrapping_add(server_tick), i as u32);

        if score > best_score {
            best_score = score;
            best_node = i;
        }
    }
    best_node
}

/// Add a strafe when the bot is walking into something the nav graph doesn't
/// know about (FORWARD+LEFT/RIGHT = a 45° wishdir, which slides around it).
/// After two failed sidesteps the goal is treated as unreachable and dropped so
/// the search re-picks — the fresh jitter usually sends it elsewhere entirely.
fn unstick(bot: &mut Bot, buttons: u16, bot_feet: &Vector3<f64>, server_tick: u32) -> u16 {
    if bot.sidestep_ticks > 0 {
        bot.sidestep_ticks -= 1;
        bot.last_x = bot_feet.x;
        bot.last_z = bot_feet.z;
        return buttons | Buttons::FORWARD | bot.sidestep_dir;
    }

    if buttons & Buttons::FORWARD != 0 {
        let dx = bot_feet.x - bot.last_x;
        let dz = bot_feet.z - bot.last_z;
        if dx * dx + dz * dz < STUCK_STEP * STUCK_STEP {
            bot.stuck_ticks += 1;
        } else {
            bot.stuck_ticks = 0;
        }
    }
    bot.last_x = bot_feet.x;
    bot.last_z = bot_feet.z;

    if bot.stuck_ticks >= STUCK_TICKS {
        bot.stuck_ticks = 0;
        bot.stuck_strikes += 1;
        bot.sidestep_ticks = SIDESTEP_TICKS;
        bot.sidestep_dir = if hash01(bot.tick_offset.wrapping_add(server_tick), bot.stuck_strikes) < 0.5 {
            Buttons::LEFT
        } else {
            Buttons::RIGHT
        };
        if bot.stuck_strikes >= STUCK_STRIKES {
            bot.stuck_strikes = 0;
            bot.path_goal_node = bot.current_node; // forces a re-pick next tick
            bot.last_known = None;
            if bot.mode == BotMode::Reposition {
                bot.mode = BotMode::Search;
            }
        }
        return buttons | bot.sidestep_dir;
    }
    buttons
}

/// Tick the bot's AI and return (buttons, yaw) for tick_movement.
/// `player_positions` provides feet positions of enemy slots only (by index) —
/// self and same-team slots are always `None`. `alive` indicates which slots are alive.
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
                teammate_positions, teammate_goals, server_tick, bot.tick_offset,
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

    buttons = unstick(bot, buttons, bot_feet, server_tick);
    (buttons, bot.yaw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim::world::SimWorld;

    const MAP_JSON: &str = include_str!("../../assets/maps/de_douglas.json");
    const NAVNODES_JSON: &str = include_str!("../../assets/maps/de_douglas.navnodes.json");

    fn setup() -> (SimWorld, NavGraph) {
        let mut world = SimWorld::new();
        sim::map::load(&mut world, MAP_JSON);
        world.ensure_broad_phase_ready();
        let graph = NavGraph::from_json(NAVNODES_JSON);
        (world, graph)
    }

    /// Regression test: two same-team bots at identical coords would freeze before
    /// the enemy_positions filter (each saw zero-distance self, entered Engage, and
    /// returned zero buttons permanently). With enemies filtered out, a bot must
    /// wander in Search mode even when it is the only occupied slot.
    #[test]
    fn bot_with_no_enemies_wanders_in_search() {
        let (mut world, graph) = setup();
        let mut bot = Bot::new(0, 0);
        let (_body_h, coll_h) = world.add_player_body();
        let feet = Vector3::new(-20.0, 0.0, -25.0);
        let enemy_pos: Vec<Option<Vector3<f64>>> = vec![None; 10];
        let alive: Vec<bool> = vec![false; 10];
        let mut search = SearchState::new(graph.node_count());
        let tm_pos: Vec<&Vector3<f64>> = vec![];
        let tm_goals: Vec<usize> = vec![];

        let mut moved = false;
        for tick in 0..200 {
            let (buttons, _) = tick_bot(
                &mut bot, &world, &feet, coll_h,
                &enemy_pos, &alive, &graph, &mut search,
                &tm_pos, &tm_goals, tick,
            );
            if buttons & Buttons::FORWARD != 0 {
                moved = true;
            }
        }
        assert!(moved, "bot with no enemies should wander (search mode), not freeze");
    }

    /// A bot with a visible enemy in front (within FOV and LOS) must enter Engage.
    #[test]
    fn bot_engages_visible_enemy() {
        let (mut world, graph) = setup();
        let mut bot = Bot::new(0, 0);
        bot.yaw = 0.0; // looks down -Z
        let (_body_h, coll_h) = world.add_player_body();
        let feet = Vector3::new(-20.0, 0.0, -25.0);
        // Enemy at the exact same coords → zero-distance short-circuit in can_see.
        let mut enemy_pos: Vec<Option<Vector3<f64>>> = vec![None; 10];
        enemy_pos[1] = Some(feet);
        let mut alive: Vec<bool> = vec![false; 10];
        alive[1] = true;
        let mut search = SearchState::new(graph.node_count());
        let tm_pos: Vec<&Vector3<f64>> = vec![];
        let tm_goals: Vec<usize> = vec![];

        let (_buttons, _) = tick_bot(
            &mut bot, &world, &feet, coll_h,
            &enemy_pos, &alive, &graph, &mut search,
            &tm_pos, &tm_goals, 0,
        );
        assert_eq!(
            bot.mode, BotMode::Engage,
            "bot should engage visible enemy at zero distance"
        );
    }

    /// With only same-team members present (all enemy_pos entries None), the bot
    /// must NOT enter Engage — it should stay in Search.
    #[test]
    fn bot_ignores_teammates() {
        let (mut world, graph) = setup();
        let mut bot = Bot::new(0, 0);
        let (_body_h, coll_h) = world.add_player_body();
        let feet = Vector3::new(-20.0, 0.0, -25.0);
        let enemy_pos: Vec<Option<Vector3<f64>>> = vec![None; 10];
        let mut alive: Vec<bool> = vec![false; 10];
        alive[0] = true; // self occupied but not in enemy list
        let mut search = SearchState::new(graph.node_count());
        let tm_pos: Vec<&Vector3<f64>> = vec![];
        let tm_goals: Vec<usize> = vec![];

        let (_buttons, _) = tick_bot(
            &mut bot, &world, &feet, coll_h,
            &enemy_pos, &alive, &graph, &mut search,
            &tm_pos, &tm_goals, 0,
        );
        assert_ne!(
            bot.mode, BotMode::Engage,
            "bot should not engage when only teammates/self are present"
        );
    }

    #[test]
    fn hash01_is_deterministic() {
        let v1 = hash01(42, 17);
        let v2 = hash01(42, 17);
        assert_eq!(v1, v2, "hash01 must be deterministic for the same inputs");
        assert!(v1 >= 0.0 && v1 < 1.0);
    }

    /// hash01 with different seeds produces different values (not a collision).
    #[test]
    fn hash01_differs_by_input() {
        let a = hash01(1, 1);
        let b = hash01(1, 2);
        let c = hash01(2, 1);
        assert_ne!(a, b);
        assert_ne!(b, c);
        assert_ne!(a, c);
    }
}
