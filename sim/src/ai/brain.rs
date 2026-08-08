//! Bot FSM and decision logic: tick_bot, search-goal selection, unsticking.
//! Phase E.2 — extracted from server/src/ai.rs into sim/ for WASM-share.
//! Phase E.3 — nearest-visible targeting, error-offset aim error, on-target fire gate.

use nalgebra::Vector3;

use crate::constants::{EYE_HEIGHT_STANDING, FIXED_DT};
use crate::input::Buttons;
use crate::nav_graph::NavGraph;

use super::aim;
use super::bot::{
    self, Bot, BotMode, CautionPhase, SearchState,
    LOSE_MEMORY, REACTION_TIME, SCAN_RATE, SEARCH_DUTY_ON, SEARCH_DUTY_PERIOD,
    WAYPOINT_RADIUS,
};
use super::perception;

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
        let recency_bonus = (ticks_since as f64).min(bot::VISIT_RECENCY_TICKS as f64);

        let tactical = graph.weight(i);

        let conflicts = teammate_goals.iter().filter(|&&g| g == i).count() as f64;

        let score = -bot::W_REPEL * repel + bot::W_RECENCY * recency_bonus
            + bot::W_TACTICAL * tactical - bot::W_GOAL_CONFLICT * conflicts
            + bot::W_RANDOM * aim::hash01(seed.wrapping_add(server_tick), i as u32);

        if score > best_score {
            best_score = score;
            best_node = i;
        }
    }
    best_node
}

/// The point the bot should currently walk toward: the next unreached waypoint
/// on a smoothed navmesh route to `path_goal_node`.
///
/// The route is cached on the Bot and recomputed only when the destination node
/// changes — an A* over the triangle soup is far too expensive to run per bot
/// per tick. ponytail: recompute-on-goal-change means a bot shoved off its route
/// walks back to it rather than re-planning; `unstick` already catches the case
/// where that leaves it grinding a wall.
///
/// Falls back to the nav-graph hop whenever the mesh yields no route, so a bad
/// bake degrades to the previous behaviour instead of freezing the bot.
fn nav_target(bot: &mut Bot, graph: &NavGraph, bot_feet: &Vector3<f64>) -> (f64, f64) {
    let Some(goal) = graph.node(bot.path_goal_node).copied() else {
        return (bot_feet.x, bot_feet.z);
    };

    if bot.path_for_node != bot.path_goal_node {
        bot.path_for_node = bot.path_goal_node;
        bot.path = match crate::nav::mesh() {
            Some(m) => m.find_path(
                [bot_feet.x as f32, bot_feet.y as f32, bot_feet.z as f32],
                [goal[0] as f32, goal[1] as f32, goal[2] as f32],
            ),
            None => Vec::new(),
        };
        // find_path's first waypoint is the start position itself; walking to
        // where you already stand would stall the bot on arrival-radius checks.
        bot.path_idx = if bot.path.is_empty() { 0 } else { 1 };
    }

    // Consume every waypoint already reached — a fast bot can clear more than
    // one in a tick after a corner.
    while let Some(w) = bot.path.get(bot.path_idx) {
        let dx = w[0] as f64 - bot_feet.x;
        let dz = w[2] as f64 - bot_feet.z;
        if dx * dx + dz * dz <= WAYPOINT_RADIUS * WAYPOINT_RADIUS {
            bot.path_idx += 1;
        } else {
            break;
        }
    }

    match bot.path.get(bot.path_idx) {
        Some(w) => (w[0] as f64, w[2] as f64),
        None => graph.next_hop(bot.current_node, bot.path_goal_node),
    }
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
        if dx * dx + dz * dz < bot::STUCK_STEP * bot::STUCK_STEP {
            bot.stuck_ticks += 1;
        } else {
            bot.stuck_ticks = 0;
        }
    }
    bot.last_x = bot_feet.x;
    bot.last_z = bot_feet.z;

    if bot.stuck_ticks >= bot::STUCK_TICKS {
        bot.stuck_ticks = 0;
        bot.stuck_strikes += 1;
        bot.sidestep_ticks = bot::SIDESTEP_TICKS;
        bot.sidestep_dir = if aim::hash01(bot.tick_offset.wrapping_add(server_tick), bot.stuck_strikes) < 0.5 {
            Buttons::LEFT
        } else {
            Buttons::RIGHT
        };
        if bot.stuck_strikes >= bot::STUCK_STRIKES {
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
    world: &crate::world::SimWorld,
    bot_feet: &Vector3<f64>,
    bot_collider: crate::ColliderHandle,
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
                sees = perception::can_see(world, bot_feet, bot.yaw, &target_feet, bot_collider);
            }
        }
    }
    // If current target is dead/lost, scan for nearest visible (not first index).
    if bot.target_slot.is_none_or(|ts| ts >= alive.len() || !alive[ts]) {
        bot.target_slot = None;
        let mut best_dist = f64::INFINITY;
        for (i, a) in alive.iter().enumerate() {
            if !a { continue; }
            if let Some(ref p) = player_positions[i] {
                let dx = bot_feet.x - p.x;
                let dz = bot_feet.z - p.z;
                let dist_sq = dx * dx + dz * dz;
                if dist_sq < best_dist && perception::can_see(world, bot_feet, bot.yaw, p, bot_collider) {
                    best_dist = dist_sq;
                    bot.target_slot = Some(i);
                    bot.last_known = Some(*p);
                    sees = true;
                    target_feet = *p;
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
                // Fresh per-acquisition aim error offset (matches TS acquire()).
                let r = bot::ERROR_RADIUS;
                bot.error_offset = Vector3::new(
                    (aim::hash01(server_tick, bot.tick_offset) - 0.5) * 2.0 * r,
                    (aim::hash01(bot.tick_offset, server_tick) - 0.5) * 2.0 * r,
                    (aim::hash01(server_tick.wrapping_add(1), bot.tick_offset) - 0.5) * 2.0 * r,
                );
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
    bot.should_fire = false; // reset each tick; set below if eligible
    if bot.mode == BotMode::Engage {
        if bot.reaction_timer > 0.0 {
            bot.reaction_timer -= dt;
        }
        if let Some(ref target) = bot.last_known {
            let eye = Vector3::new(bot_feet.x, bot_feet.y + EYE_HEIGHT_STANDING, bot_feet.z);
            // Aim at target feet + eye height + per-acquisition error_offset.
            let aim_point = Vector3::new(
                target.x + bot.error_offset.x,
                target.y + EYE_HEIGHT_STANDING + bot.error_offset.y,
                target.z + bot.error_offset.z,
            );
            let (desired_yaw, desired_pitch) = aim::desired_yaw_pitch(&eye, &aim_point);
            (bot.aim_yaw, bot.aim_pitch) = aim::step_aim(
                bot.aim_yaw, bot.aim_pitch,
                desired_yaw, desired_pitch,
                bot::TURN_RATE, dt,
            );
            bot.yaw = bot.aim_yaw;
            // Fire gate: reaction done AND view angles on target within FIRE_TOL.
            bot.should_fire = bot.reaction_timer <= 0.0
                && aim::on_target(bot.aim_yaw, bot.aim_pitch, desired_yaw, desired_pitch, bot::FIRE_TOL);
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
                    bot.caution_timer = bot::CAUTION_PAUSE_TICKS + (bot.tick_offset.wrapping_mul(13) % bot::CAUTION_JITTER);
                }
                CautionPhase::Pausing => {
                    bot.caution_phase = CautionPhase::Moving;
                    bot.caution_timer = bot::CAUTION_MOVE_TICKS + (bot.tick_offset.wrapping_mul(7) % bot::CAUTION_JITTER);
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

    // Walk toward path_goal_node along a smoothed navmesh route. The nav graph
    // still chooses the destination (shared goal-selection spec); the navmesh
    // decides how to get there, so bots follow the walkable surface instead of
    // straight-lining between waypoints ~12 m apart and scraping the geometry.
    let (target_x, target_z) = nav_target(bot, graph, bot_feet);
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
    use crate::world::SimWorld;

    const MAP_JSON: &str = include_str!("../../../assets/maps/de_douglas.json");
    const NAVNODES_JSON: &str = include_str!("../../../assets/maps/de_douglas.navnodes.json");

    fn setup() -> (SimWorld, NavGraph) {
        let mut world = SimWorld::new();
        crate::map::load(&mut world, MAP_JSON);
        world.ensure_broad_phase_ready();
        let graph = NavGraph::from_json(NAVNODES_JSON);
        (world, graph)
    }

    /// Bots must walk the navmesh, not straight-line between waypoint nodes.
    ///
    /// This is the whole point of routing through `nav.rs`: the 13-node graph
    /// still chooses the destination, but the *route* comes from the baked
    /// walkable surface, so a bot heading somewhere behind a wall follows the
    /// corridor instead of grinding into geometry ~12 m at a time.
    #[test]
    fn search_route_follows_the_navmesh_not_graph_hops() {
        let (mut world, graph) = setup();
        let (_b, coll) = world.add_player_body();
        let mut bot = Bot::new(0, 0);
        let feet = nalgebra::Vector3::new(-15.0, 0.05, -24.0);

        // Goal at the far spine end (node 7 = CT spawn).
        bot.path_goal_node = 7;
        let (tx, tz) = nav_target(&mut bot, &graph, &feet);

        assert!(!bot.path.is_empty(), "a navmesh route should have been computed");
        assert!(bot.path.len() > 2, "route should have intermediate waypoints, got {}", bot.path.len());

        // The immediate target must be a nearby corridor point, not the 12 m
        // graph hop the old code steered at.
        let d = ((tx - feet.x).powi(2) + (tz - feet.z).powi(2)).sqrt();
        assert!(d < 12.0, "next waypoint is {d:.1} m away — that is a graph hop, not a mesh route");

        let _ = coll;
    }

    /// The route must survive a missing navmesh: no mesh, no panic, and the bot
    /// still gets a heading from the nav graph.
    #[test]
    fn nav_target_falls_back_to_graph_hop_when_off_mesh() {
        let (_world, graph) = setup();
        let mut bot = Bot::new(0, 0);
        // Far outside the map: closest_tri finds nothing within tolerance, so
        // find_path returns empty and the graph hop has to carry it.
        let feet = nalgebra::Vector3::new(500.0, 400.0, 500.0);
        bot.path_goal_node = 7;
        let (tx, tz) = nav_target(&mut bot, &graph, &feet);
        assert!(bot.path.is_empty(), "no mesh route should exist out here");
        assert!(tx.is_finite() && tz.is_finite());
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
}
