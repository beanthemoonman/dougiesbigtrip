import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { addStaticBox, createWorld, initPhysics } from '../physics/world';
import { canHear, canSee, HEARING_RADIUS, SIGHT_RANGE } from './perception';

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
});

describe('perception: canHear', () => {
  it('hears a sound inside the radius, not outside', () => {
    const bot = new Vector3(0, 0, 0);
    expect(canHear(bot, new Vector3(0, 0, HEARING_RADIUS - 1))).toBe(true);
    expect(canHear(bot, new Vector3(0, 0, HEARING_RADIUS + 1))).toBe(false);
  });
});
