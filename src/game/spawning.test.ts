import { describe, expect, it } from 'vitest';
import { spawnRing } from './spawning';

describe('spawnRing', () => {
  it('produces correct count per side', () => {
    expect(spawnRing('CT', 3)).toHaveLength(3);
    expect(spawnRing('T', 5)).toHaveLength(5);
    expect(spawnRing('CT', 0)).toHaveLength(0);
    expect(spawnRing('CT', 10)).toHaveLength(10);
  });

  it('produces the exact original 6 positions at 3v3 (regression)', () => {
    const ct = spawnRing('CT', 3);
    const t = spawnRing('T', 3);

    expect(ct).toHaveLength(3);
    expect(t).toHaveLength(3);

    const c0 = ct[0]!, c1 = ct[1]!, c2 = ct[2]!;
    const t0 = t[0]!, t1 = t[1]!, t2 = t[2]!;

    expect(c0.x).toBe(-18);
    expect(c0.z).toBe(25);
    expect(c1.x).toBe(-13);
    expect(c1.z).toBe(26);
    expect(c2.x).toBe(-10);
    expect(c2.z).toBe(24);

    expect(t0.x).toBe(-18);
    expect(t0.z).toBe(-25);
    expect(t1.x).toBe(-13);
    expect(t1.z).toBe(-26);
    expect(t2.x).toBe(-10);
    expect(t2.z).toBe(-24);
  });

  it('all positions share the same Y (ground level)', () => {
    const ct = spawnRing('CT', 7);
    const y0 = ct[0]!.y;
    for (const p of ct) expect(p.y).toBe(y0);
  });

  it('positions are distinct', () => {
    const ct = spawnRing('CT', 10);
    const keys = ct.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`);
    expect(new Set(keys).size).toBe(10);
  });

  it('CT and T are z-mirrored', () => {
    const ct = spawnRing('CT', 4);
    const t = spawnRing('T', 4);
    for (let i = 0; i < 4; i++) {
      expect(ct[i]!.x).toBe(t[i]!.x);
      expect(ct[i]!.z).toBe(-t[i]!.z);
      expect(ct[i]!.y).toBe(t[i]!.y);
    }
  });

  it('is deterministic', () => {
    const a = spawnRing('CT', 5);
    const b = spawnRing('CT', 5);
    for (let i = 0; i < 5; i++) {
      expect(a[i]!.x).toBe(b[i]!.x);
      expect(a[i]!.y).toBe(b[i]!.y);
      expect(a[i]!.z).toBe(b[i]!.z);
    }
  });
});
