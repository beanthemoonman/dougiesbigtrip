/**
 * Phase 12.3 — Light cosmetic ragdoll on death.
 *
 * A single dynamic rigid body (capsule approximating the torso) that tumbles
 * under gravity. The character mesh rides the body; when it settles, it
 * despawns on a timer. Corpses use a separate Rapier world so they never
 * interfere with player/bot kinematic bodies.
 *
 * The ragdoll is fully deterministic (zero RNG) and lives entirely in the
 * render path, stepped off frame dt — never in the 64 Hz sim, never read back
 * into gameplay. The body plan is a single capsule, per the hard cap: "light,
 * not a muscle sim — the tuning is a trap."
 *
 * ponyail: single-body tumble; upgrade to a 4-5 body articulated chain only if
 * it looks like a sliding board.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, PLAYER_RADIUS } from '../player/constants';
import type { Vector3 } from 'three';

/** How long a ragdoll lives before despawn (seconds). */
const RAGDOLL_DESPAWN = 4;

/** Rapier interaction groups — keep ragdoll bodies out of the main query world
 *  by giving them their own Rapier World instance. No collision groups needed. */

export interface RagdollBody {
  body: RAPIER.RigidBody;
  /** World handle, for removal. */
  world: RAPIER.World; // the ragdoll world owns this
  createdAt: number; // sim-time seconds when spawned
}

/**
 * Create a fresh Rapier world for ragdoll bodies. Populated with the same
 * static map colliders as the main world so bodies tumble against walls and
 * ramps. No kinematic bodies — corpses can't collide with the living.
 */
export function createRagdollWorld(cuboids: Array<{
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
  quat: { x: number; y: number; z: number; w: number };
}>): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  for (const c of cuboids) {
    const desc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(c.center.x, c.center.y, c.center.z)
      .setRotation(c.quat);
    const body = world.createRigidBody(desc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z),
      body,
    );
  }
  return world;
}

/**
 * Spawn a ragdoll dynamic body at the given world position with the
 * death-frame velocity (so the body carries the bot's momentum).
 *
 * Returns a handle that the caller must step (in render) and later despawn.
 */
export function spawnRagdollBody(
  ragdollWorld: RAPIER.World,
  pos: Vector3,
  vel: Vector3,
  simTime: number,
): RagdollBody {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y + PLAYER_RADIUS * 0.5, pos.z)
    .setLinvel(vel.x, vel.y, vel.z)
    .setCanSleep(true);
  const body = ragdollWorld.createRigidBody(bodyDesc);
  ragdollWorld.createCollider(RAPIER.ColliderDesc.ball(PLAYER_RADIUS * 0.5), body);
  return { body, world: ragdollWorld, createdAt: simTime };
}/**
 * Check whether a ragdoll has outlived its despawn timer.
 */
export function ragdollExpired(r: RagdollBody, simTime: number): boolean {
  return simTime - r.createdAt >= RAGDOLL_DESPAWN;
}

/**
 * Remove a ragdoll body from its world. The world handles the memory — just
 * drop the JS references.
 */
export function despawnRagdollBody(r: RagdollBody): void {
  r.world.removeRigidBody(r.body);
}
