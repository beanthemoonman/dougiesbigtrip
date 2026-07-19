import { describe, expect, it } from 'vitest';
import { BLOOM } from './renderer';

// Spec: docs/art-direction.md §Post-processing — "Threshold high (0.9),
// strength ~0.15. Only the sky and muzzle flashes should bloom." If these drift
// from the doc, the doc is the spec — change one or the other, not silently.
describe('bloom is very slight (art-direction spec)', () => {
  it('matches the documented threshold and strength', () => {
    expect(BLOOM.threshold).toBe(0.9);
    expect(BLOOM.strength).toBe(0.15);
  });
  it('only supra-unit values (sky/muzzle HDR) cross the threshold', () => {
    expect(BLOOM.threshold).toBeGreaterThan(0.8); // lightmap-lit (<1.0) never blooms
    expect(BLOOM.strength).toBeLessThan(0.3); // never a glow-bomb
  });
});
