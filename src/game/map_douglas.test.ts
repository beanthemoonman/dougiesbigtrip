import { describe, expect, it } from 'vitest';
import { CT_SPAWN, MAP_BOXES, T_SPAWN } from './map_douglas';

// Data sanity, not a movement sim. These are the layout invariants that, if
// broken by an edit to the generated box list, silently produce an unplayable
// or unfair map: a spawn buried in the floor, or a lopsided (non-mirror) layout
// that gives one team more cover than the other.
//
// The map is a capital "D": straight west spine wall, curved east flank. See
// tools/maps/build_douglas.mjs (the generator) and the JSON _comment.

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe('greybox map data', () => {
  it('both spawns rest just above the floor, at the west spine, front-to-back mirrored', () => {
    for (const s of [T_SPAWN, CT_SPAWN]) {
      expect(s[1]).toBeGreaterThan(0); // above floor top (y=0)
      expect(s[1]).toBeLessThan(0.3); // feet on the ground, not floating
      expect(s[0]).toBeLessThan(-8); // tucked against the west spine, not out in the curve
      expect(Math.abs(s[2])).toBeGreaterThan(20); // at an end of the spine, not mid
      expect(Math.abs(s[2])).toBeLessThan(30); // inside the perimeter
    }
    // The two spawns mirror across z=0 (the X axis): same x/y, opposite z.
    expect(close(T_SPAWN[0], CT_SPAWN[0])).toBe(true);
    expect(close(T_SPAWN[1], CT_SPAWN[1])).toBe(true);
    expect(close(T_SPAWN[2], -CT_SPAWN[2])).toBe(true);
  });

  it('is mirror-symmetric across z=0 (the X axis) — T half == CT half, fair', () => {
    // The whole point of the layout: every box has a twin at (x, -z) with the
    // same size and negated yaw. If an edit reintroduces lopsidedness (cover on
    // one end only), some box loses its twin and this fails. Guards fairness.
    for (const b of MAP_BOXES) {
      const twin = MAP_BOXES.find(
        (o) =>
          close(o.c[0], b.c[0]) &&
          close(o.c[1], b.c[1]) &&
          close(o.c[2], -b.c[2]) &&
          close(o.s[0], b.s[0]) &&
          close(o.s[1], b.s[1]) &&
          close(o.s[2], b.s[2]) &&
          close(o.ry ?? 0, -(b.ry ?? 0)),
      );
      expect(twin, `box at [${b.c.join(', ')}] has no z-mirror twin`).toBeDefined();
    }
  });

  it('has a straight west spine wall closed by a curved east flank', () => {
    // Spine: a tall wall on the x=-22 edge spanning the full depth.
    const spine = MAP_BOXES.find((b) => close(b.c[0], -22) && b.s[2] > 50);
    expect(spine, 'missing straight west spine wall').toBeDefined();
    // Curve: several yaw-angled wall segments out in the +x bulge.
    const angled = MAP_BOXES.filter((b) => (b.ry ?? 0) !== 0 && b.c[0] > -22);
    expect(angled.length).toBeGreaterThan(4);
  });
});
