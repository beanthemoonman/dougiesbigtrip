pub mod constants;
pub mod input;
pub mod map;
pub mod movement;
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
}
