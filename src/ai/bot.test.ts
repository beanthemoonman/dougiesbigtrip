import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMapColliders, CT_SPAWN, MAP_BOXES, MAP_RAMPS, T_SPAWN } from '../game/map_douglas';
import { createWorld, initPhysics } from '../physics/world';
import {
  sim_init,
  sim_add_box,
  sim_add_ramp,
  sim_tick,
} from 'sim-wasm';
import { atGoal, botInput, createBot, setGoal, type Bot } from './bot';
import { navFromBytes, type Nav } from './nav';

/**
 * T1: a bot follows the baked navmesh across the real greybox colliders using
 * the SAME WASM movement code as the player. This is the load-bearing Phase 4
 * property — if bots ever get a bespoke mover, this test is where it shows.
 *
 * Phase 6.2: movement runs in the WASM sim. The test loads map colliders into
 * the WASM world and uses sim_tick to advance the bot.
 */
const navBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../assets/maps/de_douglas.navmesh.bin', import.meta.url))),
);

function tickBotWasm(bot: Bot): void {
  const { buttons, yaw } = botInput(bot);
  const s = sim_tick(bot.wasmIndex, buttons, yaw);
  bot.position.set(s[0]!, s[1]!, s[2]!);
  bot.velocity.set(s[3]!, s[4]!, s[5]!);
  bot.onGround = s[6]! === 1;
  bot.eyeHeight = s[7]!;
  bot.duckAmount = s[9]!;
}

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

    // Build the same map colliders in the WASM sim world. Use the bot spawn as
    // the sim_init position so player 0 IS the bot (no need for sim_add_player).
    sim_init(spawn.x, spawn.y, spawn.z);
    for (const b of MAP_BOXES) {
      sim_add_box(b.c[0], b.c[1], b.c[2], b.s[0] / 2, b.s[1] / 2, b.s[2] / 2, b.ry ?? 0);
    }
    for (const r of MAP_RAMPS) {
      sim_add_ramp(r.start[0], r.start[1], r.start[2], r.end[0], r.end[1], r.end[2], r.width, r.thickness);
    }

    // Bot uses wasmIndex 0 — the human-body-in-the-way problem doesn't apply
    // because body exclusion is only for the same player's shapecasts.
    const bot = createBot(world, spawn, 0);
    setGoal(bot, nav, target);
    expect(bot.path.length).toBeGreaterThan(1);

    let ticks = 0;
    const MAX_TICKS = 30 * 64;
    while (!atGoal(bot) && ticks < MAX_TICKS) {
      tickBotWasm(bot);
      expect(bot.position.y).toBeGreaterThan(-1);
      expect(bot.position.y).toBeLessThan(3);
      ticks++;
    }

    expect(atGoal(bot)).toBe(true);
    const dx = bot.position.x - target.x;
    const dz = bot.position.z - target.z;
    expect(Math.hypot(dx, dz)).toBeLessThan(1.5);
  });

  it('stands still with no goal', () => {
    const world = createWorld();
    buildMapColliders(world);

    const spawn = new Vector3(T_SPAWN[0], T_SPAWN[1], T_SPAWN[2]);

    sim_init(spawn.x, spawn.y, spawn.z);
    sim_add_box(0, -0.5, 0, 50, 0.5, 50, 0);

    const bot = createBot(world, spawn, 0);

    for (let t = 0; t < 64; t++) tickBotWasm(bot);

    expect(Math.hypot(bot.velocity.x, bot.velocity.z)).toBeLessThan(0.01);
  });
});
