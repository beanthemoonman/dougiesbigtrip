/// Source-style movement functions — pure math, ported from src/player/movement.ts.
/// All functions use f64 (nalgebra::Vector3<f64>) and are free of any Rapier or
/// world-state dependencies. They are the TS golden-tested formulas, bit-exact.
///
/// See docs/source-movement.md for the derivation of every formula here.
/// Do not "improve" — these are a port, not an invention.
use nalgebra::Vector3;

use crate::constants::*;

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
}
