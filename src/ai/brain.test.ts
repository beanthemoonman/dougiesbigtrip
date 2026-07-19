import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeRng } from '../core/rng';
import { addStaticBox, createWorld, initPhysics } from '../physics/world';
import { createBot } from './bot';
import { createBrain, DIFFICULTIES, hearSound, killBot, tickBrain } from './brain';
import { navFromBytes, type Nav } from './nav';

/**
 * T1: the bot FSM against real Rapier geometry. Covers the behaviours that make
 * bots fair: a reaction delay before firing, no fire without LOS, and losing a
 * target that breaks line of sight. Nav is the baked blob; engage doesn't path,
 * but Reposition does, so a real Nav keeps it honest.
 */
const DT = 1 / 64;
const navBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../assets/maps/de_douglas.navmesh.bin', import.meta.url))),
);

/** A floor so the bot stays grounded during the standing engage tests. */
function worldWithFloor() {
  const world = createWorld();
  addStaticBox(world, { x: 0, y: -0.5, z: -5 }, { x: 20, y: 0.5, z: 20 });
  return world;
}

describe('brain FSM', () => {
  let nav: Nav;
  beforeAll(async () => {
    await initPhysics();
    nav = await navFromBytes(navBytes);
  });

  it('acquires a visible target, waits out the reaction delay, then fires', () => {
    const world = worldWithFloor();
    world.step();
    const bot = createBot(world, new Vector3(0, 0.05, 0));
    const brain = createBrain(bot, DIFFICULTIES.normal);
    const rng = makeRng(1);
    const target = new Vector3(0, 0.05, -5); // straight ahead, in the open

    // No fire before the reaction time elapses.
    const reactionTicks = Math.ceil(DIFFICULTIES.normal.reactionTime / DT);
    for (let t = 0; t < reactionTicks - 1; t++) {
      expect(tickBrain(brain, world, nav, rng, target, true, DT).fire).toBe(false);
    }
    expect(brain.mode).toBe('engage');

    // Fires within a short window after the delay (aim is basically on target).
    let fired = false;
    for (let t = 0; t < 32 && !fired; t++) {
      fired = tickBrain(brain, world, nav, rng, target, true, DT).fire;
    }
    expect(fired).toBe(true);
  });

  it('never fires at a target it cannot see (wall between)', () => {
    const world = worldWithFloor();
    addStaticBox(world, { x: 0, y: 1, z: -2.5 }, { x: 3, y: 2, z: 0.25 }); // wall
    world.step();
    const bot = createBot(world, new Vector3(0, 0.05, 0));
    const brain = createBrain(bot, DIFFICULTIES.hard);
    const rng = makeRng(2);
    const target = new Vector3(0, 0.05, -5);

    for (let t = 0; t < 128; t++) {
      expect(tickBrain(brain, world, nav, rng, target, true, DT).fire).toBe(false);
    }
    expect(brain.mode).toBe('idle'); // never acquired
  });

  it('loses a target that dies mid-engage and gives up to idle', () => {
    const world = worldWithFloor();
    world.step();
    const bot = createBot(world, new Vector3(0, 0.05, 0));
    const brain = createBrain(bot, DIFFICULTIES.easy);
    const rng = makeRng(3);
    const target = new Vector3(0, 0.05, -5);

    tickBrain(brain, world, nav, rng, target, true, DT);
    expect(brain.mode).toBe('engage');

    // Target dies: no longer visible. Bot should reposition, then give up.
    const giveUpTicks = Math.ceil((DIFFICULTIES.easy.loseMemory + 1) / DT);
    let sawReposition = false;
    for (let t = 0; t < giveUpTicks; t++) {
      tickBrain(brain, world, nav, rng, target, false, DT);
      if (brain.mode === 'reposition') sawReposition = true;
    }
    expect(sawReposition).toBe(true);
    expect(brain.mode).toBe('idle');
  });

  it('a heard sound switches an idle bot to investigate', () => {
    const world = worldWithFloor();
    world.step();
    const bot = createBot(world, new Vector3(0, 0.05, 0));
    const brain = createBrain(bot, DIFFICULTIES.normal);
    hearSound(brain, new Vector3(0, 0.05, -5));
    expect(brain.mode).toBe('investigate');
    expect(brain.lastKnown).not.toBeNull();
  });

  it('Dead is terminal: no fire, no state change', () => {
    const world = worldWithFloor();
    world.step();
    const bot = createBot(world, new Vector3(0, 0.05, 0));
    const brain = createBrain(bot, DIFFICULTIES.hard);
    const rng = makeRng(4);
    killBot(brain);
    const target = new Vector3(0, 0.05, -5);
    for (let t = 0; t < 32; t++) {
      expect(tickBrain(brain, world, nav, rng, target, true, DT).fire).toBe(false);
      expect(brain.mode).toBe('dead');
    }
  });
});
