import { describe, expect, it } from 'vitest';
import { STANDING_HEIGHT } from '../player/constants';
import { hitboxAt } from './hitbox';

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
