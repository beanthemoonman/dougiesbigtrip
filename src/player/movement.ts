import type { Capsule, Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Buttons, wishDirFromButtons } from '../core/input';
import { capsuleCast, capsuleOverlapsAnything } from '../physics/shapecast';
import { createKinematicCapsule, makeCapsuleShape } from '../physics/world';
import {
  AIR_WISHSPEED_CAP,
  CLIP_ITERATIONS,
  DEFAULT_GROUND_SPEED,
  DUCKED_HALF_HEIGHT,
  DUCK_TRANSITION_TIME,
  EYE_HEIGHT_DUCKED,
  EYE_HEIGHT_STANDING,
  GRAVITY,
  GROUND_NORMAL_THRESHOLD,
  GROUND_TRACE_DISTANCE,
  JUMP_IMPULSE,
  MAX_CLIP_PLANES,
  MAX_VIEW_PUNCH,
  OVERBOUNCE,
  PLAYER_RADIUS,
  STANDING_HALF_HEIGHT,
  STANDING_HEIGHT,
  DUCKED_HEIGHT,
  STEP_HEIGHT,
  SV_ACCELERATE,
  SV_AIRACCELERATE,
  SV_FRICTION,
  SV_MAXSPEED,
  SV_STOPSPEED,
  VIEW_PUNCH_DECAY_RATE,
  VIEW_PUNCH_PER_MPS,
} from './constants';

/**
 * Source-style movement — see docs/source-movement.md. This file is a port, not
 * an invention: do not "improve" the accel/friction curve, do not clamp
 * wishspeed in airAccelerate's accelspeed line, do not substitute a physics
 * engine's built-in character controller response. Rapier is used only for
 * the shape-cast queries in physics/shapecast.ts.
 */

// No per-material surface friction system yet (that's a Phase 3 map/materials
// concern) — the ground always returns 1.0 until then.
const DEFAULT_SURFACE_FRICTION = 1.0;

const DUCK_HEIGHT_DELTA = STANDING_HEIGHT - DUCKED_HEIGHT;

// ---------------------------------------------------------------------------
// Pure functions — no Rapier, no module state. These are what movement.test.ts
// checks against the golden tables.
// ---------------------------------------------------------------------------

/** Ground friction. Note: below the 0.1 speed floor this returns WITHOUT zeroing
 * velocity — that's Source's behaviour, not a bug. */
export function friction(
  vel: Vector3,
  dt: number,
  onGround: boolean,
  surfaceFriction: number,
): void {
  const speed = vel.length();
  if (speed < 0.1) return;

  let drop = 0;
  if (onGround) {
    const frictionAmount = SV_FRICTION * surfaceFriction;
    const control = speed < SV_STOPSPEED ? SV_STOPSPEED : speed;
    drop += control * frictionAmount * dt;
  }

  let newspeed = speed - drop;
  if (newspeed < 0) newspeed = 0;
  if (newspeed !== speed) vel.multiplyScalar(newspeed / speed);
}

/** Ground acceleration. Caps the projection of velocity onto wishdir, not the
 * velocity magnitude. */
export function accelerate(
  vel: Vector3,
  wishdir: Vector3,
  wishspeed: number,
  accel: number,
  dt: number,
  surfaceFriction: number,
): void {
  const currentspeed = vel.dot(wishdir);
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) return;

  let accelspeed = accel * dt * wishspeed * surfaceFriction;
  if (accelspeed > addspeed) accelspeed = addspeed;

  vel.addScaledVector(wishdir, accelspeed);
}

/**
 * Air acceleration — the important one. The target speed used for `addspeed`
 * is clamped to AIR_WISHSPEED_CAP, but the acceleration amount is computed
 * from the UNCLAMPED wishspeed. Do not "simplify" this by making both use the
 * same variable — it looks like a bug, it is not a bug, this asymmetry is the
 * entire reason air-strafing and bunnyhopping exist. See docs/source-movement.md.
 */
export function airAccelerate(
  vel: Vector3,
  wishdir: Vector3,
  wishspeed: number,
  accel: number,
  dt: number,
  surfaceFriction: number,
): void {
  let wishspd = wishspeed;
  if (wishspd > AIR_WISHSPEED_CAP) wishspd = AIR_WISHSPEED_CAP;

  const currentspeed = vel.dot(wishdir);
  const addspeed = wishspd - currentspeed; // uses CLAMPED wishspd
  if (addspeed <= 0) return;

  let accelspeed = accel * wishspeed * dt * surfaceFriction; // uses UNCLAMPED wishspeed
  if (accelspeed > addspeed) accelspeed = addspeed;

  vel.addScaledVector(wishdir, accelspeed);
}

/** Reflects `vin` off `normal`, safe to call with `out === vin`. */
export function clipVelocity(vin: Vector3, normal: Vector3, out: Vector3, overbounce = OVERBOUNCE): void {
  const backoff = vin.dot(normal) * overbounce;
  out.copy(vin).addScaledVector(normal, -backoff);

  // Numerical safety pass: make sure we're not still moving into the plane.
  const adjust = out.dot(normal);
  if (adjust < 0) out.addScaledVector(normal, -adjust);
}

// ---------------------------------------------------------------------------
// World-touching state and functions.
// ---------------------------------------------------------------------------

export interface PlayerState {
  /** Feet position (bottom-centre of the hull), world space. */
  position: Vector3;
  velocity: Vector3;
  onGround: boolean;
  groundNormal: Vector3;
  ducked: boolean;
  /** 0 (standing) .. 1 (fully ducked) — view-only interpolation, see handleDuck(). */
  duckAmount: number;
  /** Cleared on JUMP release; prevents holding jump from auto-bhopping. */
  jumpHeld: boolean;
  /** Eye height above `position`, derived from duckAmount. */
  eyeHeight: number;
  /** Landing view-punch: pitch dip in radians, decays toward 0. */
  viewPunch: number;
}

export function createPlayerState(spawnFeet: Vector3): PlayerState {
  return {
    position: spawnFeet.clone(),
    velocity: new Vector3(),
    onGround: false,
    groundNormal: new Vector3(0, 1, 0),
    ducked: false,
    duckAmount: 0,
    jumpHeld: false,
    eyeHeight: EYE_HEIGHT_STANDING,
    viewPunch: 0,
  };
}

export interface MovementContext {
  world: World;
  /** Bookkeeping body/collider for other systems (future bots, hit detection) to
   * query against. Always sized to the standing hull — the movement collision
   * hull (below) swaps binary between standing/ducked and never touches this. */
  body: RigidBody;
  collider: Collider;
  standingShape: Capsule;
  duckedShape: Capsule;
}

export function createMovementContext(world: World, spawnFeet: Vector3): MovementContext {
  const standingShape = makeCapsuleShape(STANDING_HALF_HEIGHT, PLAYER_RADIUS);
  const duckedShape = makeCapsuleShape(DUCKED_HALF_HEIGHT, PLAYER_RADIUS);
  const center = capsuleCenterFromFeet(spawnFeet, STANDING_HALF_HEIGHT, PLAYER_RADIUS, new Vector3());
  const { body, collider } = createKinematicCapsule(world, center, STANDING_HALF_HEIGHT, PLAYER_RADIUS);
  return { world, body, collider, standingShape, duckedShape };
}

export interface MovementInput {
  buttons: number;
  yaw: number;
}

// Module-level scratch, reused every tick. Never held across ticks — see
// core/scratch.ts's convention, mirrored here because these values (e.g. clip
// plane normals) must survive multiple nested calls *within* one tick, which
// the shared pool's rotating cursor can't guarantee.
const wishDirScratch = new Vector3();
const groundNormalScratch = new Vector3();
const duckCheckFeetScratch = new Vector3();
const duckCheckCenterScratch = new Vector3();
const groundTraceCenterScratch = new Vector3();
const groundTraceDispScratch = new Vector3();
const traceCenterScratch = new Vector3();
const displacementScratch = new Vector3();
const hitNormalScratch = new Vector3();
const clippedVelScratch = new Vector3();
const creaseDirScratch = new Vector3();
const stepDispScratch = new Vector3();
const downNormalScratch = new Vector3();
const stairDownPos = new Vector3();
const stairDownVel = new Vector3();
const stairUpPos = new Vector3();
const stairUpVel = new Vector3();
const colliderCenterScratch = new Vector3();
const clipPlanes: Vector3[] = Array.from({ length: MAX_CLIP_PLANES }, () => new Vector3());

function capsuleCenterFromFeet(feet: Vector3, halfHeight: number, radius: number, out: Vector3): Vector3 {
  return out.set(feet.x, feet.y + halfHeight + radius, feet.z);
}

function activeShape(ctx: MovementContext, state: PlayerState): Capsule {
  return state.ducked ? ctx.duckedShape : ctx.standingShape;
}

function horizontalDistSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function categorizePosition(ctx: MovementContext, shape: Capsule, position: Vector3, outNormal: Vector3): boolean {
  capsuleCenterFromFeet(position, shape.halfHeight, shape.radius, groundTraceCenterScratch);
  groundTraceDispScratch.set(0, -GROUND_TRACE_DISTANCE, 0);
  const fraction = capsuleCast(
    ctx.world,
    shape,
    groundTraceCenterScratch,
    groundTraceDispScratch,
    outNormal,
    ctx.collider,
  );
  if (fraction === null) return false;
  return outNormal.y >= GROUND_NORMAL_THRESHOLD;
}

/** Single straight sweep, capped at `displacement`'s length. Moves `position` in
 * place and returns the impact fraction, or null if the full displacement was clear. */
function traceStraight(
  ctx: MovementContext,
  shape: Capsule,
  position: Vector3,
  displacement: Vector3,
  outNormal: Vector3,
): number | null {
  capsuleCenterFromFeet(position, shape.halfHeight, shape.radius, traceCenterScratch);
  const fraction = capsuleCast(ctx.world, shape, traceCenterScratch, displacement, outNormal, ctx.collider, false);
  if (fraction === null) {
    position.add(displacement);
    return null;
  }
  position.addScaledVector(displacement, fraction * 0.99);
  return fraction;
}

/** Collide-and-slide. Mutates `position`/`velocity` in place. 4 iterations, 5 max
 * clip planes, crease-handling for the 2-plane case — see docs/source-movement.md. */
function tryPlayerMove(ctx: MovementContext, shape: Capsule, position: Vector3, velocity: Vector3, dt: number): void {
  let remaining = dt;
  let planeCount = 0;

  for (let iter = 0; iter < CLIP_ITERATIONS; iter++) {
    if (velocity.lengthSq() < 1e-8) break;

    displacementScratch.copy(velocity).multiplyScalar(remaining);
    capsuleCenterFromFeet(position, shape.halfHeight, shape.radius, traceCenterScratch);
    const fraction = capsuleCast(
      ctx.world,
      shape,
      traceCenterScratch,
      displacementScratch,
      hitNormalScratch,
      ctx.collider,
      false,
    );

    if (fraction === null) {
      position.addScaledVector(velocity, remaining);
      break;
    }

    position.addScaledVector(displacementScratch, fraction * 0.99);
    remaining *= 1 - fraction;

    if (planeCount >= MAX_CLIP_PLANES) {
      velocity.set(0, 0, 0);
      break;
    }
    const plane = clipPlanes[planeCount];
    if (!plane) break; // unreachable: planeCount < MAX_CLIP_PLANES === clipPlanes.length
    plane.copy(hitNormalScratch);
    planeCount++;

    if (planeCount === 1) {
      clipVelocity(velocity, clipPlanes[0] as Vector3, velocity, OVERBOUNCE);
    } else {
      let found = false;
      for (let j = 0; j < planeCount; j++) {
        clipVelocity(velocity, clipPlanes[j] as Vector3, clippedVelScratch, OVERBOUNCE);
        let valid = true;
        for (let k = 0; k < planeCount; k++) {
          if (k === j) continue;
          if (clippedVelScratch.dot(clipPlanes[k] as Vector3) < 0) {
            valid = false;
            break;
          }
        }
        if (valid) {
          velocity.copy(clippedVelScratch);
          found = true;
          break;
        }
      }
      if (!found) {
        if (planeCount === 2) {
          creaseDirScratch.crossVectors(clipPlanes[0] as Vector3, clipPlanes[1] as Vector3).normalize();
          const speed = creaseDirScratch.dot(velocity);
          velocity.copy(creaseDirScratch).multiplyScalar(speed);
        } else {
          velocity.set(0, 0, 0);
          break;
        }
      }
    }
  }
}

/** Source's three-trace stair dance. Only valid to call when onGround — running it
 * in the air lets players climb walls. */
function stepMove(ctx: MovementContext, shape: Capsule, state: PlayerState, dt: number): void {
  stairDownPos.copy(state.position);
  stairDownVel.copy(state.velocity);
  tryPlayerMove(ctx, shape, stairDownPos, stairDownVel, dt);

  stairUpPos.copy(state.position);
  stepDispScratch.set(0, STEP_HEIGHT, 0);
  traceStraight(ctx, shape, stairUpPos, stepDispScratch, hitNormalScratch);

  stairUpVel.copy(state.velocity);
  tryPlayerMove(ctx, shape, stairUpPos, stairUpVel, dt);

  stepDispScratch.set(0, -STEP_HEIGHT, 0);
  const downFraction = traceStraight(ctx, shape, stairUpPos, stepDispScratch, downNormalScratch);
  const walkable = downFraction !== null && downNormalScratch.y >= GROUND_NORMAL_THRESHOLD;

  const flatDistSq = horizontalDistSq(state.position, stairDownPos);
  const steppedDistSq = horizontalDistSq(state.position, stairUpPos);

  if (walkable && steppedDistSq > flatDistSq) {
    state.position.copy(stairUpPos);
    state.velocity.copy(stairUpVel);
  } else {
    state.position.copy(stairDownPos);
    state.velocity.copy(stairDownVel);
  }
}

/** Instant binary hull swap (matches Source: only two discrete hull sizes exist).
 * duckAmount is a separate, smoothly-interpolated value used only for the view. */
function handleDuck(ctx: MovementContext, state: PlayerState, wantDuck: boolean, onGround: boolean, dt: number): void {
  if (wantDuck && !state.ducked) {
    // Ducking always succeeds — you can always make yourself smaller. Mid-air,
    // pull the feet up (anchor the hull's top) so a duck at jump apex actually
    // clears higher gaps; grounded, feet stay planted.
    if (!onGround) state.position.y += DUCK_HEIGHT_DELTA;
    state.ducked = true;
  } else if (!wantDuck && state.ducked) {
    const candidateY = onGround ? state.position.y : state.position.y - DUCK_HEIGHT_DELTA;
    duckCheckFeetScratch.set(state.position.x, candidateY, state.position.z);
    capsuleCenterFromFeet(duckCheckFeetScratch, STANDING_HALF_HEIGHT, PLAYER_RADIUS, duckCheckCenterScratch);
    if (!capsuleOverlapsAnything(ctx.world, ctx.standingShape, duckCheckCenterScratch, ctx.collider)) {
      state.position.y = candidateY;
      state.ducked = false;
    }
    // else: blocked overhead, stay ducked until clear.
  }

  const target = state.ducked ? 1 : 0;
  const rate = dt / DUCK_TRANSITION_TIME;
  if (state.duckAmount < target) state.duckAmount = Math.min(target, state.duckAmount + rate);
  else if (state.duckAmount > target) state.duckAmount = Math.max(target, state.duckAmount - rate);

  state.eyeHeight = EYE_HEIGHT_STANDING + (EYE_HEIGHT_DUCKED - EYE_HEIGHT_STANDING) * state.duckAmount;
}

function checkJump(state: PlayerState, jumpPressed: boolean): void {
  if (!jumpPressed) state.jumpHeld = false; // released -> re-arm; no auto-bhop
  if (jumpPressed && state.onGround && !state.jumpHeld) {
    state.velocity.y = JUMP_IMPULSE; // SET, not additive — additive = rocket-jump-off-ramps
    state.onGround = false;
    state.jumpHeld = true;
  }
}

/** Advances `state` by exactly `dt` seconds, following the per-tick order of
 * operations in docs/source-movement.md. Call at TICK_RATE (64 Hz), never at
 * render framerate. */
export function tickMovement(ctx: MovementContext, state: PlayerState, input: MovementInput, dt: number): void {
  const [wishX, wishZ] = wishDirFromButtons(input.buttons, input.yaw);
  wishDirScratch.set(wishX, 0, wishZ);

  const groundedAtStart = categorizePosition(ctx, activeShape(ctx, state), state.position, groundNormalScratch);
  state.onGround = groundedAtStart;
  if (groundedAtStart) state.groundNormal.copy(groundNormalScratch);
  else state.groundNormal.set(0, 1, 0);

  const wantDuck = (input.buttons & Buttons.DUCK) !== 0;
  handleDuck(ctx, state, wantDuck, state.onGround, dt);

  const jumpPressed = (input.buttons & Buttons.JUMP) !== 0;
  checkJump(state, jumpPressed);

  if (state.onGround) friction(state.velocity, dt, true, DEFAULT_SURFACE_FRICTION);

  const wishspeed = Math.min(DEFAULT_GROUND_SPEED, SV_MAXSPEED);
  if (state.onGround) {
    accelerate(state.velocity, wishDirScratch, wishspeed, SV_ACCELERATE, dt, DEFAULT_SURFACE_FRICTION);
  } else {
    airAccelerate(state.velocity, wishDirScratch, wishspeed, SV_AIRACCELERATE, dt, DEFAULT_SURFACE_FRICTION);
  }

  if (!state.onGround) state.velocity.y -= GRAVITY * dt;

  const preMoveVelY = state.velocity.y;
  const shape = activeShape(ctx, state);
  if (state.onGround) {
    stepMove(ctx, shape, state, dt);
  } else {
    tryPlayerMove(ctx, shape, state.position, state.velocity, dt);
  }

  const groundedAfterMove = categorizePosition(ctx, shape, state.position, groundNormalScratch);
  state.onGround = groundedAfterMove;
  if (groundedAfterMove) state.groundNormal.copy(groundNormalScratch);

  if (groundedAfterMove && !groundedAtStart) {
    const impactSpeed = Math.max(0, -preMoveVelY);
    state.viewPunch = Math.min(MAX_VIEW_PUNCH, state.viewPunch + impactSpeed * VIEW_PUNCH_PER_MPS);
  }
  state.viewPunch = Math.max(0, state.viewPunch - state.viewPunch * VIEW_PUNCH_DECAY_RATE * dt);

  // Keep the bookkeeping collider live for future systems (bots, hit detection).
  capsuleCenterFromFeet(state.position, STANDING_HALF_HEIGHT, PLAYER_RADIUS, colliderCenterScratch);
  ctx.body.setTranslation(colliderCenterScratch, true);
  ctx.world.updateSceneQueries();
}
