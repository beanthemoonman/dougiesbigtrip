// Greybox map "de_greybox" — Phase 3. Layout data lives in
// assets/maps/de_greybox.json (single source of truth) so the same numbers
// drive BOTH the Rapier cuboid colliders (here) and the Blender render/lightmap
// bake (tools/blender/build_map.py). Coords: three.js metres, Y up, floor top
// at y=0. Everything on a 0.5 m grid.
//
// Roughly half of Dust2's B: T spawn (south) → open site (north) with a CT hold
// behind, three routes between (West "tunnels", a Mid doorway choke, East
// "long"), crates + pillars for cover, and a step→platform + shallow ramp so
// step-offset / no-slope-slide stay under test on real map geometry.
//
// ponytail: the *visuals* come from the baked glb; the colliders stay the
// proven cuboids. Same box list → they align. Re-run the Blender bake if the
// layout JSON changes, or render and collision drift apart.

import data from '../../assets/maps/de_greybox.json';

// docs/art-direction.md palette (mirrors the hex colours in the JSON).
export const PALETTE = {
  concrete: 0xa5a29b,
  concreteDark: 0x5e5c58,
  sandstoneLight: 0xc9ae7c,
  wood: 0x7a5b3c,
} as const;

export interface MapBox {
  /** centre [x, y, z] */
  readonly c: readonly [number, number, number];
  /** full size [w, h, d] */
  readonly s: readonly [number, number, number];
  readonly color: number;
}

/** A straight ramp on the walkable surface, start → end (see addRamp in main). */
export interface MapRamp {
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
  readonly width: number;
  readonly thickness: number;
  readonly color: number;
}

// JSON infers number[] for the coord arrays; the layout guarantees length-3
// tuples, so assert the shape at the boundary (the T0 test guards the data).
export const MAP_BOXES = data.boxes as unknown as readonly MapBox[];
export const MAP_RAMPS = data.ramps as unknown as readonly MapRamp[];
export const T_SPAWN = data.spawns.T as unknown as readonly [number, number, number];
export const CT_SPAWN = data.spawns.CT as unknown as readonly [number, number, number];
