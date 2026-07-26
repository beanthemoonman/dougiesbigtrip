import { describe, expect, it } from 'vitest';
import { advanceStride, STEP_STRIDE, STEP_MIN_SPEED } from './footsteps';

const DT = 1 / 64;

/** Run n ticks at a constant ground speed, counting steps. */
function walk(speed: number, ticks: number, dist = 0): { steps: number; dist: number } {
  let steps = 0;
  for (let i = 0; i < ticks; i++) {
    const r = advanceStride(dist, speed, DT);
    dist = r.dist;
    if (r.stepped) steps++;
  }
  return { steps, dist };
}

describe('advanceStride', () => {
  it('steps once per STEP_STRIDE metres travelled', () => {
    // 5 m/s for 4 s = 20 m => floor(20 / 1.9) = 10 steps.
    const { steps } = walk(5, 4 * 64);
    expect(steps).toBe(Math.floor((5 * 4) / STEP_STRIDE));
  });

  it('steps twice as often at twice the speed', () => {
    const slow = walk(3, 64 * 4).steps;
    const fast = walk(6, 64 * 4).steps;
    expect(fast).toBe(slow * 2);
  });

  it('is silent below the minimum speed', () => {
    expect(walk(STEP_MIN_SPEED - 0.01, 64 * 10).steps).toBe(0);
  });

  it('discards accumulated distance when you stop', () => {
    // Walk almost a full stride, stop, then start again: the first step after
    // starting must be a fresh full stride away, not instant.
    const primed = walk(5, 24); // 24/64 * 5 = 1.875 m, just under STEP_STRIDE
    expect(primed.steps).toBe(0);
    expect(primed.dist).toBeGreaterThan(STEP_STRIDE * 0.9);
    const stopped = advanceStride(primed.dist, 0, DT);
    expect(stopped.stepped).toBe(false);
    expect(stopped.dist).toBe(0);
  });

  it('does not accumulate while airborne (speed passed as 0)', () => {
    expect(walk(0, 64 * 5).dist).toBe(0);
  });

  it('never carries more than one stride of debt', () => {
    // A single huge tick yields one step, not a burst, and leaves no backlog.
    const r = advanceStride(0, 100, DT * 10);
    expect(r.stepped).toBe(true);
    expect(r.dist).toBe(0);
  });
});
