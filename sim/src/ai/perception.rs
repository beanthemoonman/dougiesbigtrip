//! Perception: line-of-sight checks and angular utilities.
//! Phase E.2 — extracted from server/src/ai.rs into sim/ for WASM-share.

use nalgebra::Vector3;

use crate::shapecast;
use crate::world::SimWorld;
use crate::ColliderHandle;

use super::bot::{SIGHT_HALF_FOV_COS, SIGHT_RANGE};

pub(crate) fn forward_dir(yaw: f64) -> (f64, f64) {
    (-yaw.sin(), -yaw.cos())
}

pub(crate) fn angle_delta(a: f64, b: f64) -> f64 {
    let mut d = (b - a) % (std::f64::consts::PI * 2.0);
    if d > std::f64::consts::PI { d -= std::f64::consts::PI * 2.0; }
    if d <= -std::f64::consts::PI { d += std::f64::consts::PI * 2.0; }
    d
}

pub(crate) fn can_see(
    world: &SimWorld,
    bot_feet: &Vector3<f64>,
    bot_yaw: f64,
    target_feet: &Vector3<f64>,
    exclude_collider: ColliderHandle,
) -> bool {
    use crate::constants::EYE_HEIGHT_STANDING;

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
    let dist_short = dist - crate::constants::PLAYER_RADIUS - 0.05;
    if dist_short <= 0.0 { return true; }
    let mut normal = Vector3::zeros();
    shapecast::ray_cast(
        &world.physics,
        eye.x, eye.y, eye.z,
        dir.x, dir.y, dir.z,
        dist_short,
        &mut normal,
        Some(exclude_collider),
    )
    .is_none()
}
