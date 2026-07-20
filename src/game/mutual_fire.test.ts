import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createKinematicCapsule, createWorld, initPhysics } from '../physics/world';
import { rayCast } from '../physics/shapecast';
import { canSee } from '../ai/perception';
import {
  EYE_HEIGHT_STANDING,
  PLAYER_RADIUS,
  STANDING_HALF_HEIGHT,
} from '../player/constants';

/**
 * T1 repro for the "player and bots can't hit each other" pair (symptoms 1 & 2).
 * Builds the real Rapier query world and syncs a player kinematic body + one bot
 * kinematic collider EXACTLY as main.ts's tick does — capsule centre at
 * feet.y + STANDING_HALF_HEIGHT + PLAYER_RADIUS, then updateSceneQueries() — so
 * this exercises our usage, not the greybox. If these pass, the live-loop path is
 * sound and the bug is elsewhere (ordering/timing in main.ts).
 */
describe('mutual fire: player <-> bot', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  // main.ts:773-778 / 818-819: capsule centre sits this far above the feet.
  const centreY = STANDING_HALF_HEIGHT + PLAYER_RADIUS;

  /** Player at `playerFeet`, one bot at `botFeet`, both synced into the BVH. */
  function scene(playerFeet: Vector3, botFeet: Vector3) {
    const world = createWorld();
    const player = createKinematicCapsule(
      world,
      { x: playerFeet.x, y: playerFeet.y + centreY, z: playerFeet.z },
      STANDING_HALF_HEIGHT,
      PLAYER_RADIUS,
    );
    const bot = createKinematicCapsule(
      world,
      { x: botFeet.x, y: botFeet.y + centreY, z: botFeet.z },
      STANDING_HALF_HEIGHT,
      PLAYER_RADIUS,
    );
    // main.ts syncs positions via setTranslation each tick, then flushes the BVH.
    // Both collider AND body must be set — updateSceneQueries reads from body
    // transforms, not collider transforms, for kinematic bodies.
    player.collider.setTranslation({ x: playerFeet.x, y: playerFeet.y + centreY, z: playerFeet.z });
    player.body.setTranslation({ x: playerFeet.x, y: playerFeet.y + centreY, z: playerFeet.z }, true);
    bot.collider.setTranslation({ x: botFeet.x, y: botFeet.y + centreY, z: botFeet.z });
    bot.body.setTranslation({ x: botFeet.x, y: botFeet.y + centreY, z: botFeet.z }, true);
    world.updateSceneQueries();
    return { world, player, bot };
  }

  it('player fire hits the bot collider (symptom 1)', () => {
    const playerFeet = new Vector3(0, 0, 0);
    const botFeet = new Vector3(0, 0, -10);
    const { world, player, bot } = scene(playerFeet, botFeet);

    // main.ts:899-908: ray from the eye, exclude the player's own hull.
    const eye = new Vector3(playerFeet.x, playerFeet.y + EYE_HEIGHT_STANDING, playerFeet.z);
    const botChest = new Vector3(botFeet.x, botFeet.y + centreY, botFeet.z);
    const dir = botChest.clone().sub(eye).normalize();
    const outNormal = new Vector3();
    const rayHit: { collider: import('@dimforge/rapier3d-compat').Collider | null } = { collider: null };

    const dist = rayCast(world, eye, dir, 100, outNormal, player.collider, rayHit);

    expect(dist).not.toBeNull();
    expect(rayHit.collider?.handle).toBe(bot.collider.handle);
  });

  it('bot LOS to the player is clear (symptom 2)', () => {
    const botFeet = new Vector3(0, 0, 0);
    const playerFeet = new Vector3(0, 0, -10);
    const { world, bot } = scene(playerFeet, botFeet);

    // Bot faces -Z (yaw 0), player is straight ahead. canSee excludes the bot's
    // own collider (perception.ts:51); the player's collider sits 0.1m past the
    // ray's end, so it must not self-block either.
    expect(canSee(world, botFeet, 0, playerFeet, bot.collider)).toBe(true);
  });
});
