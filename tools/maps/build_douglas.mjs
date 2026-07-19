// Generate assets/maps/de_douglas.json — the "capital D" greybox layout.
// (D for Douglas.)
//
// The map is a D lying on its back: a straight WEST wall (the spine) at x=WALL_X
// running the full z range, closed by a half-ellipse CURVE bulging EAST. Inside
// sits the D's COUNTER — a smaller walled-off island (the "hole" in the letter),
// so the play space is a LOOP: the dense WEST SPINE corridor is the direct lane
// between spawns; the sparse EAST ARC is the long flank around the hole.
//
// T and CT spawn behind walls at the two ends of the spine (z-/z+).
//
// Symmetry: MIRROR across z=0 (the X axis). Every element authored at z>0 is
// emitted twice — once as-is, once reflected to -z with its yaw negated — so the
// T half and CT half are identical and fair. Elements on z=0 are self-symmetric
// and emitted once. map_douglas.test.ts asserts this mirror invariance.
//
// Run: node tools/maps/build_douglas.mjs   (rewrites the JSON in place)
// ponytail: parametric so both arcs are computed, not hand-typed wall segments.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../assets/maps/de_douglas.json');

// docs/art-direction.md palette (hex ints).
const CONCRETE = 0xa5a29b;
const CONCRETE_DARK = 0x5e5c58;
const SAND = 0xc9ae7c;
const WOOD = 0x7a5b3c;

// Outer D. West spine wall at x=WALL_X, z in [-HALF_Z, +HALF_Z]; curve is a
// half-ellipse centred at (WALL_X, 0), x-reach A, z-reach HALF_Z.
const WALL_X = -22;
const HALF_Z = 30;
const A = 44; // apex at x = WALL_X + A = 22  ->  arena 44 wide, 60 deep
// Inner D (the hole / counter). Same shape, scaled down and offset east.
const IN_X = -9; // inner west wall
const IN_HALF_Z = 16;
const IN_A = 19; // inner apex at x = IN_X + IN_A = 10
const WALL_H = 4;
const WALL_T = 0.5;

const round = (n) => Math.round(n * 1e4) / 1e4;

/** Author elements for the z>0 (and z=0) half; the assembler mirrors to z<0. */
const half = [];
const push = (c, s, color, surface, ry = 0) => half.push({ c, s, color, surface, ry });

// Emit an east-bulging half-ellipse of yaw-angled wall segments (t = 0..90,
// mirrored to -z by the assembler).
function arcWall(cx, xReach, zReach, segs, color, surface) {
  const pt = (t) => [cx + xReach * Math.cos(t), zReach * Math.sin(t)];
  for (let i = 0; i < segs; i++) {
    const [x0, z0] = pt((i / segs) * (Math.PI / 2));
    const [x1, z1] = pt(((i + 1) / segs) * (Math.PI / 2));
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx); // R_y(yaw) maps local +X onto the chord
    push([round((x0 + x1) / 2), WALL_H / 2, round((z0 + z1) / 2)], [round(len + WALL_T), WALL_H, WALL_T], color, surface, round(yaw));
  }
}

// --- Floor (bounding rectangle; the curved wall hides the corners) ------------
const floor = { c: [0, -0.1, 0], s: [A, 0.2, HALF_Z * 2], color: CONCRETE, surface: 'Concrete', ry: 0 };

// --- Perimeter walls (z=0 straight walls are self-symmetric) ------------------
const westWall = { c: [WALL_X, WALL_H / 2, 0], s: [WALL_T, WALL_H, HALF_Z * 2], color: SAND, surface: 'Sandstone', ry: 0 };
const innerWest = { c: [IN_X, WALL_H / 2, 0], s: [WALL_T, WALL_H, IN_HALF_Z * 2], color: CONCRETE_DARK, surface: 'Concrete', ry: 0 };
arcWall(WALL_X, A, HALF_Z, 8, SAND, 'Sandstone'); // outer curve
arcWall(IN_X, IN_A, IN_HALF_Z, 7, CONCRETE_DARK, 'Concrete'); // inner curve (the hole)

// --- Spawn walls (cover in front of each spawn, doorway on the east side) ------
push([-16, 2, 22], [12, 4, 0.5], SAND, 'Sandstone'); // spans x -22..-10, exit east

// The loop is walked in three bands: the WEST SPINE corridor (x -22..-9, the
// direct lane — DENSE), the NORTH/SOUTH connectors that round the ends of the
// hole, and the EAST ARC flank (MEDIUM-SPARSE). Cover is spread along all of
// them at ~6 m intervals with the gap alternating sides, so no stretch is a bare
// sightline and no stretch is a wall. All x-values stay clear of the hole.

// --- West spine corridor (DENSE) — 3 staggered chokes down the direct lane -----
// Choke A (~z=13, far-west low wall + crate against the inner wall).
push([-18, 1, 13], [8, 2, 0.5], CONCRETE_DARK, 'Concrete');
push([-12, 0.75, 13], [1.5, 1.5, 1.5], WOOD, 'Wood');
push([-11, 2, 10], [0.6, 4, 0.6], SAND, 'Sandstone');
// Choke B (~z=6, crate cluster + boost box on the far-west side).
push([-19, 0.75, 6], [1.5, 1.5, 1.5], WOOD, 'Wood');
push([-17.5, 0.75, 7], [1.5, 1.5, 1.5], WOOD, 'Wood');
push([-14, 0.4, 6], [3, 0.8, 2.5], CONCRETE_DARK, 'Concrete');
// Choke C (~z=2, low wall hugging the inner wall — gap on the far-west side).
push([-12, 1, 2], [6, 2, 0.5], CONCRETE_DARK, 'Concrete');

// --- North connector (rounds the top of the hole; links spine <-> arc) --------
push([-1, 0.75, 19], [1.5, 1.5, 1.5], WOOD, 'Wood');
push([4, 2, 19], [0.7, 4, 0.7], SAND, 'Sandstone');

// --- East arc flank (MEDIUM) — lane between the inner curve and outer curve ----
push([8, 0.75, 14], [1.5, 1.5, 1.5], WOOD, 'Wood'); // arc entry from the connector
push([12, 1.25, 12], [2.5, 2.5, 2.5], WOOD, 'Wood');
push([16, 2, 7], [0.7, 4, 0.7], SAND, 'Sandstone');
push([13, 0.75, 5], [1.5, 1.5, 1.5], WOOD, 'Wood');

// --- Centre-line features (z=0, self-symmetric) -------------------------------
const midline = [
  { c: [-15, 2, 0], s: [0.8, 4, 0.8], color: SAND, surface: 'Sandstone', ry: 0 }, // spine pillar
  { c: [-11, 0.75, 0], s: [1.5, 1.5, 1.5], color: WOOD, surface: 'Wood', ry: 0 }, // spine crate
  { c: [16, 1.5, 0], s: [3, 3, 3], color: WOOD, surface: 'Wood', ry: 0 }, // east arc centrepiece
];

// --- Assemble: mirror the z>0 half across z=0 ---------------------------------
const boxes = [floor, westWall, innerWest, ...midline];
for (const b of half) {
  boxes.push(b);
  boxes.push({ c: [b.c[0], b.c[1], -b.c[2]], s: b.s, color: b.color, surface: b.surface, ry: round(-b.ry) });
}

// Drop ry:0 to keep the JSON clean (mapCuboids/build_map default it to 0).
const clean = boxes.map(({ ry, ...rest }) => (ry ? { ...rest, ry } : rest));

const data = {
  _comment:
    "Single source of truth for de_douglas layout (D for Douglas). Consumed by src/game/map_douglas.ts (colliders + nav tris) AND tools/blender/build_map.py (render+lightmap bake). Coords: three.js metres, Y up, floor top y=0. Colors hex; surface = material class. GENERATED by tools/maps/build_douglas.mjs — edit that, not this. Shape: a capital 'D' on its back — straight WEST spine wall at x=-22 (z -30..30), closed by a half-ellipse CURVE bulging EAST to x=22, with a smaller walled COUNTER (the letter's hole) inside, so play is a LOOP: dense WEST SPINE corridor (direct lane) vs. sparse EAST ARC (flank). T/CT spawn behind walls at the two spine ends. MIRROR-symmetric across z=0 (the X axis): every box has a twin at (x,-z) with negated yaw, so T half == CT half. Curved wall segments use optional 'ry' (yaw about Y). map_douglas.test.ts asserts the mirror symmetry.",
  spawns: { T: [-15, 0.05, -25], CT: [-15, 0.05, 25] },
  boxes: clean,
  ramps: [],
};

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(`wrote ${clean.length} boxes to ${OUT}`);
