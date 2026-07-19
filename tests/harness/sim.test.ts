import { describe, expect, it } from 'vitest';
import { Buttons } from '../../src/core/input';
import { simulate, type TraceTick } from './sim';

const FORWARD: TraceTick = { buttons: Buttons.FORWARD, yaw: 0 };

describe('sim harness', () => {
  it('is deterministic: identical trace × 2 → identical result', async () => {
    const trace = { ticks: Array.from({ length: 128 }, () => FORWARD) };
    const a = await simulate(trace);
    const b = await simulate(trace);
    expect(a).toEqual(b);
  });

  it('explicit spawn point is deterministic', async () => {
    const spawn: [number, number, number] = [-8, 0.05, 2];
    const trace = { ticks: Array.from({ length: 64 }, () => FORWARD) };
    const a = await simulate(trace, spawn);
    const b = await simulate(trace, spawn);
    expect(a).toEqual(b);
  });

  it('tick count matches trace length', async () => {
    const r = await simulate({ ticks: Array.from({ length: 40 }, () => FORWARD) });
    expect(r.tick).toBe(40);
  });

  // --- Regression: crate-face free-fall (was infinite vy when touching a wall) ---
  // Repro of movement_map.test.ts "running-jump into a crate face" scenario,
  // surfaced through the harness. Pre-fix: capsule caught on crate edge → every
  // cast returned TOI 0 (stopAtPenetration=true) → velocity zeroed → gravity
  // piled up → y → -inf. Fix: shapecast sweeps with stopAtPenetration=false so
  // a touching capsule slides down and falls.
  const GRAVITY_TERMINAL = 12;
  const FORWARD_YAW_PI: TraceTick = { buttons: Buttons.FORWARD, yaw: Math.PI };

  it('running-jump into a crate face lands, never free-falls forever', async () => {
    const spawn: [number, number, number] = [-12, 0.05, 9.0];
    const ticks: TraceTick[] = [];
    for (let t = 0; t < 120; t++) {
      const jump = t === 25 ? Buttons.JUMP : 0;
      ticks.push({ buttons: Buttons.FORWARD | jump, yaw: Math.PI });
    }

    const r = await simulate({ ticks }, spawn);

    expect(r.position[1]).toBeLessThan(0.15);
    expect(Math.abs(r.velocity[1])).toBeLessThan(GRAVITY_TERMINAL);
    expect(r.position[2]).toBeLessThan(12.25);
  });

  it('walking on flat floor stays grounded', async () => {
    const spawn: [number, number, number] = [-8, 0.05, 2];
    const ticks: TraceTick[] = Array.from({ length: 40 }, () => FORWARD_YAW_PI);

    const r = await simulate({ ticks }, spawn);

    expect(r.position[1]).toBeCloseTo(0, 1);
  });
});
