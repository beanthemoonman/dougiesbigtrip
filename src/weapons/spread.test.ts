import { describe, it, expect } from 'vitest';
import { WEAPONS } from './defs';
import { computeSpread, STANCE_MULT, type Stance } from './spread';

const rifle = WEAPONS.rifle;

describe('spread model', () => {
  it('crouch-still first shot equals baseSpread', () => {
    expect(computeSpread(rifle, 'crouchStill', 0)).toBeCloseTo(rifle.baseSpread, 5);
  });

  it('tighter crouched than standing than moving than airborne', () => {
    const order: Stance[] = ['crouchStill', 'still', 'walking', 'running', 'air'];
    const vals = order.map((s) => computeSpread(rifle, s, 0));
    vals.reduce((prev, cur) => {
      expect(cur).toBeGreaterThan(prev);
      return cur;
    });
  });

  it('grows with spray index', () => {
    const a = computeSpread(rifle, 'still', 0);
    const b = computeSpread(rifle, 'still', 5);
    expect(b).toBeGreaterThan(a);
  });

  it('air multiplier is the load-bearing one (×20 baseline)', () => {
    expect(STANCE_MULT.air / STANCE_MULT.crouchStill).toBe(20);
  });

  it('is hard-capped — air + deep spray never exceeds the cap', () => {
    const huge = computeSpread(rifle, 'air', 1000);
    expect(huge).toBeLessThanOrEqual(0.2);
  });

  it('negative/zero sprayIndex both mean "first shot", no growth', () => {
    expect(computeSpread(rifle, 'still', -1)).toBeCloseTo(computeSpread(rifle, 'still', 0), 5);
  });
});
