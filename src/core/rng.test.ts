import { describe, it, expect } from 'vitest';
import { makeRng } from './rng';

describe('makeRng (mulberry32)', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs across seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('stays in [0, 1)', () => {
    const r = makeRng(999);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
