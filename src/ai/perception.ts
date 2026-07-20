/**
 * Bot senses: can it SEE a target (in range, inside the view cone, clear line of
 * sight) and can it HEAR a sound (within a radius). The FSM turns these into
 * Investigate/Engage transitions. Perfect omniscient bots read as cheating —
 * these gates are what make them lose you behind cover.
 */
import type { World } from '@dimforge/rapier3d-compat';
import type { Collider } from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3 } from 'three';
import { EYE_HEIGHT_STANDING, PLAYER_RADIUS } from '../player/constants';
import { rayCast } from '../physics/shapecast';

export const SIGHT_RANGE = 40; // m — beyond this a bot won't acquire by sight
export const SIGHT_HALF_FOV = MathUtils.degToRad(75); // 150° total view cone
export const HEARING_RADIUS = 25; // m — gunfire/footsteps register within this

// Module scratch — perception runs per bot per tick, no allocation in the loop.
const eye = new Vector3();
const targetEye = new Vector3();
const toTarget = new Vector3();
const forward = new Vector3();
const losNormal = new Vector3();

/**
 * True if a bot at `botFeet` facing `yaw` can see a target standing at
 * `targetFeet`: within SIGHT_RANGE, inside the view cone, and with an
 * unobstructed ray between their eye points. `botCollider` is excluded so the
 * bot's own hull doesn't block its view.
 */
export function canSee(
  world: World,
  botFeet: Vector3,
  yaw: number,
  targetFeet: Vector3,
  botCollider?: Collider,
): boolean {
  eye.set(botFeet.x, botFeet.y + EYE_HEIGHT_STANDING, botFeet.z);
  targetEye.set(targetFeet.x, targetFeet.y + EYE_HEIGHT_STANDING, targetFeet.z);
  toTarget.subVectors(targetEye, eye);

  const dist = toTarget.length();
  if (dist === 0) return true;
  if (dist > SIGHT_RANGE) return false;
  toTarget.divideScalar(dist); // now unit

  // View cone: forward at yaw θ is (-sinθ, 0, -cosθ) (core/input convention).
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  if (forward.dot(toTarget) < Math.cos(SIGHT_HALF_FOV)) return false;

  // Line of sight: cast to the target's HULL, not its eye. The target (player or
  // bot) is a capsule of radius PLAYER_RADIUS; a ray to its centre plows into its
  // own near hemisphere and reports a false "blocked", so bots could never see
  // anyone (their whole target never became visible). Stop one radius short + a
  // small margin. Point-blank (dist within that band) is trivially visible.
  // ponytail: this misses cover sitting within one radius of the target; that
  // band is inside the target's own body anyway, so no real LOS is lost.
  const reach = dist - PLAYER_RADIUS - 0.05;
  if (reach <= 0) return true;
  const hit = rayCast(world, eye, toTarget, reach, losNormal, botCollider);
  return hit === null;
}

/** True if a sound at `soundPos` is within `radius` of a bot at `botFeet`. */
export function canHear(botFeet: Vector3, soundPos: Vector3, radius = HEARING_RADIUS): boolean {
  return botFeet.distanceToSquared(soundPos) <= radius * radius;
}
