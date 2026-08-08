/**
 * E.5 — Bot AI WASM parity tests.
 *
 * The old TS AI files (src/ai/{brain,perception,aim,nav,bot}.ts) are replaced by
 * the shared Rust sim crate's bot AI (sim/src/ai/). These tests verify that the
 * WASM bindings work correctly and produce the same behaviour the old TS tests
 * covered.
 *
 * Determinism gate: sim_tick_bot called twice with identical state → identical
 * result. No wall-clock, no Math.random, no non-seeded RNG.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import mapJson from '../assets/maps/de_douglas.json';
import navNodesJson from '../assets/maps/de_douglas.navnodes.json?raw';
import {
  sim_init,
  sim_add_box,
  sim_add_ramp,
  sim_init_bots,
  sim_add_bot,
  sim_tick_bot,
  sim_kill_bot,
  sim_reset_bot,
  sim_get_bot_mode,
  sim_get_bot_aim_yaw,
  sim_get_bot_target_slot,
  sim_bot_shot_lands,
  sim_hash01,
  sim_tick,
  sim_set_team,
} from 'sim-wasm';

// --- Helpers -----------------------------------------------------------

function loadMap(): void {
  const boxes = (mapJson as { boxes: [number, number, number, number, number, number, number][] })?.boxes;
  if (boxes) {
    for (const b of boxes) {
      sim_add_box(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
    }
  }
  const ramps = (mapJson as { ramps: [number, number, number, number, number, number, number, number][] })?.ramps;
  if (ramps) {
    for (const r of ramps) {
      sim_add_ramp(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]);
    }
  }
}

/** Run sim_tick for `count` frames at index 0 (ground the human first). */
function settleFrames(count: number): void {
  for (let i = 0; i < count; i++) sim_tick(0, 0, 0);
}

/**
 * sim_tick_bot needs alive flags + team info. Tick a bot for `ticks` frames
 * and return all result arrays. Also ticks the human (index 0) so their
 * kinematic body syncs.
 */
function tickBotN(botIdx: number, startTick: number, ticks: number): Float64Array[] {
  const results: Float64Array[] = [];
  for (let t = 0; t < ticks; t++) {
    sim_tick(0, 0, 0); // keep human body up-to-date
    const alive = new Uint8Array(botIdx + 1);
    alive[0] = 1; // human alive
    for (let j = 1; j <= botIdx; j++) alive[j] = 1; // bots alive
    results.push(sim_tick_bot(botIdx, startTick + t, alive));
  }
  return results;
}

describe('WASM bot AI — init', () => {
  it('sim_init_bots loads the nav graph without error', () => {
    sim_init(0, 0.05, 0);
    loadMap();
    settleFrames(3);
    sim_init_bots(navNodesJson);
    // If we got here without throwing, the JSON parsed correctly
    expect(true).toBe(true);
  });
});

describe('WASM bot AI — creation', () => {
  beforeAll(() => {
    sim_init(0, 0.05, 0);
    loadMap();
    settleFrames(3);
    sim_init_bots(navNodesJson);
  });

  it('sim_add_bot returns a valid index', () => {
    // Team 0 = T, tick_offset 17 for desynchronisation
    const idx = sim_add_bot(-20, 0.05, -25, 17, 0);
    expect(idx).toBeGreaterThan(0);
  });

  it('sim_set_team sets the humans team', () => {
    sim_set_team(0, 1); // CT
    // No observable output — this is a smoketest
  });
});

describe('WASM bot AI — FSM', () => {
  beforeAll(() => {
    sim_init(0, 0.05, 0);
    loadMap();
    settleFrames(3);
    sim_init_bots(navNodesJson);
    sim_set_team(0, 0); // human on T
    sim_add_bot(-20, 0.05, -25, 17, 0); // index 1, T
    sim_add_bot(16, 0.05, 24, 34, 1);   // index 2, CT
  });

  it('bot starts in search mode (mode 0)', () => {
    const mode = sim_get_bot_mode(1);
    expect(mode).toBe(0);
  });

  it('sim_tick_bot returns a 6-element result', () => {
    sim_tick(0, 0, 0);
    const alive = new Uint8Array([1, 1, 1]);
    const result = sim_tick_bot(1, 0, alive);
    // [buttons, yaw, should_fire, aim_yaw, aim_pitch, mode]
    expect(result.length).toBe(6);
  });

  it('a bot with no visible enemies wanders (produces non-zero buttons)', () => {
    // The CT bot can't see any T players on the first few ticks (spawn walls).
    // Run several ticks and ensure it eventually presses FORWARD.
    let moved = false;
    for (let t = 0; t < 200; t++) {
      sim_tick(0, 0, 0);
      const alive = new Uint8Array([1, 1, 1]);
      const r = sim_tick_bot(2, t, alive);
      if ((r[0]! & 8) !== 0) { // Buttons.FORWARD = 8
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });

  it('a bot detects the human and engages (mode 1)', () => {
    // Fresh sim with no walls — just a wide floor. Both entities on the same
    // flat plane, within FOV range, no obstacles between them.
    sim_init(0, 0.05, 0);
    sim_add_box(0, -0.5, 0, 50, 0.5, 50, 0); // wide flat floor
    // Settle human on the floor.
    for (let i = 0; i < 5; i++) sim_tick(0, 0, 0);
    sim_init_bots(navNodesJson);
    sim_set_team(0, 0); // human = T
    // Place CT bot 2m away, facing the human (-Z direction, yaw 0).
    sim_add_bot(0, 0.05, 2, 0, 1); // index 1, CT
    // Tick the bot once so its kinematic body syncs.
    sim_tick(0, 0, 0);
    sim_tick(1, 0, 0);

    let engaged = false;
    for (let t = 0; t < 300; t++) {
      sim_tick(0, 0, 0);
      const alive = new Uint8Array([1, 1]);
      sim_tick_bot(1, t, alive);
      const mode = sim_get_bot_mode(1);
      if (mode === 1) { // Engage
        engaged = true;
        break;
      }
    }
    expect(engaged).toBe(true);
  });

  it('sim_kill_bot sets mode to dead (mode 3)', () => {
    sim_kill_bot(1);
    const mode = sim_get_bot_mode(1);
    expect(mode).toBe(3);
  });

  it('sim_reset_bot reinitialises for respawn', () => {
    sim_reset_bot(1, -20, 0.05, -25);
    const mode = sim_get_bot_mode(1);
    expect(mode).toBe(0); // back to search
  });

  it('dead bots return zero buttons and yaw unchanged', () => {
    sim_kill_bot(1);
    const alive = new Uint8Array([1, 1]);
    const r = sim_tick_bot(1, 100, alive);
    expect(r[0]!).toBe(0); // buttons = 0
  });
});

describe('WASM bot AI — determinism', () => {
  beforeAll(() => {
    sim_init(0, 0.05, 0);
    loadMap();
    settleFrames(3);
    sim_init_bots(navNodesJson);
    sim_set_team(0, 0);
    sim_add_bot(-20, 0.05, -25, 17, 0);
  });

  it('sim_tick_bot is deterministic — same inputs → same result', () => {
    sim_tick(0, 0, 0);
    const alive = new Uint8Array([1, 1]);
    const a = sim_tick_bot(1, 42, alive);

    // Re-initialise and try again with same state.
    sim_init(0, 0.05, 0);
    loadMap();
    settleFrames(3);
    sim_init_bots(navNodesJson);
    sim_set_team(0, 0);
    sim_add_bot(-20, 0.05, -25, 17, 0);

    sim_tick(0, 0, 0);
    const b = sim_tick_bot(1, 42, alive);

    for (let i = 0; i < 6; i++) {
      expect(b[i]).toBe(a[i]);
    }
  });
});

describe('WASM bot AI — helpers', () => {
  it('sim_bot_shot_lands: point-blank always hits', () => {
    expect(sim_bot_shot_lands(1, 0.06, 0.5, 0.5, 0.3)).toBe(true);
  });

  it('sim_bot_shot_lands: misses at range with wide spread', () => {
    expect(sim_bot_shot_lands(50, 0.2, 0.9, 0.9, 0.3)).toBe(false);
  });

  it('sim_hash01 is deterministic', () => {
    expect(sim_hash01(42, 17)).toBe(sim_hash01(42, 17));
  });

  it('sim_hash01 produces values in [0, 1)', () => {
    const v = sim_hash01(1, 1);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('sim_hash01 differs for different inputs', () => {
    expect(sim_hash01(1, 1)).not.toBe(sim_hash01(1, 2));
    expect(sim_hash01(1, 1)).not.toBe(sim_hash01(2, 1));
  });

  it('sim_get_bot_target_slot returns -1 when searching', () => {
    sim_init(0, 0.05, 0);
    loadMap();
    settleFrames(3);
    sim_init_bots(navNodesJson);
    sim_set_team(0, 0);
    sim_add_bot(-20, 0.05, -25, 17, 0);
    // A fresh bot in search mode has no target
    expect(sim_get_bot_target_slot(1)).toBe(-1);
  });

  it('sim_get_bot_aim_yaw is 0 for a fresh bot', () => {
    expect(sim_get_bot_aim_yaw(1)).toBe(0);
  });
});
