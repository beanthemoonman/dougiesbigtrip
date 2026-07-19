/// Source-movement porting constants converted from Source units (1 unit = 1 inch)
/// to metres. See docs/source-movement.md — every value here is pre-converted.
///
/// All values are f64 as required by the determinism non-negotiables.

// Tick rate — live in the sim loop, re-exported here so movement modules have one
// import for all tuning constants.
pub const TICK_RATE_HZ: f64 = 64.0;
pub const FIXED_DT: f64 = 1.0 / TICK_RATE_HZ; // 1/64 = 0.015625

pub const GRAVITY: f64 = 20.32; // m/s^2

pub const SV_ACCELERATE: f64 = 5.0; // CS value; HL2 uses 10 and feels sluggish
pub const SV_AIRACCELERATE: f64 = 10.0;
pub const SV_FRICTION: f64 = 4.0;
pub const SV_STOPSPEED: f64 = 2.54; // m/s
pub const SV_MAXSPEED: f64 = 8.128; // m/s — absolute wishspeed ceiling

pub const AIR_WISHSPEED_CAP: f64 = 0.762; // m/s — target speed clamp in airAccelerate only

pub const OVERBOUNCE: f64 = 1.0; // Source uses 1.0 for players; Quake's 1.001 was a bug

pub const MAX_CLIP_PLANES: usize = 5;
pub const CLIP_ITERATIONS: usize = 4;
pub const GROUND_NORMAL_THRESHOLD: f64 = 0.7; // dot(normal, up) >= this -> walkable (45.573 deg)

pub const JUMP_IMPULSE: f64 = 6.8151; // m/s, SET not additive

pub const STEP_HEIGHT: f64 = 0.4572; // m

pub const PLAYER_RADIUS: f64 = 0.4064; // m
pub const STANDING_HEIGHT: f64 = 1.8288; // m
pub const DUCKED_HEIGHT: f64 = 0.9144; // m

// Rapier capsule halfHeight is the half-length of the cylindrical section only —
// total pole-to-pole extent is 2*halfHeight + 2*radius.
pub const STANDING_HALF_HEIGHT: f64 = (STANDING_HEIGHT - 2.0 * PLAYER_RADIUS) / 2.0;
pub const DUCKED_HALF_HEIGHT: f64 = (DUCKED_HEIGHT - 2.0 * PLAYER_RADIUS) / 2.0;

pub const EYE_HEIGHT_STANDING: f64 = 1.6256; // m, from feet
pub const EYE_HEIGHT_DUCKED: f64 = 0.7112; // m, from feet

pub const DUCK_TRANSITION_TIME: f64 = 0.4; // s

// Default ground run speed (rifle-equivalent, 250 u/s). Real weapon multipliers
// arrive in Phase 2 (docs/weapon-feel.md) and scale this per-weapon.
pub const DEFAULT_GROUND_SPEED: f64 = 6.35; // m/s

// --- Below: NOT ported Source values. The doc doesn't give exact numbers for
// these (categorizePosition's probe distance, view punch feel) — tuned by eye.
pub const GROUND_TRACE_DISTANCE: f64 = 0.05; // m
pub const VIEW_PUNCH_PER_MPS: f64 = 0.015; // rad of pitch dip per m/s of landing impact speed
pub const MAX_VIEW_PUNCH: f64 = 0.12; // rad, clamp so hard falls don't whip the camera
pub const VIEW_PUNCH_DECAY_RATE: f64 = 6.0; // 1/s, exponential-ish decay toward 0

// Surface friction (no per-material system yet — Phase 3 concern).
pub const DEFAULT_SURFACE_FRICTION: f64 = 1.0;

pub const DUCK_HEIGHT_DELTA: f64 = STANDING_HEIGHT - DUCKED_HEIGHT;

// Speed below which friction returns without zeroing (Source behaviour).
pub const FRICTION_SPEED_FLOOR: f64 = 0.1;
