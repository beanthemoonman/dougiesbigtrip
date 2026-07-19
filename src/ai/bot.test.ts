import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMapColliders, CT_SPAWN, T_SPAWN } from '../game/map_douglas';
import { createWorld, initPhysics } from '../physics/world';
import { atGoal, createBot, setGoal, tickBot } from './bot';
import { navFromBytes, type Nav } from './nav';

/**
 * T1: a bot follows the baked navmesh across the real greybox colliders using
 * the SAME movement code as the player. This is the load-bearing Phase 4
 * property — if bots ever get a bespoke mover, this test is where it shows.
 *
 * Needs the baked blob (`pnpm nav:bake`) and the real colliders (buildMapColliders).
 */
const DT = 1 / 64;

const navBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../assets/maps/de_douglas.navmesh.bin', import.meta.url))),
);

describe('bot: nav-driven movement across the greybox', () => {
  let nav: Nav;
  beforeAll(async () => {
    await initPhysics();
    nav = await navFromBytes(navBytes);
  });

  it('walks from T spawn to CT spawn and stays grounded the whole way', () => {
    const world = createWorld();
    buildMapColliders(world);

    const spawn = new Vector3(T_SPAWN[0], T_SPAWN[1], T_SPAWN[2]);
    const target = new Vector3(CT_SPAWN[0], CT_SPAWN[1], CT_SPAWN[2]);
    const bot = createBot(world, spawn);
    setGoal(bot, nav, target);
    expect(bot.path.length).toBeGreaterThan(1);

    // 30 s ceiling at 64 Hz — the corridor is ~30 m at ~6 m/s, so ~6 s is enough;
    // the ceiling just bounds "got stuck" without flaking on the exact tick count.
    let ticks = 0;
    const MAX_TICKS = 30 * 64;
    while (!atGoal(bot) && ticks < MAX_TICKS) {
      tickBot(bot, DT);
      // Never tunnels through the floor or launches off a ramp into orbit.
      expect(bot.state.position.y).toBeGreaterThan(-1);
      expect(bot.state.position.y).toBeLessThan(3);
      ticks++;
    }

    expect(atGoal(bot)).toBe(true); // reached the goal, didn't time out stuck
    // Ended up horizontally near CT spawn.
    const dx = bot.state.position.x - target.x;
    const dz = bot.state.position.z - target.z;
    expect(Math.hypot(dx, dz)).toBeLessThan(1.5);
  });

  it('stands still with no goal', () => {
    const world = createWorld();
    buildMapColliders(world);
    const spawn = new Vector3(T_SPAWN[0], T_SPAWN[1], T_SPAWN[2]);
    const bot = createBot(world, spawn);

    for (let t = 0; t < 64; t++) tickBot(bot, DT);

    // No goal → no FORWARD press → only gravity settles it onto the floor.
    expect(Math.hypot(bot.state.velocity.x, bot.state.velocity.z)).toBeLessThan(0.01);
  });
});
