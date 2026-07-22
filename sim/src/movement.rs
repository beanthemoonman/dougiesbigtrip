/// Source-style movement functions — pure math + world-touching collide-and-slide.
/// Pure functions use f64 (nalgebra::Vector3<f64>) and are the TS golden-tested
/// formulas, bit-exact. The world-touching section wraps Rapier shapecasts and
/// ports the full tickMovement loop from src/player/movement.ts.
///
/// See docs/source-movement.md for the derivation of every formula here.
/// Do not "improve" — these are a port, not an invention.
use nalgebra::Vector3;
use rapier3d::prelude::ColliderHandle;

use crate::constants::*;
use crate::input::Buttons;
use crate::shapecast;
use crate::world::SimWorld;

/// Ground friction. Note: below the 0.1 speed floor this returns WITHOUT zeroing
/// velocity — that's Source's behaviour, not a bug.
pub fn friction(
    vel: &mut Vector3<f64>,
    dt: f64,
    on_ground: bool,
    surface_friction: f64,
) {
    let speed = vel.norm();
    if speed < FRICTION_SPEED_FLOOR {
        return;
    }

    let mut drop: f64 = 0.0;
    if on_ground {
        let friction_amount = SV_FRICTION * surface_friction;
        let control = if speed < SV_STOPSPEED {
            SV_STOPSPEED
        } else {
            speed
        };
        drop += control * friction_amount * dt;
    }

    let mut newspeed = speed - drop;
    if newspeed < 0.0 {
        newspeed = 0.0;
    }
    if (newspeed - speed).abs() > 1e-15 {
        *vel *= newspeed / speed;
    }
}

/// Ground acceleration. Caps the projection of velocity onto wishdir, not the
/// velocity magnitude.
pub fn accelerate(
    vel: &mut Vector3<f64>,
    wishdir: &Vector3<f64>,
    wishspeed: f64,
    accel: f64,
    dt: f64,
    surface_friction: f64,
) {
    let currentspeed = vel.dot(wishdir);
    let addspeed = wishspeed - currentspeed;
    if addspeed <= 0.0 {
        return;
    }

    let mut accelspeed = accel * dt * wishspeed * surface_friction;
    if accelspeed > addspeed {
        accelspeed = addspeed;
    }

    *vel += wishdir * accelspeed;
}

/// Air acceleration — the important one. The target speed used for `addspeed`
/// is clamped to AIR_WISHSPEED_CAP, but the acceleration amount is computed
/// from the UNCLAMPED wishspeed. Do not "simplify" this by making both use the
/// same variable — this asymmetry is the entire reason air-strafing exists.
pub fn air_accelerate(
    vel: &mut Vector3<f64>,
    wishdir: &Vector3<f64>,
    wishspeed: f64,
    accel: f64,
    dt: f64,
    surface_friction: f64,
) {
    let wishspd = if wishspeed > AIR_WISHSPEED_CAP {
        AIR_WISHSPEED_CAP
    } else {
        wishspeed
    };

    let currentspeed = vel.dot(wishdir);
    let addspeed = wishspd - currentspeed; // uses CLAMPED wishspd
    if addspeed <= 0.0 {
        return;
    }

    let mut accelspeed = accel * wishspeed * dt * surface_friction; // uses UNCLAMPED wishspeed
    if accelspeed > addspeed {
        accelspeed = addspeed;
    }

    *vel += wishdir * accelspeed;
}

/// Reflects `vin` off `normal`, safe to call with `out` pointing to `vin`.
pub fn clip_velocity(
    vin: &Vector3<f64>,
    normal: &Vector3<f64>,
    overbounce: f64,
) -> Vector3<f64> {
    let backoff = vin.dot(normal) * overbounce;
    let mut out = vin - normal * backoff;

    // Numerical safety pass: make sure we're not still moving into the plane.
    let adjust = out.dot(normal);
    if adjust < 0.0 {
        out += normal * (-adjust);
    }

    out
}

// ---------------------------------------------------------------------------
// World-touching state and functions.
// ---------------------------------------------------------------------------

pub struct PlayerState {
    pub position: Vector3<f64>,
    pub velocity: Vector3<f64>,
    pub on_ground: bool,
    pub ground_normal: Vector3<f64>,
    pub ducked: bool,
    pub duck_amount: f64,
    pub jump_held: bool,
    pub eye_height: f64,
    pub view_punch: f64,
}

impl PlayerState {
    pub fn new(spawn_x: f64, spawn_y: f64, spawn_z: f64) -> Self {
        Self {
            position: Vector3::new(spawn_x, spawn_y, spawn_z),
            velocity: Vector3::zeros(),
            on_ground: false,
            ground_normal: Vector3::new(0.0, 1.0, 0.0),
            ducked: false,
            duck_amount: 0.0,
            jump_held: false,
            eye_height: EYE_HEIGHT_STANDING,
            view_punch: 0.0,
        }
    }

    pub fn reset(&mut self, spawn_x: f64, spawn_y: f64, spawn_z: f64) {
        self.position = Vector3::new(spawn_x, spawn_y, spawn_z);
        self.velocity = Vector3::zeros();
        self.on_ground = false;
        self.ground_normal = Vector3::new(0.0, 1.0, 0.0);
        self.ducked = false;
        self.duck_amount = 0.0;
        self.jump_held = false;
        self.eye_height = EYE_HEIGHT_STANDING;
        self.view_punch = 0.0;
    }
}

fn capsule_center_from_feet(feet: &Vector3<f64>, half_height: f64, radius: f64) -> Vector3<f64> {
    Vector3::new(feet.x, feet.y + half_height + radius, feet.z)
}

fn horizontal_dist_sq(a: &Vector3<f64>, b: &Vector3<f64>) -> f64 {
    let dx = a.x - b.x;
    let dz = a.z - b.z;
    dx * dx + dz * dz
}

fn categorize_position(
    world: &SimWorld,
    half_height: f64,
    radius: f64,
    feet: &Vector3<f64>,
    out_normal: &mut Vector3<f64>,
    exclude: Option<ColliderHandle>,
) -> bool {
    let center = capsule_center_from_feet(feet, half_height, radius);
    let mut hit_normal = Vector3::zeros();

    // Always use standing_shape for ground probe — shape is identity-rotated
    // Y-up capsule with the same radius, just different half-height. The
    // half-height difference doesn't matter for a straight-down probe; using
    // the standing shape avoids tracking which shape to pass.
    let fraction = shapecast::capsule_cast(
        &world.physics,
        &*world.standing_shape,
        center.x, center.y, center.z,
        0.0, -GROUND_TRACE_DISTANCE, 0.0,
        &mut hit_normal,
        exclude,
        true, // stop_at_penetration for ground probe
    );
    match fraction {
        Some(_) => {
            *out_normal = hit_normal;
            out_normal.y >= GROUND_NORMAL_THRESHOLD
        }
        None => false,
    }
}

fn trace_straight(
    world: &SimWorld,
    half_height: f64,
    radius: f64,
    feet: &mut Vector3<f64>,
    displacement: &Vector3<f64>,
    out_normal: &mut Vector3<f64>,
    exclude: Option<ColliderHandle>,
) -> Option<f64> {
    let center = capsule_center_from_feet(feet, half_height, radius);

    let fraction = shapecast::capsule_cast(
        &world.physics,
        &*world.standing_shape,
        center.x, center.y, center.z,
        displacement.x, displacement.y, displacement.z,
        out_normal,
        exclude,
        false, // stop_at_penetration false for sliding
    );
    match fraction {
        Some(f) => {
            *feet += displacement * (f * 0.99);
            Some(f)
        }
        None => {
            *feet += displacement;
            None
        }
    }
}

/// Collide-and-slide. Mutates `feet`/`velocity` in place. 4 iterations, 5 max
/// clip planes, crease-handling for the 2-plane case — see docs/source-movement.md.
fn try_player_move(
    world: &SimWorld,
    half_height: f64,
    radius: f64,
    feet: &mut Vector3<f64>,
    velocity: &mut Vector3<f64>,
    dt: f64,
    exclude: Option<ColliderHandle>,
) {
    let mut remaining = dt;
    let mut plane_count: usize = 0;
    let mut clip_planes: [Vector3<f64>; MAX_CLIP_PLANES] = [
        Vector3::zeros(),
        Vector3::zeros(),
        Vector3::zeros(),
        Vector3::zeros(),
        Vector3::zeros(),
    ];

    for _iter in 0..CLIP_ITERATIONS {
        if velocity.norm_squared() < 1e-16 {
            break;
        }

        let displacement = *velocity * remaining;
        let center = capsule_center_from_feet(feet, half_height, radius);

        let mut hit_normal = Vector3::zeros();

        let fraction = shapecast::capsule_cast(
            &world.physics,
            &*world.standing_shape,
            center.x, center.y, center.z,
            displacement.x, displacement.y, displacement.z,
            &mut hit_normal,
            exclude,
            false, // stop_at_penetration false for slide
        );

        match fraction {
            None => {
                *feet += *velocity * remaining;
                break;
            }
            Some(f) => {
                *feet += displacement * (f * 0.99);
                remaining *= 1.0 - f;

                if plane_count >= MAX_CLIP_PLANES {
                    *velocity = Vector3::zeros();
                    break;
                }
                clip_planes[plane_count] = hit_normal;
                plane_count += 1;

                if plane_count == 1 {
                    *velocity = clip_velocity(velocity, &clip_planes[0], OVERBOUNCE);
                } else {
                    let mut found = false;
                    for j in 0..plane_count {
                        let clipped = clip_velocity(velocity, &clip_planes[j], OVERBOUNCE);
                        let mut valid = true;
                        for k in 0..plane_count {
                            if k == j {
                                continue;
                            }
                            if clipped.dot(&clip_planes[k]) < 0.0 {
                                valid = false;
                                break;
                            }
                        }
                        if valid {
                            *velocity = clipped;
                            found = true;
                            break;
                        }
                    }
                    if !found {
                        if plane_count == 2 {
                            let crease = clip_planes[0].cross(&clip_planes[1]);
                            let crease_norm = match crease.try_normalize(1e-8) {
                                Some(n) => n,
                                None => {
                                    *velocity = Vector3::zeros();
                                    break;
                                }
                            };
                            let speed = crease_norm.dot(velocity);
                            *velocity = crease_norm * speed;
                        } else {
                            *velocity = Vector3::zeros();
                            break;
                        }
                    }
                }
            }
        }
    }
}

/// Source's three-trace stair dance. Only valid when on_ground — running it
/// in the air lets players climb walls.
fn step_move(
    world: &SimWorld,
    half_height: f64,
    radius: f64,
    state: &mut PlayerState,
    dt: f64,
    exclude: Option<ColliderHandle>,
) {
    let start_pos = state.position;

    // Trace 1: down path
    let mut down_pos = start_pos;
    let mut down_vel = state.velocity;
    try_player_move(world, half_height, radius, &mut down_pos, &mut down_vel, dt, exclude);

    // Trace 2: step up
    let mut up_pos = start_pos;
    let step_disp = Vector3::new(0.0, STEP_HEIGHT, 0.0);
    let mut dummy_normal = Vector3::zeros();
    trace_straight(world, half_height, radius, &mut up_pos, &step_disp, &mut dummy_normal, exclude);

    let mut up_vel = state.velocity;
    try_player_move(world, half_height, radius, &mut up_pos, &mut up_vel, dt, exclude);

    // Trace 3: step down
    let step_down = Vector3::new(0.0, -STEP_HEIGHT, 0.0);
    let mut down_normal = Vector3::zeros();
    let down_fraction = trace_straight(
        world, half_height, radius,
        &mut up_pos, &step_down,
        &mut down_normal,
        exclude,
    );
    let walkable = down_fraction.is_some() && down_normal.y >= GROUND_NORMAL_THRESHOLD;

    let flat_dist_sq = horizontal_dist_sq(&start_pos, &down_pos);
    let stepped_dist_sq = horizontal_dist_sq(&start_pos, &up_pos);

    if walkable && stepped_dist_sq > flat_dist_sq {
        state.position = up_pos;
        state.velocity = up_vel;
    } else {
        state.position = down_pos;
        state.velocity = down_vel;
    }
}

fn handle_duck(
    world: &SimWorld,
    state: &mut PlayerState,
    want_duck: bool,
    on_ground: bool,
    dt: f64,
    exclude: Option<ColliderHandle>,
) {
    if want_duck && !state.ducked {
        if !on_ground {
            state.position.y += DUCK_HEIGHT_DELTA;
        }
        state.ducked = true;
    } else if !want_duck && state.ducked {
        let candidate_y = if on_ground {
            state.position.y
        } else {
            state.position.y - DUCK_HEIGHT_DELTA
        };
        let check_feet = Vector3::new(state.position.x, candidate_y, state.position.z);
        let check_center = capsule_center_from_feet(&check_feet, STANDING_HALF_HEIGHT, PLAYER_RADIUS);

        let blocked = shapecast::capsule_overlaps_anything(
            &world.physics,
            &*world.standing_shape,
            check_center.x, check_center.y, check_center.z,
            exclude,
        );
        if !blocked {
            state.position.y = candidate_y;
            state.ducked = false;
        }
    }

    let target: f64 = if state.ducked { 1.0 } else { 0.0 };
    let rate = dt / DUCK_TRANSITION_TIME;
    if state.duck_amount < target {
        state.duck_amount = (target).min(state.duck_amount + rate);
    } else if state.duck_amount > target {
        state.duck_amount = (target).max(state.duck_amount - rate);
    }

    state.eye_height = EYE_HEIGHT_STANDING + (EYE_HEIGHT_DUCKED - EYE_HEIGHT_STANDING) * state.duck_amount;
}

fn check_jump(state: &mut PlayerState, jump_pressed: bool) {
    if !jump_pressed {
        state.jump_held = false;
    }
    if jump_pressed && state.on_ground && !state.jump_held {
        state.velocity.y = JUMP_IMPULSE;
        state.on_ground = false;
        state.jump_held = true;
    }
}

/// Advances `state` by exactly `dt` seconds, following the per-tick order of
/// operations in docs/source-movement.md. Call at TICK_RATE (64 Hz), never at
/// render framerate.
pub fn tick_movement(
    world: &mut SimWorld,
    state: &mut PlayerState,
    buttons: u16,
    yaw: f64,
    dt: f64,
    exclude: Option<ColliderHandle>,
) {
    world.ensure_broad_phase_ready();
    let (wish_x, wish_z) = crate::input::wish_dir_from_buttons(buttons, yaw);
    let wishdir = Vector3::new(wish_x, 0.0, wish_z);

    let half_height = if state.ducked {
        DUCKED_HALF_HEIGHT
    } else {
        STANDING_HALF_HEIGHT
    };

    let mut ground_normal = Vector3::zeros();
    let grounded_at_start =
        categorize_position(world, half_height, PLAYER_RADIUS, &state.position, &mut ground_normal, exclude);
    state.on_ground = grounded_at_start;
    if grounded_at_start {
        state.ground_normal = ground_normal;
    } else {
        state.ground_normal = Vector3::new(0.0, 1.0, 0.0);
    }

    let want_duck = (buttons & crate::input::Buttons::DUCK) != 0;
    handle_duck(world, state, want_duck, state.on_ground, dt, exclude);

    let jump_pressed = (buttons & crate::input::Buttons::JUMP) != 0;
    check_jump(state, jump_pressed);

    if state.on_ground {
        friction(&mut state.velocity, dt, true, DEFAULT_SURFACE_FRICTION);
    }

    let mut wishspeed = DEFAULT_GROUND_SPEED.min(SV_MAXSPEED);
    if state.on_ground && (buttons & Buttons::WALK) != 0 {
        wishspeed *= WALK_SPEED_SCALE;
    }
    if state.on_ground && (buttons & Buttons::DUCK) != 0 {
        wishspeed *= DUCK_SPEED_SCALE;
    }
    if state.on_ground {
        accelerate(
            &mut state.velocity,
            &wishdir,
            wishspeed,
            SV_ACCELERATE,
            dt,
            DEFAULT_SURFACE_FRICTION,
        );
    } else {
        air_accelerate(
            &mut state.velocity,
            &wishdir,
            wishspeed,
            SV_AIRACCELERATE,
            dt,
            DEFAULT_SURFACE_FRICTION,
        );
    }

    if !state.on_ground {
        state.velocity.y -= GRAVITY * dt;
    }

    let pre_move_vel_y = state.velocity.y;
    // Re-evaluate half_height after possible duck state change
    let half_height = if state.ducked {
        DUCKED_HALF_HEIGHT
    } else {
        STANDING_HALF_HEIGHT
    };

    if state.on_ground {
        step_move(world, half_height, PLAYER_RADIUS, state, dt, exclude);
    } else {
        try_player_move(world, half_height, PLAYER_RADIUS, &mut state.position, &mut state.velocity, dt, exclude);
    }

    let mut post_ground_normal = Vector3::zeros();
    let grounded_after = categorize_position(
        world,
        half_height,
        PLAYER_RADIUS,
        &state.position,
        &mut post_ground_normal,
        exclude,
    );
    state.on_ground = grounded_after;
    if grounded_after {
        state.ground_normal = post_ground_normal;
    }

    if grounded_after && !grounded_at_start {
        let impact_speed = (-pre_move_vel_y).max(0.0);
        state.view_punch = (MAX_VIEW_PUNCH)
            .min(state.view_punch + impact_speed * VIEW_PUNCH_PER_MPS);
    }
    state.view_punch = (0.0f64).max(state.view_punch - state.view_punch * VIEW_PUNCH_DECAY_RATE * dt);

    // Dead-stop check: if on ground, no wishdir input, and speed is bottled in
    // the friction dead zone (speed < 0.1), zero velocity to eliminate residual
    // creep (Phase 10.0). Accelerate is blocked from pulling speed out when input
    // IS held — this only triggers when the player has released all movement keys.
    let has_input = wish_x != 0.0 || wish_z != 0.0;
    if state.on_ground && !has_input && state.velocity.norm() < 0.1 {
        state.velocity = Vector3::zeros();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::Vector3;

    const DT: f64 = 1.0 / 64.0;
    const WISHSPEED: f64 = 6.35;

    #[test]
    fn case_a_ground_accel_from_rest() {
        let wishdir = Vector3::new(1.0, 0.0, 0.0);
        let mut vel = Vector3::new(0.0, 0.0, 0.0);
        let expected = [0.49609, 0.83344, 1.17078, 1.50813, 1.84547];

        for &target in &expected {
            friction(&mut vel, DT, true, 1.0);
            accelerate(&mut vel, &wishdir, WISHSPEED, SV_ACCELERATE, DT, 1.0);
            assert!(
                (vel.norm() - target).abs() < 1e-4,
                "expected {target}, got {}",
                vel.norm()
            );
        }
    }

    #[test]
    fn case_a_converges_to_wishspeed() {
        let wishdir = Vector3::new(1.0, 0.0, 0.0);
        let mut vel = Vector3::new(0.0, 0.0, 0.0);
        for _ in 0..500 {
            friction(&mut vel, DT, true, 1.0);
            accelerate(&mut vel, &wishdir, WISHSPEED, SV_ACCELERATE, DT, 1.0);
        }
        assert!((vel.norm() - WISHSPEED).abs() < 1e-5);
    }

    #[test]
    fn case_b_friction_decel() {
        let mut vel = Vector3::new(6.35, 0.0, 0.0);
        let expected = [5.95313, 5.58105, 5.23223, 4.90522, 4.59864];

        for &target in &expected {
            friction(&mut vel, DT, true, 1.0);
            assert!(
                (vel.norm() - target).abs() < 1e-4,
                "expected {target}, got {}",
                vel.norm()
            );
        }
    }

    #[test]
    fn air_accelerate_asymmetry_grows_speed() {
        let mut vel = Vector3::new(10.0, 0.0, 0.0); // well above both caps
        let wishdir = Vector3::new(0.0, 0.0, 1.0); // perpendicular to vel
        let before = vel.norm();

        air_accelerate(&mut vel, &wishdir, WISHSPEED, SV_AIRACCELERATE, DT, 1.0);

        assert!(vel.norm() > before, "perpendicular addition must grow the vector");
        assert!((vel.x - 10.0).abs() < 1e-6, "forward component untouched");
        assert!(vel.z > 0.0, "gained speed in wishdir direction");
    }

    #[test]
    fn air_accelerate_nothing_at_cap() {
        let mut vel = Vector3::new(0.762, 0.0, 0.0);
        let wishdir = Vector3::new(1.0, 0.0, 0.0);
        air_accelerate(&mut vel, &wishdir, WISHSPEED, SV_AIRACCELERATE, DT, 1.0);
        assert!((vel.x - 0.762).abs() < 1e-6);
    }

    #[test]
    fn clip_velocity_removes_into_plane() {
        let vel = Vector3::new(1.0, -1.0, 0.0);
        let normal = Vector3::new(0.0, 1.0, 0.0);
        let out = clip_velocity(&vel, &normal, OVERBOUNCE);
        assert!((out.x - 1.0).abs() < 1e-6);
        assert!(out.y.abs() < 1e-12); // downward component removed
    }

    #[test]
    fn clip_velocity_safety_pass() {
        let vel = Vector3::new(0.0, -5.0, 0.0);
        let normal = Vector3::new(0.6, 0.8, 0.0);
        let out = clip_velocity(&vel, &normal, OVERBOUNCE);
        assert!(out.dot(&normal) >= -1e-9, "must not move into plane");
    }

    #[test]
    fn air_strafe_snapshot() {
        let mut vel = Vector3::new(WISHSPEED, 0.0, 0.0);
        let mut heading = vel.z.atan2(vel.x);
        let turn_rate = std::f64::consts::PI; // 180 deg/s
        let mut speeds: Vec<f64> = Vec::with_capacity(128);

        for _ in 0..128 {
            heading += turn_rate * DT;
            let wishdir = Vector3::new(heading.cos(), 0.0, heading.sin());
            air_accelerate(&mut vel, &wishdir, WISHSPEED, SV_AIRACCELERATE, DT, 1.0);
            speeds.push(vel.norm());
        }

        let first = speeds[0];
        let last = speeds[speeds.len() - 1];
        assert!(last > WISHSPEED);
        assert!(last > first);

        // Check against the frozen TS snapshot (same 128-tick sequence).
        // The TS snap rounds to 3 decimal places — verify matching rounded values.
        let ts_snapshot: [f64; 128] = [
            6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35,
            6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35,
            6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.365,
            6.395, 6.424, 6.454, 6.483, 6.513, 6.542, 6.571, 6.601, 6.63, 6.659,
            6.689, 6.718, 6.747, 6.776, 6.805, 6.834, 6.863, 6.892, 6.921, 6.95,
            6.979, 7.008, 7.037, 7.065, 7.094, 7.123, 7.152, 7.18, 7.209, 7.238,
            7.266, 7.295, 7.323, 7.352, 7.38, 7.408, 7.437, 7.465, 7.493, 7.522,
            7.55, 7.578, 7.606, 7.634, 7.662, 7.691, 7.719, 7.747, 7.775, 7.802,
            7.83, 7.858, 7.886, 7.914, 7.942, 7.969, 7.997, 8.025, 8.052, 8.08,
            8.108, 8.135, 8.163, 8.19, 8.218, 8.245, 8.272, 8.3, 8.327, 8.354,
            8.382, 8.409, 8.436, 8.463, 8.49, 8.517, 8.544, 8.572, 8.599, 8.625,
            8.652, 8.679, 8.706, 8.733, 8.76, 8.787, 8.813, 8.84, 8.867, 8.893,
            8.92, 8.947, 8.973, 9.0, 9.026, 9.053, 9.079, 9.105,
        ];

        for (i, (&actual, &expected)) in speeds.iter().zip(ts_snapshot.iter()).enumerate() {
            assert!(
                (actual - expected).abs() < 0.001,
                "tick {i}: expected {expected}, got {actual:.3}"
            );
        }
    }

    #[test]
    fn creep_friction_returns_below_floor() {
        let mut vel = Vector3::new(0.05, 0.0, 0.0);
        friction(&mut vel, DT, true, 1.0);
        assert!((vel.norm() - 0.05).abs() < 1e-8); // unchanged — friction returns early
    }

    #[test]
    fn creep_friction_processes_at_threshold() {
        // 0.1 is NOT less than 0.1, so friction processes it.
        // drops 0.15875 (stopspeed floor) → zeroes.
        let mut vel = Vector3::new(0.1, 0.0, 0.0);
        friction(&mut vel, DT, true, 1.0);
        assert_eq!(vel.norm(), 0.0);
    }

    #[test]
    fn creep_friction_decays_above_threshold() {
        let mut vel = Vector3::new(0.5, 0.0, 0.0);
        friction(&mut vel, DT, true, 1.0);
        assert!(vel.norm() > 0.0);
        assert!(vel.norm() < 0.5);
    }

    #[test]
    fn creep_residual_below_floor() {
        let mut vel = Vector3::new(0.16, 0.0, 0.0);
        friction(&mut vel, DT, true, 1.0);
        assert!(vel.norm() > 0.0);
        assert!(vel.norm() < 0.1);
    }

    #[test]
    fn walk_speed_converges() {
        let wishdir = Vector3::new(1.0, 0.0, 0.0);
        let target = WISHSPEED * WALK_SPEED_SCALE;
        let mut vel = Vector3::zeros();
        for _ in 0..500 {
            friction(&mut vel, DT, true, 1.0);
            accelerate(&mut vel, &wishdir, target, SV_ACCELERATE, DT, 1.0);
        }
        assert!((vel.norm() - target).abs() < 1e-4);
    }

    #[test]
    fn duck_speed_converges() {
        let wishdir = Vector3::new(1.0, 0.0, 0.0);
        let target = WISHSPEED * DUCK_SPEED_SCALE;
        let mut vel = Vector3::zeros();
        for _ in 0..500 {
            friction(&mut vel, DT, true, 1.0);
            accelerate(&mut vel, &wishdir, target, SV_ACCELERATE, DT, 1.0);
        }
        assert!((vel.norm() - target).abs() < 1e-4);
    }

    #[test]
    fn walk_plus_duck_speed_stacks() {
        // Low wishspeed (~1.12 m/s) oscillates with the stopspeed floor.
        // The cap is applied correctly but doesn't converge cleanly.
        let wishdir = Vector3::new(1.0, 0.0, 0.0);
        let target = WISHSPEED * WALK_SPEED_SCALE * DUCK_SPEED_SCALE;
        let mut vel = Vector3::zeros();
        for _ in 0..500 {
            friction(&mut vel, DT, true, 1.0);
            accelerate(&mut vel, &wishdir, target, SV_ACCELERATE, DT, 1.0);
        }
        assert!(vel.norm() > 0.0);
        assert!(vel.norm() <= target);
    }
}

#[cfg(test)]
mod world_tests {
    use super::*;

    #[test]
    fn player_lands_on_floor() {
        let mut world = SimWorld::new();
        let mut state = PlayerState::new(0.0, 0.03, 0.0);

        world.add_static_box(0.0, -0.5, 0.0, 50.0, 0.5, 50.0, 0.0);

        let exclude = Some(world.player_collider_handle(0));
        for _ in 0..32 {
            tick_movement(&mut world, &mut state, 0, 0.0, FIXED_DT, exclude);
        }

        assert!(state.on_ground, "player should be on ground after falling");
        assert!(state.position.y >= -0.02 && state.position.y < 0.1,
                "feet y={} should be near 0", state.position.y);
        assert!(state.velocity.y.abs() < 1.0,
                "vel.y={} should be near 0 after landing", state.velocity.y);
    }

    #[test]
    fn player_moves_forward_on_ground() {
        let mut world = SimWorld::new();
        let mut state = PlayerState::new(0.0, 0.03, 0.0);

        world.add_static_box(0.0, -0.5, 0.0, 50.0, 0.5, 50.0, 0.0);

        let exclude = Some(world.player_collider_handle(0));
        for _ in 0..32 {
            tick_movement(&mut world, &mut state, 0, 0.0, FIXED_DT, exclude);
        }
        assert!(state.on_ground, "should be grounded before movement");

        for _ in 0..32 {
            tick_movement(&mut world, &mut state, 8, 0.0, FIXED_DT, exclude);
        }

        assert!(state.on_ground, "should still be on ground");
        assert!(state.position.x > 0.5, "should have moved forward: x={}", state.position.x);
        assert!(state.position.z.abs() < 0.1, "should have no lateral drift: z={}", state.position.z);
    }
}
