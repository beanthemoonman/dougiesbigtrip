import { describe, expect, it } from 'vitest';
import { spawnRing } from './spawning';
import { PROP_PLACEMENTS } from './props';
import { MAP_BOXES } from './map_douglas';

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

  // A bot spawned on top of a prop is wedged there for the whole round: the
  // spawn is not nav-snapped and collide-and-slide has nowhere to push it.
  // 1.2 m ≈ bot capsule radius + the widest prop's half-extent + slack.
  it('no spawn at max count lands on a prop', () => {
    for (const team of ['CT', 'T'] as const) {
      for (const p of spawnRing(team, 5)) {
        for (const [, px, pz] of PROP_PLACEMENTS) {
          const d = Math.hypot(p.x - px, p.z - pz);
          expect(d, `${team} spawn ${p.x},${p.z} vs prop ${px},${pz}`).toBeGreaterThan(1.2);
        }
      }
    }
  });

  // Same failure mode as the prop case, and worse: a spawn inside a wall box
  // leaves the bot permanently stuck. Axis-aligned test — the rotated (`ry`)
  // curve segments are all in the east arc, nowhere near either spawn pocket.
  it('no spawn at max count lands in a wall', () => {
    const walls = MAP_BOXES.filter((b) => b.s[1] > 0.5 && b.ry === undefined);
    for (const team of ['CT', 'T'] as const) {
      for (const p of spawnRing(team, 5)) {
        for (const b of walls) {
          const dx = Math.max(Math.abs(p.x - b.c[0]) - b.s[0] / 2, 0);
          const dz = Math.max(Math.abs(p.z - b.c[2]) - b.s[2] / 2, 0);
          const where = `${team} spawn ${p.x},${p.z} vs wall ${b.c[0]},${b.c[2]}`;
          expect(Math.hypot(dx, dz), where).toBeGreaterThan(0.6); // bot capsule radius + slack
        }
      }
    }
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
