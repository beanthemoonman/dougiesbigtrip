pub mod constants;
pub mod input;
pub mod movement;
pub mod protocol;
pub mod rng;
pub mod shapecast;
pub mod world;

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
}
