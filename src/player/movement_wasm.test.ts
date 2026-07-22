/**
 * WASM parity tests — same golden values as movement.test.ts, exercised through
 * the sim-wasm WebAssembly boundary. Kept in the same directory so the golden
 * tables are visibly side-by-side; any divergence is a P0 determinism bug.
 *
 * These tests prove that the Rust sim crate, compiled to wasm32, produces
 * bit-exact results with the TS golden tables from docs/source-movement.md.
 */
import { describe, expect, it } from 'vitest';
import {
  sim_accelerate,
  sim_air_accelerate,
  sim_clip_velocity,
  sim_friction,
} from 'sim-wasm';

const DT = 1 / 64;
const WISHSPEED = 6.35;
const SV_ACCEL = 5.0;
const SV_AIRACCEL = 10.0;

/** WASM returns Float64Array; indexing yields number | undefined in strict mode.
 * This tiny helper collapses the tuple so the rest of the file stays clean. */
function wasm3(r: Float64Array): [number, number, number] {
  return [r[0]!, r[1]!, r[2]!];
}

describe('WASM — Case A — ground acceleration from rest', () => {
  it('matches the reference table', () => {
    let [vx, vy, vz] = [0, 0, 0];
    const wx = 1, wy = 0, wz = 0;
    const expected = [0.49609, 0.83344, 1.17078, 1.50813, 1.84547];

    for (const target of expected) {
      [vx, vy, vz] = wasm3(sim_friction(vx, vy, vz, DT, true, 1));
      [vx, vy, vz] = wasm3(sim_accelerate(vx, vy, vz, wx, wy, wz, WISHSPEED, SV_ACCEL, DT, 1));
      expect(Math.hypot(vx, vy, vz)).toBeCloseTo(target, 4);
    }
  });

  it('converges to exactly wishspeed', () => {
    let [vx, vy, vz] = [0, 0, 0];
    const wx = 1, wy = 0, wz = 0;
    for (let i = 0; i < 500; i++) {
      [vx, vy, vz] = wasm3(sim_friction(vx, vy, vz, DT, true, 1));
      [vx, vy, vz] = wasm3(sim_accelerate(vx, vy, vz, wx, wy, wz, WISHSPEED, SV_ACCEL, DT, 1));
    }
    expect(Math.hypot(vx, vy, vz)).toBeCloseTo(WISHSPEED, 5);
  });
});

describe('WASM — Case B — friction decel from 6.35 m/s', () => {
  it('matches the reference table', () => {
    let [vx, vy, vz] = [6.35, 0, 0];
    const expected = [5.95313, 5.58105, 5.23223, 4.90522, 4.59864];

    for (const target of expected) {
      [vx, vy, vz] = wasm3(sim_friction(vx, vy, vz, DT, true, 1));
      expect(Math.hypot(vx, vy, vz)).toBeCloseTo(target, 4);
    }
  });
});

describe('WASM — airAccelerate asymmetry', () => {
  it('clamps addspeed but computes accelspeed from unclamped wishspeed', () => {
    let [vx, vy, vz] = [10, 0, 0];
    const before = Math.hypot(vx, vz);

    [vx, vy, vz] = wasm3(sim_air_accelerate(vx, vy, vz, 0, 0, 1, WISHSPEED, SV_AIRACCEL, DT, 1));

    expect(Math.hypot(vx, vz)).toBeGreaterThan(before);
    expect(vx).toBeCloseTo(10, 6);
    expect(vz).toBeGreaterThan(0);
  });

  it('adds nothing once at cap along wishdir', () => {
    let [vx, vy, vz] = [0.762, 0, 0];
    [vx, vy, vz] = wasm3(sim_air_accelerate(vx, vy, vz, 1, 0, 0, WISHSPEED, SV_AIRACCEL, DT, 1));
    expect(vx).toBeCloseTo(0.762, 6);
  });
});

describe('WASM — Case C — air strafe snapshot', () => {
  it('matches the frozen TS snapshot within 0.001 per tick', () => {
    let vx = WISHSPEED;
    let vy = 0;
    let vz = 0;
    let heading = Math.atan2(vz, vx);
    const turnRate = Math.PI; // 180 deg/s
    const speeds: number[] = [];

    for (let i = 0; i < 128; i++) {
      heading += turnRate * DT;
      const wx = Math.cos(heading);
      const wz = Math.sin(heading);
      const r = sim_air_accelerate(vx, vy, vz, wx, 0, wz, WISHSPEED, SV_AIRACCEL, DT, 1);
      [vx, vy, vz] = wasm3(r);
      speeds.push(Math.hypot(vx, vz));
    }

    const last = speeds[speeds.length - 1]!;
    expect(last).toBeGreaterThan(WISHSPEED);
    expect(last).toBeGreaterThan(speeds[0]!);

    // Round to 3 decimals (same precision as TS snapshot) for comparison
    expect(speeds.map((s) => Number(s.toFixed(3)))).toMatchSnapshot();
  });
});

describe('WASM — clipVelocity', () => {
  it('removes only the into-plane component', () => {
    const r = sim_clip_velocity(1, -1, 0, 0, 1, 0, 1.0);
    expect(r[0]!).toBeCloseTo(1, 6);
    expect(r[1]!).toBeCloseTo(0, 6);
  });

  it('never leaves result moving into plane', () => {
    const r = sim_clip_velocity(0, -5, 0, 0.6, 0.8, 0, 1.0);
    const dot = r[0]! * 0.6 + r[1]! * 0.8;
    expect(dot).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe('WASM — wishDirFromButtons', () => {
  it('forward is unit length', async () => {
    const { sim_wish_dir } = await import('sim-wasm');
    const r = sim_wish_dir(1, 0); // FORWARD
    expect(Math.hypot(r[0]!, r[1]!)).toBeCloseTo(1, 10);
  });

  it('none returns zero', async () => {
    const { sim_wish_dir } = await import('sim-wasm');
    const r = sim_wish_dir(0, 0);
    expect(r[0]!).toBe(0);
    expect(r[1]!).toBe(0);
  });
});

describe('WASM — 10.0 — residual creep (friction floor)', () => {
  it('friction returns without zeroing below the 0.1 m/s floor', () => {
    const r = sim_friction(0.05, 0, 0, DT, true, 1);
    expect(Math.hypot(r[0]!, r[1]!, r[2]!)).toBeCloseTo(0.05, 8);
  });

  it('friction processes speed exactly at threshold (0.1 is not less than 0.1)', () => {
    const r = sim_friction(0.1, 0, 0, DT, true, 1);
    expect(r[0]!).toBe(0);
    expect(r[1]!).toBe(0);
    expect(r[2]!).toBe(0);
  });

  it('friction decays velocity above threshold', () => {
    const r = sim_friction(0.5, 0, 0, DT, true, 1);
    const speed = Math.hypot(r[0]!, r[1]!, r[2]!);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThan(0.5);
  });

  it('friction leaves a residual below floor', () => {
    const r = sim_friction(0.16, 0, 0, DT, true, 1);
    const speed = Math.hypot(r[0]!, r[1]!, r[2]!);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThan(0.1);
  });
});

describe('WASM — 10.1 — walk/duck speed convergence', () => {
  const WALK_SCALE = 0.52;
  const DUCK_SCALE = 0.34;

  it('walk speed converges to ~52%', () => {
    const target = WISHSPEED * WALK_SCALE;
    let [vx, vy, vz] = [0, 0, 0];
    const wx = 1, wy = 0, wz = 0;
    for (let i = 0; i < 500; i++) {
      [vx, vy, vz] = wasm3(sim_friction(vx, vy, vz, DT, true, 1));
      [vx, vy, vz] = wasm3(sim_accelerate(vx, vy, vz, wx, wy, wz, target, SV_ACCEL, DT, 1));
    }
    expect(Math.hypot(vx, vy, vz)).toBeCloseTo(target, 4);
  });

  it('duck speed converges to ~34%', () => {
    const target = WISHSPEED * DUCK_SCALE;
    let [vx, vy, vz] = [0, 0, 0];
    const wx = 1, wy = 0, wz = 0;
    for (let i = 0; i < 500; i++) {
      [vx, vy, vz] = wasm3(sim_friction(vx, vy, vz, DT, true, 1));
      [vx, vy, vz] = wasm3(sim_accelerate(vx, vy, vz, wx, wy, wz, target, SV_ACCEL, DT, 1));
    }
    expect(Math.hypot(vx, vy, vz)).toBeCloseTo(target, 4);
  });

  it('walk+duck stacks multiplicatively (oscillates, does not converge cleanly)', () => {
    const target = WISHSPEED * WALK_SCALE * DUCK_SCALE;
    let [vx, vy, vz] = [0, 0, 0];
    const wx = 1, wy = 0, wz = 0;
    for (let i = 0; i < 500; i++) {
      [vx, vy, vz] = wasm3(sim_friction(vx, vy, vz, DT, true, 1));
      [vx, vy, vz] = wasm3(sim_accelerate(vx, vy, vz, wx, wy, wz, target, SV_ACCEL, DT, 1));
    }
    const speed = Math.hypot(vx, vy, vz);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThanOrEqual(target);
  });
});
