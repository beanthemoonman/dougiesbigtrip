import { describe, expect, it } from 'vitest';
import { STEP_HEIGHT } from '../player/constants';
import { CT_SPAWN, MAP_BOXES, T_SPAWN } from './map_greybox';

// Data sanity, not a movement sim. These are the layout invariants that, if
// broken by an edit to the box list, silently produce an unplayable or unfair
// map: a spawn buried in the floor, a lopsided (non-symmetric) layout, or a
// step too tall to climb.

/** top y of a box's collider */
const topOf = (b: (typeof MAP_BOXES)[number]) => b.c[1] + b.s[1] / 2;

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe('greybox map data', () => {
  it('both spawns rest just above the floor and inside the perimeter', () => {
    for (const s of [T_SPAWN, CT_SPAWN]) {
      expect(s[1]).toBeGreaterThan(0); // above floor top (y=0)
      expect(s[1]).toBeLessThan(0.3); // feet on the ground, not floating
      expect(Math.abs(s[0])).toBeLessThan(12); // inside x walls
      expect(Math.abs(s[2])).toBeLessThan(21); // inside z walls (floor centred at 0)
    }
  });

  it('is 180-degree rotationally symmetric about the origin (T half == CT half, fair)', () => {
    // The whole point of the layout: every box has a twin at (-x, -z) with the
    // same y and size. If an edit reintroduces lopsidedness (cover on one end
    // only), some box loses its twin and this fails. Guards fairness directly.
    for (const b of MAP_BOXES) {
      const twin = MAP_BOXES.find(
        (o) =>
          close(o.c[0], -b.c[0]) &&
          close(o.c[1], b.c[1]) &&
          close(o.c[2], -b.c[2]) &&
          close(o.s[0], b.s[0]) &&
          close(o.s[1], b.s[1]) &&
          close(o.s[2], b.s[2]),
      );
      expect(twin, `box at [${b.c.join(', ')}] has no 180-degree twin`).toBeDefined();
    }
  });

  it('the east flank step-up rises stay under STEP_HEIGHT', () => {
    // East platform is reached by a step: floor (0) -> step top -> platform top.
    const step = MAP_BOXES.find((b) => b.c[0] === 8.5 && b.c[2] === 6.7);
    const platform = MAP_BOXES.find((b) => b.c[0] === 8.5 && b.c[2] === 9);
    if (!step || !platform) throw new Error('step/platform boxes missing');
    const stepTop = topOf(step);
    const platTop = topOf(platform);
    expect(stepTop).toBeLessThan(STEP_HEIGHT);
    expect(platTop - stepTop).toBeLessThan(STEP_HEIGHT);
  });
});
