//! Server-side bot AI (Phase 6.5). Each bot runs a simple FSM (idle/patrol →
//! engage on LOS → reposition when target lost) and drives the SAME
//! tick_movement function humans use. See docs/netcode.md §6.5.

use nalgebra::Vector3;
use sim::constants::{EYE_HEIGHT_STANDING, FIXED_DT};
use sim::input::Buttons;
use sim::shapecast;
use sim::world::SimWorld;

const SIGHT_RANGE: f64 = 40.0;
const SIGHT_HALF_FOV_COS: f64 = 0.258819; // cos(75°)
const WAYPOINT_RADIUS: f64 = 0.6;
const TURN_RATE: f64 = 6.0; // rad/s — normal difficulty
const REACTION_TIME: f64 = 0.35; // s
const LOSE_MEMORY: f64 = 4.0; // s

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BotMode {
    Idle,
    Engage,
    Reposition,
    Dead,
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
    pub waypoints: &'static [(f64, f64, f64)],
    pub waypoint_index: usize,
}

impl Bot {
    pub fn new(waypoints: &'static [(f64, f64, f64)]) -> Self {
        Self {
            mode: BotMode::Idle,
            yaw: 0.0,
            aim_yaw: 0.0,
            aim_pitch: 0.0,
            target_slot: None,
            last_known: None,
            reaction_timer: 0.0,
            lost_timer: 0.0,
            waypoints,
            waypoint_index: 0,
        }
    }
}

fn angle_delta(a: f64, b: f64) -> f64 {
    let mut d = (b - a) % (std::f64::consts::PI * 2.0);
    if d > std::f64::consts::PI {
        d -= std::f64::consts::PI * 2.0;
    }
    if d <= -std::f64::consts::PI {
        d += std::f64::consts::PI * 2.0;
    }
    d
}

fn step_angle(current: f64, target: f64, max_step: f64) -> f64 {
    let d = angle_delta(current, target);
    if d.abs() <= max_step {
        target
    } else {
        current + d.signum() * max_step
    }
}

fn forward_dir(yaw: f64) -> (f64, f64) {
    (-yaw.sin(), -yaw.cos())
}

/// Check if bot at `bot_feet` can see target at `target_feet` via LOS raycast.
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
    if dist < 1e-6 {
        return true;
    }
    if dist > SIGHT_RANGE {
        return false;
    }
    let dir = to / dist;
    let (fx, fz) = forward_dir(bot_yaw);
    if dir.x * fx + dir.z * fz < SIGHT_HALF_FOV_COS {
        return false;
    }
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
) -> (u16, f64) {
    if bot.mode == BotMode::Dead {
        return (0, bot.yaw);
    }

    let dt = FIXED_DT;

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
    // If current target is dead, pick another.
    if bot.target_slot.is_none_or(|ts| ts >= alive.len() || !alive[ts]) {
        for (i, a) in alive.iter().enumerate() {
            if !a || i == bot.target_slot.unwrap_or(usize::MAX) {
                continue;
            }
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

    match bot.mode {
        BotMode::Idle | BotMode::Reposition => {
            if sees {
                bot.mode = BotMode::Engage;
                bot.reaction_timer = REACTION_TIME;
                bot.last_known = Some(target_feet);
            } else if bot.mode == BotMode::Reposition {
                bot.lost_timer += dt;
                if bot.lost_timer >= LOSE_MEMORY {
                    bot.mode = BotMode::Idle;
                    bot.target_slot = None;
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

    if bot.mode == BotMode::Engage {
        // Stand and aim: no movement, track target with turn-rate cap.
        if bot.reaction_timer > 0.0 {
            bot.reaction_timer -= dt;
        } else if let Some(ref target) = bot.last_known {
            let eye = Vector3::new(bot_feet.x, bot_feet.y + EYE_HEIGHT_STANDING, bot_feet.z);
            let aim_point = Vector3::new(
                target.x,
                target.y + EYE_HEIGHT_STANDING,
                target.z,
            );
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

    // Moving states: walk toward last_known or next waypoint.
    let goal = if bot.mode == BotMode::Reposition || bot.mode == BotMode::Idle {
        bot.last_known.as_ref().map(|lk| (lk.x, lk.y, lk.z))
    } else {
        None
    };
    let (gx, gz) = if let Some((gx, _gy, gz)) = goal {
        (gx, gz)
    } else if !bot.waypoints.is_empty() {
        let wp = bot.waypoints[bot.waypoint_index % bot.waypoints.len()];
        (wp.0, wp.2)
    } else {
        (bot_feet.x, bot_feet.z)
    };

    let dx = gx - bot_feet.x;
    let dz = gz - bot_feet.z;
    let dist_sq = dx * dx + dz * dz;

    let mut buttons: u16 = 0;
    if dist_sq > WAYPOINT_RADIUS * WAYPOINT_RADIUS {
        bot.yaw = (-dx).atan2(-dz);
        buttons = Buttons::FORWARD;
    } else if bot.mode == BotMode::Idle {
        bot.waypoint_index = bot.waypoint_index.wrapping_add(1);
    }

    (buttons, bot.yaw)
}
