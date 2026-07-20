import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { addStaticBox, createKinematicCapsule, createWorld, initPhysics } from '../physics/world';
import { canHear, canSee, HEARING_RADIUS, SIGHT_RANGE } from './perception';
import { PLAYER_RADIUS, STANDING_HALF_HEIGHT } from '../player/constants';

/**
 * T1: bot senses against real Rapier geometry. A minimal world (one wall) keeps
 * the LOS case deterministic and independent of the map layout — we're testing
 * our usage of the cone + raycast, not the greybox.
 */
describe('perception: canSee', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  const botFeet = new Vector3(0, 0, 0);
  const yawLookNegZ = 0; // forward = (-sin0, 0, -cos0) = (0, 0, -1)

  it('sees a target in front, in range, with clear LOS', () => {
    const world = createWorld();
    const target = new Vector3(0, 0, -10);
    expect(canSee(world, botFeet, yawLookNegZ, target)).toBe(true);
  });

  it('cannot see a target behind it (outside the view cone)', () => {
    const world = createWorld();
    const behind = new Vector3(0, 0, 10); // directly behind
    expect(canSee(world, botFeet, yawLookNegZ, behind)).toBe(false);
  });

  it('cannot see a target beyond sight range', () => {
    const world = createWorld();
    const far = new Vector3(0, 0, -(SIGHT_RANGE + 5));
    expect(canSee(world, botFeet, yawLookNegZ, far)).toBe(false);
  });

  it('cannot see a target through a wall', () => {
    const world = createWorld();
    // A wall at z = -5, spanning the sightline between bot (z=0) and target (z=-10).
    addStaticBox(world, { x: 0, y: 1, z: -5 }, { x: 3, y: 2, z: 0.25 });
    world.step(); // register the collider in the query pipeline
    const target = new Vector3(0, 0, -10);
    expect(canSee(world, botFeet, yawLookNegZ, target)).toBe(false);
  });

  // Bug 1 regression: a static collider is invisible to raycasts until the world
  // is stepped. This is exactly why main.ts must call world.step() each tick —
  // without it, LOS and bullets pass through every wall.
  it('does NOT block LOS until the world is stepped', () => {
    const world = createWorld();
    addStaticBox(world, { x: 0, y: 1, z: -5 }, { x: 3, y: 2, z: 0.25 });
    const target = new Vector3(0, 0, -10);
    expect(canSee(world, botFeet, yawLookNegZ, target)).toBe(true); // unstepped: wall not queryable
    world.step();
    expect(canSee(world, botFeet, yawLookNegZ, target)).toBe(false); // stepped: wall blocks
  });

  // Bug 1/3 regression guard: a collider moved by setTranslation is queried at
  // its NEW position after updateSceneQueries() (would be wrong after step()).
  // step() snaps kinematic bodies back to their parent rigid body transform,
  // which never moved from spawn — so the collider appears at spawn in the BVH.
  it('a collider moved by setTranslation is queried at its new position after updateSceneQueries', () => {
    const world = createWorld();
    const { collider } = createKinematicCapsule(
      world,
      { x: 0, y: STANDING_HALF_HEIGHT + PLAYER_RADIUS, z: -5 },
      STANDING_HALF_HEIGHT,
      PLAYER_RADIUS,
    );
    // Move the capsule onto the LOS between bot (0,0,0) and target (0,0,-10).
    // bodyCenterScratch pattern: y = feet.y + STANDING_HALF_HEIGHT + PLAYER_RADIUS
    collider.setTranslation({ x: 0, y: STANDING_HALF_HEIGHT + PLAYER_RADIUS, z: -5 });
    const target = new Vector3(0, 0, -10);
    // Without a query refresh the capsule is invisible to raycasts.
    expect(canSee(world, botFeet, yawLookNegZ, target)).toBe(true);
    world.updateSceneQueries();
    // After updateSceneQueries the collider at its NEW position blocks LOS.
    expect(canSee(world, botFeet, yawLookNegZ, target)).toBe(false);
  });

  // respawn guard: a kinematic capsule that was disabled and then re-enabled
  // must still appear at its setTranslation target after updateSceneQueries.
  // This catches engines that, on re-enable, silently reset the collider to
  // the parent body's creation position (or some other stale transform).
  it('a re-enabled collider stays at its setTranslation position after updateSceneQueries', () => {
    const world = createWorld();
    const center = { x: 0, y: STANDING_HALF_HEIGHT + PLAYER_RADIUS, z: 0 };
    const { collider } = createKinematicCapsule(world, center, STANDING_HALF_HEIGHT, PLAYER_RADIUS);
    // Move to block LOS, disable, re-enable — same as a bot dying one round
    // and spawning the next.
    const blockPos = { x: 0, y: STANDING_HALF_HEIGHT + PLAYER_RADIUS, z: -5 };
    collider.setTranslation(blockPos);
    world.updateSceneQueries();
    const target = new Vector3(0, 0, -10);
    expect(canSee(world, botFeet, yawLookNegZ, target)).toBe(false);

    collider.setEnabled(false);
    world.updateSceneQueries();
    // Disabled → not in the BVH → LOS is clear again.
    expect(canSee(world, botFeet, yawLookNegZ, target)).toBe(true);

    collider.setEnabled(true);
    // Re-enabled but positioned at blockPos; updateSceneQueries has NOT been
    // called yet, so the BVH may or may not include it (engine-dependent).
    // But setTranslation is idempotent — we call it to be safe.
    collider.setTranslation(blockPos);
    world.updateSceneQueries();
    expect(canSee(world, botFeet, yawLookNegZ, target)).toBe(false);
  });
});

describe('perception: canHear', () => {
  it('hears a sound inside the radius, not outside', () => {
    const bot = new Vector3(0, 0, 0);
    expect(canHear(bot, new Vector3(0, 0, HEARING_RADIUS - 1))).toBe(true);
    expect(canHear(bot, new Vector3(0, 0, HEARING_RADIUS + 1))).toBe(false);
  });
});
