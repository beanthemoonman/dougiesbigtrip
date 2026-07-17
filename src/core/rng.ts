/**
 * Seeded RNG — the ONLY source of randomness allowed under src/ (CLAUDE.md
 * determinism rule). mulberry32: fast, tiny, good enough for a spread disc; not
 * cryptographic. Injected everywhere so simulate(trace, {seed}) twice is
 * identical.
 *
 * ponytail: mulberry32, not PCG/xoshiro. Swap only if the spread pattern ever
 * shows visible structure on a wall — it won't at this scale.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
