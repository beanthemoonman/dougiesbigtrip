import { describe, expect, it } from 'vitest';
import { STANDING_HEIGHT } from '../player/constants';
import { BONES_Y_SPAN, hitboxAt, hitboxRay } from './hitbox';

describe('hitboxAt', () => {
  const feet = 3; // arbitrary world feet height — bands are relative
  const at = (frac: number) => hitboxAt(feet, feet + frac * STANDING_HEIGHT);

  it('maps height bands to zones, feet→crown', () => {
    expect(at(1.0)).toBe('head'); // crown
    expect(at(0.9)).toBe('head');
    expect(at(0.75)).toBe('chest');
    expect(at(0.55)).toBe('stomach');
    expect(at(0.2)).toBe('leg');
    expect(at(0)).toBe('leg'); // feet
  });

  it('is monotone in severity from top down (head only at the very top)', () => {
    expect(at(0.87)).not.toBe('head');
  });
});

// Fire a horizontal ray toward -Z through (x, y) at a bot at the origin facing
// -Z (yaw 0). Golden zones are read off build_characters.py box geometry.
const shoot = (x: number, y: number, yaw = 0, px = 0, pz = 0) =>
  hitboxRay(x, y, 5, 0, 0, -1, px, 0, pz, yaw);

describe('hitboxRay (per-bone)', () => {
  it('hits the head through the face', () => {
    expect(shoot(0, 1.64)).toBe('head');
  });

  it('a high shot off to the side is NOT a headshot (the whole point vs. bands)', () => {
    expect(shoot(0.3, 1.64)).toBeNull(); // head is only ~19 cm wide
    expect(hitboxAt(0, 1.64)).toBe('head'); // the old band would have called it one
  });

  it('resolves chest, stomach, arm, and leg from geometry', () => {
    expect(shoot(0, 1.37)).toBe('chest');
    expect(shoot(0, 1.16)).toBe('stomach');
    expect(shoot(0.24, 1.24)).toBe('arm'); // upper arm at the shoulder line
    expect(shoot(0.11, 0.3)).toBe('leg'); // shin
  });

  it('accounts for body yaw', () => {
    expect(hitboxRay(5, 1.64, 0, -1, 0, 0, 0, 0, 0, Math.PI / 2)).toBe('head');
  });

  it('accounts for bot position', () => {
    expect(shoot(3, 1.64, 0, 3, 0)).toBe('head'); // bot moved to x=3
    expect(shoot(0, 1.64, 0, 3, 0)).toBeNull(); // old spot now misses
  });

  it('a shot below the feet or above the crown misses', () => {
    const [lo, hi] = BONES_Y_SPAN;
    expect(shoot(0, lo - 0.05)).toBeNull();
    expect(shoot(0, hi + 0.05)).toBeNull();
  });
});
