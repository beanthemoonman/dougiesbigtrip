import RAPIER from '@dimforge/rapier3d-compat';
import type { Vector3 } from 'three';

/**
 * Collision *queries only* — see docs/source-movement.md. The accel/friction
 * curve and the collide-and-slide loop live in src/player/movement.ts by hand;
 * this module just wraps Rapier's shape-cast so movement.ts doesn't touch the
 * Rapier API directly.
 */

// Capsules here are never rotated (always upright), so a shared identity
// quaternion avoids allocating one per cast.
const IDENTITY_ROTATION: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };

// If the swept shape ends up closer than this to a surface, Rapier reports a
// hit rather than requiring exact penetration — cheap numerical safety margin
// for a character controller. Not a ported Source value.
const TARGET_DISTANCE = 0.005;

/**
 * Sweeps a vertical capsule from `origin` (capsule centre) by `displacement`
 * against everything in `world` except `excludeCollider`. Returns the impact
 * fraction in [0, 1] along `displacement`, or null on no hit, and writes the
 * world-space hit normal into `outNormal`. No allocation beyond what Rapier's
 * own castShape() call unavoidably does internally.
 */
export function capsuleCast(
  world: RAPIER.World,
  shape: RAPIER.Capsule,
  origin: Vector3,
  displacement: Vector3,
  outNormal: Vector3,
  excludeCollider?: RAPIER.Collider,
): number | null {
  if (displacement.lengthSq() === 0) return null;

  const hit = world.castShape(
    origin,
    IDENTITY_ROTATION,
    displacement,
    shape,
    TARGET_DISTANCE,
    1.0,
    true,
    undefined,
    undefined,
    excludeCollider,
  );
  if (!hit) return null;

  outNormal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
  return hit.time_of_impact;
}

// Reused across shots — a bullet trace runs at most once per tick, and the Ray
// fields are plain vectors we overwrite.
const scratchRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });

/**
 * Traces a bullet: casts a ray from `origin` along the unit vector `direction`,
 * up to `maxDistance` metres. Returns the distance to the impact and writes the
 * surface normal into `outNormal`, or null if the ray hits nothing. The hit
 * point is `origin + direction * distance`.
 *
 * This is the world half of the shot pipeline — the per-bone hitbox query
 * against a character rig is separate and still owed (needs the Phase 3 rig).
 */
export function rayCast(
  world: RAPIER.World,
  origin: Vector3,
  direction: Vector3,
  maxDistance: number,
  outNormal: Vector3,
  excludeCollider?: RAPIER.Collider,
): number | null {
  scratchRay.origin = origin;
  scratchRay.dir = direction;
  // solid=true: a ray starting inside a collider impacts at distance 0 rather
  // than passing out through the far face.
  const hit = world.castRayAndGetNormal(scratchRay, maxDistance, true, undefined, undefined, excludeCollider);
  if (!hit) return null;

  outNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
  return hit.timeOfImpact; // direction is unit, so toi is metres
}

/** True if a capsule at `center` overlaps anything in `world` (except `excludeCollider`).
 * Used for the "can I stand up" headroom check when un-ducking — see handleDuck(). */
export function capsuleOverlapsAnything(
  world: RAPIER.World,
  shape: RAPIER.Capsule,
  center: Vector3,
  excludeCollider?: RAPIER.Collider,
): boolean {
  let found = false;
  world.intersectionsWithShape(
    center,
    IDENTITY_ROTATION,
    shape,
    () => {
      found = true;
      return false; // stop at first hit
    },
    undefined,
    undefined,
    excludeCollider,
  );
  return found;
}
