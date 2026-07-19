import { describe, expect, it } from 'vitest';
import { makeRng } from '../core/rng';
import { noiseField } from './surfacetex';

// The one property that silently ruins a tiling texture is a seam: the field must
// wrap so u=0 and u=1 (and v=0/v=1) sample the same value. Seamlessness is what
// lets one 256² detail map cover a whole wall without a visible grid.
describe('noiseField', () => {
  const n = noiseField(makeRng(123), 16);

  it('wraps horizontally and vertically (no seam)', () => {
    for (const t of [0, 0.25, 0.5, 0.73]) {
      expect(n(0, t)).toBeCloseTo(n(1, t), 10);
      expect(n(t, 0)).toBeCloseTo(n(t, 1), 10);
    }
  });

  it('stays in [0,1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = n((i * 7) % 100 / 100, (i * 13) % 100 / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = noiseField(makeRng(42), 8);
    const b = noiseField(makeRng(42), 8);
    expect(a(0.3, 0.6)).toBe(b(0.3, 0.6));
  });
});
