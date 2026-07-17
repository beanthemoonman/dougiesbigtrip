import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY } from '../player/constants';

let initPromise: Promise<void> | null = null;

/** Loads and instantiates the Rapier WASM module. Call once, before createWorld(). */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export function createWorld(): RAPIER.World {
  // Only matters for dynamic bodies (props, later): the player is a kinematic
  // capsule with hand-rolled gravity, see docs/source-movement.md.
  return new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
}

/** A static (fixed) box collider — greybox walls/floors/steps/ramps. Center + half-extents,
 * metres; optional rotation for ramps. */
export function addStaticBox(
  world: RAPIER.World,
  center: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number },
  rotation?: { x: number; y: number; z: number; w: number },
): RAPIER.Collider {
  let desc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
  if (rotation) desc = desc.setRotation(rotation);
  const body = world.createRigidBody(desc);
  return world.createCollider(RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z), body);
}

export function makeCapsuleShape(halfHeight: number, radius: number): RAPIER.Capsule {
  return new RAPIER.Capsule(halfHeight, radius);
}

/** A kinematic (position-based) capsule body — the player. Movement resolves its own
 * position via hand-rolled collide-and-slide (see src/player/movement.ts); this body
 * exists so other systems (future bots, hit detection) can query against the player. */
export function createKinematicCapsule(
  world: RAPIER.World,
  center: { x: number; y: number; z: number },
  halfHeight: number,
  radius: number,
): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z),
  );
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);
  return { body, collider };
}
