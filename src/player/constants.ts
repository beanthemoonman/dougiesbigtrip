/**
 * Source-movement porting constants. See docs/source-movement.md — every value
 * here is pre-converted from Source's 1 unit = 1 inch to metres. If you find a
 * bare 320 or 800 anywhere in movement code, that's the bug, not this file.
 *
 * Tick rate lives in core/loop.ts (it's a sim-wide concern, not movement-specific);
 * re-exported here so movement code has one import for all its tuning constants.
 */
export { FIXED_DT, TICK_RATE } from '../core/loop';

export const GRAVITY = 20.32; // m/s^2

export const SV_ACCELERATE = 5.0; // CS value; HL2 uses 10 and feels sluggish
export const SV_AIRACCELERATE = 10.0;
export const SV_FRICTION = 4.0;
export const SV_STOPSPEED = 2.54; // m/s
export const SV_MAXSPEED = 8.128; // m/s — absolute wishspeed ceiling

export const AIR_WISHSPEED_CAP = 0.762; // m/s — target speed clamp in airAccelerate only

export const OVERBOUNCE = 1.0; // Source uses 1.0 for players; Quake's 1.001 was a bug, don't

export const MAX_CLIP_PLANES = 5;
export const CLIP_ITERATIONS = 4;
export const GROUND_NORMAL_THRESHOLD = 0.7; // dot(normal, up) >= this -> walkable (45.573 deg)

export const JUMP_IMPULSE = 6.8151; // m/s, SET not additive

export const STEP_HEIGHT = 0.4572; // m

export const PLAYER_RADIUS = 0.4064; // m
export const STANDING_HEIGHT = 1.8288; // m
export const DUCKED_HEIGHT = 0.9144; // m

// Rapier capsule halfHeight is the half-length of the cylindrical section only —
// total pole-to-pole extent is 2*halfHeight + 2*radius.
export const STANDING_HALF_HEIGHT = (STANDING_HEIGHT - 2 * PLAYER_RADIUS) / 2;
export const DUCKED_HALF_HEIGHT = (DUCKED_HEIGHT - 2 * PLAYER_RADIUS) / 2;

export const EYE_HEIGHT_STANDING = 1.6256; // m, from feet
export const EYE_HEIGHT_DUCKED = 0.7112; // m, from feet

export const DUCK_TRANSITION_TIME = 0.4; // s

// Default ground run speed (rifle-equivalent, 250 u/s). Real weapon multipliers
// arrive in Phase 2 (docs/weapon-feel.md) and scale this per-weapon.
export const DEFAULT_GROUND_SPEED = 6.35; // m/s

// --- Below: NOT ported Source values. The doc doesn't give exact numbers for
// these (categorizePosition's probe distance, view punch feel) — tuned by eye.
// Kept here anyway so movement tuning isn't scattered across files.
export const GROUND_TRACE_DISTANCE = 0.05; // m, categorizePosition's downward probe
export const VIEW_PUNCH_PER_MPS = 0.015; // rad of pitch dip per m/s of landing impact speed
export const MAX_VIEW_PUNCH = 0.12; // rad, clamp so hard falls don't whip the camera
export const VIEW_PUNCH_DECAY_RATE = 6.0; // 1/s, exponential-ish decay toward 0
