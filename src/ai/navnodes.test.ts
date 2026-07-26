import { describe, expect, it } from 'vitest';
import { NAVNODES, SearchScore, hash01 } from './navnodes';

/**
 * T1: the shared search-goal formula (docs/plan-phase11-bot-ai.md). Two
 * properties matter — the pick must vary (bots stop running the same route) and
 * it must stay deterministic (T1 replays), which the hash jitter gives us for
 * free. Third property: same-pole repulsion, a node with a teammate parked on
 * it must lose to the same node with the map empty.
 */
const NO_TEAMMATES: readonly (readonly [number, number, number])[] = [];

describe('search goal selection', () => {
  it('is deterministic for the same (seed, tick)', () => {
    const s = new SearchScore();
    const a = s.pickSearchNode(0, { x: 0, y: 0, z: 0 }, 1000, NO_TEAMMATES, undefined, 7);
    const b = s.pickSearchNode(0, { x: 0, y: 0, z: 0 }, 1000, NO_TEAMMATES, undefined, 7);
    expect(a).toBe(b);
  });

  it('spreads picks across the map instead of collapsing onto one node', () => {
    const s = new SearchScore();
    const picked = new Set<number>();
    for (let seed = 0; seed < 24; seed++) {
      picked.add(s.pickSearchNode(0, { x: 0, y: 0, z: 0 }, 1000 + seed * 64, NO_TEAMMATES, undefined, seed));
    }
    // Before the jitter this was always the single highest-scoring node.
    expect(picked.size).toBeGreaterThan(6); // of 13 nodes
  });

  it('repels from teammates (same-pole magnetism)', () => {
    const s = new SearchScore();
    const empty = s.pickSearchNode(0, { x: 0, y: 0, z: 0 }, 1000, NO_TEAMMATES, undefined, 3);
    const at = NAVNODES.nodes[empty]!;
    const crowded = s.pickSearchNode(0, { x: 0, y: 0, z: 0 }, 1000, [at], undefined, 3);
    expect(crowded).not.toBe(empty);
  });

  it('hash01 stays in [0,1)', () => {
    for (let i = 0; i < 100; i++) {
      const h = hash01(i * 7919, i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});
