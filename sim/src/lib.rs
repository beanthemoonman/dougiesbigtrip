pub mod ai;
pub mod constants;
pub mod damage;
pub mod hitbox;
pub mod input;
pub mod map;
pub mod movement;
pub mod nav;
pub mod nav_graph;
pub mod protocol;
pub mod rng;
pub mod shapecast;
pub mod world;

pub use rapier3d::prelude::{ColliderHandle, RigidBodyHandle};

// ---------------------------------------------------------------
// WASM bindings — re-exports for the browser side.
// ---------------------------------------------------------------

#[cfg(feature = "wasm")]
mod wasm_bindings {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn sim_greet() -> String {
        format!("sim v{} — ready", env!("CARGO_PKG_VERSION"))
    }

    #[wasm_bindgen]
    pub fn protocol_version() -> u8 {
        crate::protocol::PROTOCOL_VERSION
    }

    // --- Constants exposed to JS ---

    #[wasm_bindgen]
    pub fn get_tick_rate() -> f64 { crate::constants::TICK_RATE_HZ }

    #[wasm_bindgen]
    pub fn get_fixed_dt() -> f64 { crate::constants::FIXED_DT }

    #[wasm_bindgen]
    pub fn get_gravity() -> f64 { crate::constants::GRAVITY }

    #[wasm_bindgen]
    pub fn get_sv_accelerate() -> f64 { crate::constants::SV_ACCELERATE }

    #[wasm_bindgen]
    pub fn get_sv_airaccelerate() -> f64 { crate::constants::SV_AIRACCELERATE }

    #[wasm_bindgen]
    pub fn get_sv_friction() -> f64 { crate::constants::SV_FRICTION }

    #[wasm_bindgen]
    pub fn get_air_wishspeed_cap() -> f64 { crate::constants::AIR_WISHSPEED_CAP }

    #[wasm_bindgen]
    pub fn get_default_ground_speed() -> f64 { crate::constants::DEFAULT_GROUND_SPEED }

    #[wasm_bindgen]
    pub fn get_sv_maxspeed() -> f64 { crate::constants::SV_MAXSPEED }

    // --- Movement functions ---

    /// Apply ground friction to a velocity vector. Returns [x, y, z] of the modified velocity.
    #[wasm_bindgen]
    pub fn sim_friction(
        vel_x: f64, vel_y: f64, vel_z: f64,
        dt: f64,
        on_ground: bool,
        surface_friction: f64,
    ) -> Vec<f64> {
        let mut vel = nalgebra::Vector3::new(vel_x, vel_y, vel_z);
        crate::movement::friction(&mut vel, dt, on_ground, surface_friction);
        vec![vel.x, vel.y, vel.z]
    }

    /// Apply ground acceleration. Returns [x, y, z] of the modified velocity.
    #[wasm_bindgen]
    pub fn sim_accelerate(
        vel_x: f64, vel_y: f64, vel_z: f64,
        wishdir_x: f64, wishdir_y: f64, wishdir_z: f64,
        wishspeed: f64,
        accel: f64,
        dt: f64,
        surface_friction: f64,
    ) -> Vec<f64> {
        let mut vel = nalgebra::Vector3::new(vel_x, vel_y, vel_z);
        let wishdir = nalgebra::Vector3::new(wishdir_x, wishdir_y, wishdir_z);
        crate::movement::accelerate(&mut vel, &wishdir, wishspeed, accel, dt, surface_friction);
        vec![vel.x, vel.y, vel.z]
    }

    /// Apply air acceleration. Returns [x, y, z] of the modified velocity.
    #[wasm_bindgen]
    pub fn sim_air_accelerate(
        vel_x: f64, vel_y: f64, vel_z: f64,
        wishdir_x: f64, wishdir_y: f64, wishdir_z: f64,
        wishspeed: f64,
        accel: f64,
        dt: f64,
        surface_friction: f64,
    ) -> Vec<f64> {
        let mut vel = nalgebra::Vector3::new(vel_x, vel_y, vel_z);
        let wishdir = nalgebra::Vector3::new(wishdir_x, wishdir_y, wishdir_z);
        crate::movement::air_accelerate(&mut vel, &wishdir, wishspeed, accel, dt, surface_friction);
        vec![vel.x, vel.y, vel.z]
    }

    /// Clip velocity against a plane. Returns [x, y, z] of the reflected velocity.
    #[wasm_bindgen]
    pub fn sim_clip_velocity(
        vel_x: f64, vel_y: f64, vel_z: f64,
        normal_x: f64, normal_y: f64, normal_z: f64,
        overbounce: f64,
    ) -> Vec<f64> {
        let vel = nalgebra::Vector3::new(vel_x, vel_y, vel_z);
        let normal = nalgebra::Vector3::new(normal_x, normal_y, normal_z);
        let out = crate::movement::clip_velocity(&vel, &normal, overbounce);
        vec![out.x, out.y, out.z]
    }

    /// World-space wish direction from buttons and yaw.
    /// Returns [x, z] — y is always 0.
    #[wasm_bindgen]
    pub fn sim_wish_dir(buttons: u16, yaw: f64) -> Vec<f64> {
        let (x, z) = crate::input::wish_dir_from_buttons(buttons, yaw);
        vec![x, z]
    }

    // --- RNG ---
    // Note: RNG is stateful and will be exposed in 6.2 with the full sim tick.
    // For 6.1 parity, the pure functions are sufficient.

    // --- Full sim (6.2) ---

    use std::sync::Mutex;
    use crate::movement::{PlayerState, tick_movement};
    use crate::world::SimWorld;
    use crate::constants::FIXED_DT;

    static SIM: Mutex<Option<(SimWorld, Vec<PlayerState>)>> = Mutex::new(None);

    /// Initialise the simulation world and spawn the local player at index 0.
    /// Call this once at startup. On respawn, use sim_reset_player instead
    /// so that map colliders are preserved.
    #[wasm_bindgen]
    pub fn sim_init(spawn_x: f64, spawn_y: f64, spawn_z: f64) {
        let mut sim = SIM.lock().unwrap();
        let mut world = SimWorld::new();
        let state = PlayerState::new(spawn_x, spawn_y, spawn_z);
        // Sync the kinematic body to the initial position immediately.
        let rh = world.player_rigid_body_handle(0);
        let ch = world.player_collider_handle(0);
        world.sync_player_body(rh, ch, spawn_x, spawn_y, spawn_z, false);
        *sim = Some((world, vec![state]));
    }

    /// Add a player slot (e.g. for a bot) and return its index.
    /// The caller is responsible for remembering which index maps to which bot.
    /// Creates a kinematic body + collider in the physics world so shapecasts
    /// see this player as an obstacle (no more push-through).
    #[wasm_bindgen]
    pub fn sim_add_player(spawn_x: f64, spawn_y: f64, spawn_z: f64) -> u32 {
        let mut sim = SIM.lock().unwrap();
        if let Some((world, states)) = sim.as_mut() {
            let idx = states.len() as u32;
            let (rh, ch) = world.add_player_body();
            // Sync the new body to the spawn immediately so queries see it
            // before the first tick.
            world.sync_player_body(rh, ch, spawn_x, spawn_y, spawn_z, false);
            states.push(PlayerState::new(spawn_x, spawn_y, spawn_z));
            idx
        } else {
            0
        }
    }

    /// Remove a player slot. MUST be called from highest index downward
    /// to avoid invalidating other indices (bots.remove(index) slides later ones).
    /// Also removes the kinematic body from the world's body_handles vec;
    /// the Rapier bodies/colliders are orphaned (no clean-up API).
    #[wasm_bindgen]
    pub fn sim_remove_player(index: u32) {
        let mut sim = SIM.lock().unwrap();
        if let Some((world, states)) = sim.as_mut() {
            let i = index as usize;
            if i < states.len() {
                states.remove(i);
                world.remove_player_body(i);
            }
        }
    }

    /// Reset the player to a spawn position without destroying the world
    /// (preserves all map colliders). Syncs the kinematic body so queries
    /// see the player at the new spawn immediately.
    #[wasm_bindgen]
    pub fn sim_reset_player(index: u32, spawn_x: f64, spawn_y: f64, spawn_z: f64) {
        let mut sim = SIM.lock().unwrap();
        if let Some((world, states)) = sim.as_mut() {
            let i = index as usize;
            if i < states.len() {
                states[i].reset(spawn_x, spawn_y, spawn_z);
                let rh = world.player_rigid_body_handle(i);
                let ch = world.player_collider_handle(i);
                world.sync_player_body(rh, ch, spawn_x, spawn_y, spawn_z, false);
            }
        }
    }

    /// Add a static axis-aligned cuboid collider to the world.
    /// rotation_yaw in radians; 0 = axis-aligned.
    #[wasm_bindgen]
    pub fn sim_add_box(cx: f64, cy: f64, cz: f64, hx: f64, hy: f64, hz: f64, ry: f64) {
        let mut sim = SIM.lock().unwrap();
        if let Some((world, _)) = sim.as_mut() {
            world.add_static_box(cx, cy, cz, hx, hy, hz, ry);
        }
    }

    /// Add a prop (breakable or scenery) static collider keyed by TS placement
    /// index. On round-reset this re-enables a previously-disabled body rather
    /// than leaking a new one. Called once per prop at init and again per prop
    /// on round-reset restore.
    #[wasm_bindgen]
    pub fn sim_add_prop_box(
        index: u32,
        cx: f64, cy: f64, cz: f64,
        hx: f64, hy: f64, hz: f64,
        ry: f64,
    ) {
        let mut sim = SIM.lock().unwrap();
        if let Some((world, _)) = sim.as_mut() {
            world.add_prop_body(index as usize, cx, cy, cz, hx, hy, hz, ry);
        }
    }

    /// Disable a prop's body so it no longer blocks movement (destroyed / broken).
    #[wasm_bindgen]
    pub fn sim_disable_prop_box(index: u32) {
        let mut sim = SIM.lock().unwrap();
        if let Some((world, _)) = sim.as_mut() {
            world.disable_prop_body(index as usize);
        }
    }

    /// Add a ramp collider. start/end are the top-surface endpoints.
    #[wasm_bindgen]
    pub fn sim_add_ramp(
        sx: f64, sy: f64, sz: f64,
        ex: f64, ey: f64, ez: f64,
        width: f64,
        thickness: f64,
    ) {
        let mut sim = SIM.lock().unwrap();
        if let Some((world, _)) = sim.as_mut() {
            world.add_ramp(sx, sy, sz, ex, ey, ez, width, thickness);
        }
    }

    /// Tick a specific player by index (0 = human, 1+ = bots).
    /// Every player excludes its own collider from shapecasts so the capsule
    /// doesn't report hits against itself, but collides against all other
    /// players' capsules — no more push-through.
    /// Returns a flat array:
    /// [pos_x, pos_y, pos_z, vel_x, vel_y, vel_z, on_ground, eye_height, view_punch, duck_amount]
    #[wasm_bindgen]
    pub fn sim_tick(index: u32, buttons: u16, yaw: f64) -> Vec<f64> {
        let mut sim = SIM.lock().unwrap();
        match sim.as_mut() {
            Some((world, states)) => {
                let i = index as usize;
                if i >= states.len() {
                    return vec![];
                }
                let exclude = Some(world.player_collider_handle(i));
                tick_movement(world, &mut states[i], buttons, yaw, FIXED_DT, exclude);
                let s = &states[i];
                let rh = world.player_rigid_body_handle(i);
                let ch = world.player_collider_handle(i);
                world.sync_player_body(rh, ch, s.position.x, s.position.y, s.position.z, s.ducked);
                vec![
                    s.position.x, s.position.y, s.position.z,
                    s.velocity.x, s.velocity.y, s.velocity.z,
                    if s.on_ground { 1.0 } else { 0.0 },
                    s.eye_height,
                    s.view_punch,
                    s.duck_amount,
                ]
            }
            None => vec![],
        }
    }

    /// Snap a player to an authoritative net state (reconciliation anchor).
    /// Sets position, velocity, and duck state; on_ground and other fields are
    /// recomputed on the next tick. The client calls this with the server's
    /// state as-of ackSeq, then replays unacked commands via sim_tick.
    #[wasm_bindgen]
    pub fn sim_set_player(
        index: u32,
        px: f64, py: f64, pz: f64,
        vx: f64, vy: f64, vz: f64,
        ducked: bool,
    ) {
        let mut sim = SIM.lock().unwrap();
        if let Some((world, states)) = sim.as_mut() {
            let i = index as usize;
            if i < states.len() {
                let s = &mut states[i];
                s.position = nalgebra::Vector3::new(px, py, pz);
                s.velocity = nalgebra::Vector3::new(vx, vy, vz);
                s.ducked = ducked;
                let rh = world.player_rigid_body_handle(i);
                let ch = world.player_collider_handle(i);
                world.sync_player_body(rh, ch, px, py, pz, ducked);
            }
        }
    }

    /// Get current player state without ticking.
    /// Returns same array format as sim_tick.
    #[wasm_bindgen]
    pub fn sim_get_state(index: u32) -> Vec<f64> {
        let sim = SIM.lock().unwrap();
        match sim.as_ref() {
            Some((_, states)) => {
                let i = index as usize;
                if i >= states.len() {
                    return vec![];
                }
                let s = &states[i];
                vec![
                    s.position.x, s.position.y, s.position.z,
                    s.velocity.x, s.velocity.y, s.velocity.z,
                    if s.on_ground { 1.0 } else { 0.0 },
                    s.eye_height,
                    s.view_punch,
                    s.duck_amount,
                ]
            }
            None => vec![],
        }
    }

    // ---------------------------------------------------------------
    // Bot AI bindings (Phase E.4 — single-player bots via WASM)
    // ---------------------------------------------------------------

    use crate::ai::{Bot, BotMode, SearchState, tick_bot};
    use crate::nav_graph::NavGraph;

    struct BotGlobals {
        nav_graph: NavGraph,
        search: SearchState,
        bots: Vec<Option<Bot>>,
        teams: Vec<u8>,
    }

    static BOTS: Mutex<Option<BotGlobals>> = Mutex::new(None);

    /// Load the nav graph JSON and initialise shared search state.
    /// Must be called once before sim_add_bot.
    #[wasm_bindgen]
    pub fn sim_init_bots(json: &str) {
        let graph = NavGraph::from_json(json);
        let node_count = graph.node_count();
        *BOTS.lock().unwrap() = Some(BotGlobals {
            nav_graph: graph,
            search: SearchState::new(node_count),
            bots: Vec::new(),
            teams: Vec::new(),
        });
    }

    /// Add a bot player slot. Creates both a PlayerState (for movement) and a Bot
    /// (for AI). `team`: 0 = T, 1 = CT. Returns the slot index (same as wasm
    /// player index).
    #[wasm_bindgen]
    pub fn sim_add_bot(spawn_x: f64, spawn_y: f64, spawn_z: f64, tick_offset: u32, team: u8) -> u32 {
        let idx = sim_add_player(spawn_x, spawn_y, spawn_z);
        let i = idx as usize;
        let sim = SIM.lock().unwrap();
        let start_node = if let Some((_, states)) = sim.as_ref() {
            if let Some(s) = states.get(i) {
                let bots_lock = BOTS.lock().unwrap();
                if let Some(ref bg) = bots_lock.as_ref() {
                    bg.nav_graph.nearest_node(s.position.x, s.position.y, s.position.z)
                } else {
                    0
                }
            } else {
                0
            }
        } else {
            0
        };
        drop(sim);

        let mut bots_lock = BOTS.lock().unwrap();
        if let Some(ref mut bg) = bots_lock.as_mut() {
            while bg.bots.len() <= i {
                bg.bots.push(None);
                bg.teams.push(255);
            }
            bg.bots[i] = Some(Bot::new(start_node, tick_offset));
            bg.teams[i] = team;
        }
        idx
    }

    /// Remove a bot slot. Must be called from highest index downward.
    #[wasm_bindgen]
    pub fn sim_remove_bot(index: u32) {
        sim_remove_player(index);
        let i = index as usize;
        let mut bots_lock = BOTS.lock().unwrap();
        if let Some(ref mut bg) = bots_lock.as_mut() {
            if i < bg.bots.len() {
                bg.bots.remove(i);
                bg.teams.remove(i);
            }
        }
    }

    /// Tick a bot's AI FSM. Returns a flat array:
    /// [buttons, yaw, should_fire, aim_yaw, aim_pitch, mode]
    /// where mode: 0 = Search, 1 = Engage, 2 = Reposition, 3 = Dead.
    /// `alive` is a slice of u8: 1 = alive, 0 = dead, one per player slot.
    #[wasm_bindgen]
    pub fn sim_tick_bot(index: u32, server_tick: u32, alive: Vec<u8>) -> Vec<f64> {
        let i = index as usize;
        let sim_lock = SIM.lock().unwrap();
        let mut bots_lock = BOTS.lock().unwrap();

        let (world, states, bg) = match (
            sim_lock.as_ref(),
            bots_lock.as_mut(),
        ) {
            (Some((w, s)), Some(bg)) if i < s.len() && i < bg.bots.len() => (w, s, bg),
            _ => return vec![],
        };

        // Collect teammate goal nodes first (avoids borrowing bg.bots while
        // holding the mutable bot reference later).
        let n = states.len().min(bg.teams.len());
        let mut teammate_goals: Vec<usize> = Vec::new();
        for j in 0..n {
            if j == i { continue; }
            if let Some(Some(tb)) = bg.bots.get(j) {
                let same_team = bg.teams.get(j).copied().unwrap_or(255) == bg.teams.get(i).copied().unwrap_or(255);
                if same_team {
                    teammate_goals.push(tb.path_goal_node);
                }
            }
        }

        let bot = match bg.bots.get_mut(i) {
            Some(Some(b)) => b,
            _ => return vec![],
        };

        let team = bg.teams.get(i).copied().unwrap_or(255);
        let bot_collider = world.player_collider_handle(i);
        let bot_feet = states[i].position;

        // Build enemy positions (other team, alive, not self)
        let mut enemy_positions: Vec<Option<nalgebra::Vector3<f64>>> = vec![None; n];
        let mut teammate_positions: Vec<&nalgebra::Vector3<f64>> = Vec::new();

        for j in 0..n {
            if j == i { continue; }
            let other_team = bg.teams.get(j).copied().unwrap_or(255);
            let other_alive = alive.get(j).copied().unwrap_or(0) != 0;
            if other_alive && other_team != team {
                enemy_positions[j] = Some(states[j].position);
            }
            if other_alive && other_team == team {
                teammate_positions.push(&states[j].position);
            }
        }

        let alive_bools: Vec<bool> = alive.iter().map(|&a| a != 0).collect();
        let tm_refs: Vec<&nalgebra::Vector3<f64>> = teammate_positions;

        let (buttons, yaw) = tick_bot(
            bot,
            world,
            &bot_feet,
            bot_collider,
            &enemy_positions,
            &alive_bools,
            &bg.nav_graph,
            &mut bg.search,
            &tm_refs,
            &teammate_goals,
            server_tick,
        );

        let mode = match bot.mode {
            BotMode::Search => 0,
            BotMode::Engage => 1,
            BotMode::Reposition => 2,
            BotMode::Dead => 3,
        };
        let should_fire = if bot.should_fire { 1.0 } else { 0.0 };

        vec![
            buttons as f64,
            yaw,
            should_fire,
            bot.aim_yaw,
            bot.aim_pitch,
            mode as f64,
        ]
    }

    /// Kill a bot (set AI mode to Dead). The body stays in place.
    #[wasm_bindgen]
    pub fn sim_kill_bot(index: u32) {
        let i = index as usize;
        let mut bots_lock = BOTS.lock().unwrap();
        if let Some(ref mut bg) = bots_lock.as_mut() {
            if let Some(Some(bot)) = bg.bots.get_mut(i) {
                bot.mode = BotMode::Dead;
            }
        }
    }

    /// Reset a bot's AI for respawn. Repositions the player state and
    /// reinitialises bot FSM fields.
    #[wasm_bindgen]
    pub fn sim_reset_bot(index: u32, spawn_x: f64, spawn_y: f64, spawn_z: f64) {
        sim_reset_player(index, spawn_x, spawn_y, spawn_z);
        let i = index as usize;
        let mut bots_lock = BOTS.lock().unwrap();
        if let Some(ref mut bg) = bots_lock.as_mut() {
            if let Some(Some(bot)) = bg.bots.get_mut(i) {
                let node = bg.nav_graph.nearest_node(spawn_x, spawn_y, spawn_z);
                *bot = Bot::new(node, bot.tick_offset);
            }
        }
    }

    /// Get bot aim yaw for rendering.
    #[wasm_bindgen]
    pub fn sim_get_bot_aim_yaw(index: u32) -> f64 {
        let bots_lock = BOTS.lock().unwrap();
        if let Some(ref bg) = bots_lock.as_ref() {
            if let Some(Some(bot)) = bg.bots.get(index as usize) {
                return bot.aim_yaw;
            }
        }
        0.0
    }

    /// Get bot aim pitch for rendering.
    #[wasm_bindgen]
    pub fn sim_get_bot_aim_pitch(index: u32) -> f64 {
        let bots_lock = BOTS.lock().unwrap();
        if let Some(ref bg) = bots_lock.as_ref() {
            if let Some(Some(bot)) = bg.bots.get(index as usize) {
                return bot.aim_pitch;
            }
        }
        0.0
    }

    /// Get bot mode: 0 = Search, 1 = Engage, 2 = Reposition, 3 = Dead.
    #[wasm_bindgen]
    pub fn sim_get_bot_mode(index: u32) -> u8 {
        let bots_lock = BOTS.lock().unwrap();
        if let Some(ref bg) = bots_lock.as_ref() {
            if let Some(Some(bot)) = bg.bots.get(index as usize) {
                return match bot.mode {
                    BotMode::Search => 0,
                    BotMode::Engage => 1,
                    BotMode::Reposition => 2,
                    BotMode::Dead => 3,
                };
            }
        }
        3
    }

    /// True if the bot brain says it should fire this tick.
    #[wasm_bindgen]
    pub fn sim_get_bot_should_fire(index: u32) -> bool {
        let bots_lock = BOTS.lock().unwrap();
        if let Some(ref bg) = bots_lock.as_ref() {
            if let Some(Some(bot)) = bg.bots.get(index as usize) {
                return bot.should_fire;
            }
        }
        false
    }

    /// Deterministic per-shot miss-cone check. Returns true if the shot lands
    /// within the target's body radius at the given distance, given two
    /// [0,1) angular samples and an angular spread half-extent.
    #[wasm_bindgen]
    pub fn sim_bot_shot_lands(dist_m: f64, spread: f64, r1: f64, r2: f64, body_radius: f64) -> bool {
        crate::ai::aim::bot_shot_lands(dist_m, spread, r1, r2, body_radius)
    }

    /// Deterministic [0,1) hash — bit-identical to navnodes.ts::hash01.
    #[wasm_bindgen]
    pub fn sim_hash01(a: u32, b: u32) -> f64 {
        crate::ai::aim::hash01(a, b)
    }

    /// Get bot fire_cooldown for this slot. Returns remaining seconds.
    #[wasm_bindgen]
    pub fn sim_get_bot_fire_cooldown(index: u32) -> f64 {
        let bots_lock = BOTS.lock().unwrap();
        if let Some(ref bg) = bots_lock.as_ref() {
            if let Some(Some(bot)) = bg.bots.get(index as usize) {
                return bot.fire_cooldown;
            }
        }
        0.0
    }

    /// Set bot fire_cooldown. Call after synthesizing a shot.
    #[wasm_bindgen]
    pub fn sim_set_bot_fire_cooldown(index: u32, value: f64) {
        let mut bots_lock = BOTS.lock().unwrap();
        if let Some(ref mut bg) = bots_lock.as_mut() {
            if let Some(Some(bot)) = bg.bots.get_mut(index as usize) {
                bot.fire_cooldown = value;
                bot.should_fire = false;
            }
        }
    }

    /// Set the team for a player slot. `team`: 0 = T, 1 = CT, 255 = unset.
    #[wasm_bindgen]
    pub fn sim_set_team(index: u32, team: u8) {
        let mut bots_lock = BOTS.lock().unwrap();
        if let Some(ref mut bg) = bots_lock.as_mut() {
            let i = index as usize;
            while bg.teams.len() <= i {
                bg.teams.push(255);
            }
            bg.teams[i] = team;
        }
    }

    /// Get the target slot the bot is currently engaged with.
    /// Returns -1 if no target (searching, dead, etc).
    #[wasm_bindgen]
    pub fn sim_get_bot_target_slot(index: u32) -> i32 {
        let bots_lock = BOTS.lock().unwrap();
        if let Some(ref bg) = bots_lock.as_ref() {
            if let Some(Some(bot)) = bg.bots.get(index as usize) {
                return bot.target_slot.map(|s| s as i32).unwrap_or(-1);
            }
        }
        -1
    }

    /// Get the bot's last-known enemy position (feet).
    /// Returns [x, y, z] or empty vec if no last-known.
    #[wasm_bindgen]
    pub fn sim_get_bot_last_known(index: u32) -> Vec<f64> {
        let bots_lock = BOTS.lock().unwrap();
        if let Some(ref bg) = bots_lock.as_ref() {
            if let Some(Some(bot)) = bg.bots.get(index as usize) {
                if let Some(ref lk) = bot.last_known {
                    return vec![lk.x, lk.y, lk.z];
                }
            }
        }
        vec![]
    }
}
