import { describe, expect, it } from 'vitest';
import { crosshairGapPx, MIN_GAP_PX } from './hud';
import { WEAPONS } from '../weapons/defs';
import { computeSpread } from '../weapons/spread';

// A 1080p 16:9 viewport at the renderer's fixed 90 deg horizontal FOV.
const V_FOV_1080P = 2 * Math.atan(Math.tan(Math.PI / 4) / (16 / 9));
const HEIGHT = 1080;

describe('crosshairGapPx', () => {
  it('projects the spread cone onto the screen: tan(spread) scaled by the half-height', () => {
    // Half the viewport height subtends exactly half the vertical FOV, so a
    // cone of that radius must land the gap at exactly half-height.
    const gap = crosshairGapPx(V_FOV_1080P / 2, V_FOV_1080P, HEIGHT);
    expect(gap).toBeCloseTo(HEIGHT / 2, 6);
  });

  it('grows monotonically with spread', () => {
    const gaps = [0.01, 0.02, 0.05, 0.1].map((s) => crosshairGapPx(s, V_FOV_1080P, HEIGHT));
    const sorted = [...gaps].sort((a, b) => a - b);
    expect(gaps).toEqual(sorted);
    expect(new Set(gaps).size).toBe(gaps.length);
  });

  it('scales with viewport height (same angle = same fraction of the screen)', () => {
    const at1080 = crosshairGapPx(0.05, V_FOV_1080P, 1080);
    const at540 = crosshairGapPx(0.05, V_FOV_1080P, 540);
    expect(at1080 / at540).toBeCloseTo(2, 6);
  });

  it('never collapses below the minimum readable gap', () => {
    expect(crosshairGapPx(0, V_FOV_1080P, HEIGHT)).toBe(MIN_GAP_PX);
  });

  it('opens up as the rifle sprays and as the stance degrades', () => {
    const rifle = WEAPONS.rifle;
    const still = crosshairGapPx(computeSpread(rifle, 'still', 0), V_FOV_1080P, HEIGHT);
    const deepSpray = crosshairGapPx(computeSpread(rifle, 'still', 10), V_FOV_1080P, HEIGHT);
    const airborne = crosshairGapPx(computeSpread(rifle, 'air', 0), V_FOV_1080P, HEIGHT);

    expect(deepSpray).toBeGreaterThan(still);
    expect(airborne).toBeGreaterThan(deepSpray);
    // A standing first shot should read as a tight CS-like crosshair, not a
    // dinner plate: single-digit pixels at 1080p.
    expect(still).toBeLessThan(10);
  });
});
