//! Aim utilities: turn-rate-capped angle stepping and deterministic hash.
//! Phase E.2 — extracted from server/src/ai.rs into sim/ for WASM-share.
//! Phase E.3 — added onTarget, botShotLands, desiredYawPitch for combat parity.

use super::perception::angle_delta;

/// Step current angle toward target by at most max_step radians,
/// wrapping at ±π.
pub(crate) fn step_angle(current: f64, target: f64, max_step: f64) -> f64 {
    let d = angle_delta(current, target);
    if d.abs() <= max_step { target } else { current + d.signum() * max_step }
}

/// True once the view is within `tol` rad of the desired angles on both axes.
pub fn on_target(current_yaw: f64, current_pitch: f64, desired_yaw: f64, desired_pitch: f64, tol: f64) -> bool {
    angle_delta(current_yaw, desired_yaw).abs() <= tol && (current_pitch - desired_pitch).abs() <= tol
}

/// Per-shot angular miss check. Projects a spread cone onto the target plane
/// at distance `dist_m`; the shot connects only if it falls within `body_radius`.
/// r1, r2 ∈ [0,1) are the two angular samples (deterministic hash outputs).
pub fn bot_shot_lands(dist_m: f64, spread: f64, r1: f64, r2: f64, body_radius: f64) -> bool {
    let ax = (r1 - 0.5) * 2.0 * spread;
    let ay = (r2 - 0.5) * 2.0 * spread;
    dist_m * (ax * ax + ay * ay).sqrt() <= body_radius
}

/// Exact yaw and pitch to look from `from_eye` at `target`.
pub fn desired_yaw_pitch(from_eye: &nalgebra::Vector3<f64>, target: &nalgebra::Vector3<f64>) -> (f64, f64) {
    let dir = (target - from_eye).normalize();
    let pitch = dir.y.clamp(-1.0, 1.0).asin();
    let yaw = (-dir.x).atan2(-dir.z);
    (yaw, pitch)
}

/// Rotate both yaw and pitch toward their desired values, capped to `turn_rate` rad/s.
pub fn step_aim(
    yaw: f64, pitch: f64,
    desired_yaw: f64, desired_pitch: f64,
    turn_rate: f64, dt: f64,
) -> (f64, f64) {
    let max_step = turn_rate * dt;
    let new_yaw = step_angle(yaw, desired_yaw, max_step);
    let new_pitch = step_angle(pitch, desired_pitch, max_step);
    (new_yaw, new_pitch)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash01_is_deterministic() {
        let v1 = hash01(42, 17);
        let v2 = hash01(42, 17);
        assert_eq!(v1, v2, "hash01 must be deterministic for the same inputs");
        assert!(v1 >= 0.0 && v1 < 1.0);
    }

    #[test]
    fn hash01_differs_by_input() {
        let a = hash01(1, 1);
        let b = hash01(1, 2);
        let c = hash01(2, 1);
        assert_ne!(a, b);
        assert_ne!(b, c);
        assert_ne!(a, c);
    }

    #[test]
    fn on_target_exact() {
        assert!(on_target(0.0, 0.0, 0.0, 0.0, 0.05));
    }

    #[test]
    fn on_target_within_tolerance() {
        assert!(on_target(0.03, 0.03, 0.0, 0.0, 0.05));
    }

    #[test]
    fn on_target_yaw_exceeds_tolerance() {
        assert!(!on_target(0.06, 0.0, 0.0, 0.0, 0.05));
    }

    #[test]
    fn on_target_wraps_yaw() {
        // PI and -PI+0.03 are ~0.03 rad apart when wrapping
        assert!(on_target(std::f64::consts::PI, 0.0, -std::f64::consts::PI + 0.03, 0.0, 0.05));
    }

    #[test]
    fn bot_shot_lands_point_blank() {
        // At 1m, even wide spread stays within body radius
        assert!(bot_shot_lands(1.0, 0.06, 0.5, 0.5, 0.3));
    }

    #[test]
    fn bot_shot_misses_at_range() {
        // Far away with wide spread
        assert!(!bot_shot_lands(50.0, 0.2, 0.9, 0.9, 0.3));
    }

    #[test]
    fn step_aim_reaches_target() {
        // At 6 rad/s turn rate, 0.5s → 3 rad step
        let (y, p) = step_aim(0.0, 0.0, 2.0, 1.0, 6.0, 0.5);
        assert!((y - 2.0).abs() < 0.01);
        assert!((p - 1.0).abs() < 0.01);
    }

    #[test]
    fn desired_yaw_pitch_straight_ahead() {
        use nalgebra::Vector3;
        let eye = Vector3::new(0.0, 1.6, 0.0);
        let tgt = Vector3::new(0.0, 1.6, -1.0); // looking down -Z
        let (yaw, pitch) = desired_yaw_pitch(&eye, &tgt);
        assert!(yaw.abs() < 0.01);
        assert!(pitch.abs() < 0.01);
    }
}
