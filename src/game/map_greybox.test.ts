import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, STEP_HEIGHT } from '../player/constants';
import { CT_SPAWN, MAP_BOXES, T_SPAWN } from './map_greybox';

// Data sanity, not a movement sim. These are the layout invariants that, if
// broken by an edit to the box list, silently produce an unplayable map:
// a spawn buried in the floor, a choke too narrow to walk, a step too tall.

const HULL_DIAMETER = PLAYER_RADIUS * 2;

/** top y of a box's collider */
const topOf = (b: (typeof MAP_BOXES)[number]) => b.c[1] + b.s[1] / 2;

describe('greybox map data', () => {
  it('both spawns rest just above the floor and inside the perimeter', () => {
    for (const s of [T_SPAWN, CT_SPAWN]) {
      expect(s[1]).toBeGreaterThan(0); // above floor top (y=0)
      expect(s[1]).toBeLessThan(0.3); // feet on the ground, not floating
      expect(Math.abs(s[0])).toBeLessThan(12); // inside x walls
      expect(Math.abs(s[2] + 1)).toBeLessThan(21); // inside z walls (centred at -1)
    }
  });

  it('the mid choke doorway is wider than the player hull', () => {
    // The two choke segments at z=-6; the gap between their inner faces.
    const segs = MAP_BOXES.filter((b) => b.c[2] === -6 && b.s[2] < 1).sort((a, b) => a.c[0] - b.c[0]);
    expect(segs).toHaveLength(2);
    const [left, right] = segs as [(typeof segs)[number], (typeof segs)[number]];
    const leftInner = left.c[0] + left.s[0] / 2;
    const rightInner = right.c[0] - right.s[0] / 2;
    expect(rightInner - leftInner).toBeGreaterThan(HULL_DIAMETER);
  });

  it('the site step-up rises stay under STEP_HEIGHT', () => {
    // Stepping from floor (0) to the step top, and step top to platform top.
    const step = MAP_BOXES.find((b) => b.c[0] === 9 && b.c[2] === 10);
    const platform = MAP_BOXES.find((b) => b.c[0] === 9 && b.c[2] === 12.75);
    if (!step || !platform) throw new Error('step/platform boxes missing');
    const stepTop = topOf(step);
    const platTop = topOf(platform);
    expect(stepTop).toBeLessThan(STEP_HEIGHT);
    expect(platTop - stepTop).toBeLessThan(STEP_HEIGHT);
  });
});
