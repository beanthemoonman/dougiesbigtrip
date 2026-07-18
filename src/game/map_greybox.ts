// Greybox map "de_greybox" — Phase 3 layout, authored as cuboid data so it can
// be playtested with Phase 1 movement BEFORE any Blender/lightmap work (that is
// the plan's explicit order: greybox and tune sightlines first, texture later).
//
// Roughly half of Dust2's B: one T spawn (south), one open site (north) with a
// CT hold behind it, and three routes between them — West "tunnels", a "mid"
// choke through a doorway, and East "long". A step-up platform and a slope in
// the site keep the movement feel (step offset / no-slope-slide) under test.
//
// ponytail: greybox boxes, not the authored modular kit. The kit + correct
// texel density earns its keep at texturing time (next Phase 3 increment),
// where lightmap UVs actually depend on it — not for a walkable greybox.
// Coords are three.js metres, Y up, floor top at y=0. Everything on a 0.5 m grid.

// docs/art-direction.md palette.
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

const W = PALETTE.sandstoneLight; // walls
const D = PALETTE.concreteDark; // dividers / steps
const C = PALETTE.wood; // crates / cover

export const MAP_BOXES: readonly MapBox[] = [
  // Floor: x[-12,12], z[-22,20].
  { c: [0, -0.1, -1], s: [24, 0.2, 42], color: PALETTE.concrete },

  // Perimeter walls (4 m tall).
  { c: [0, 2, -22], s: [25, 4, 0.5], color: W },
  { c: [0, 2, 20], s: [25, 4, 0.5], color: W },
  { c: [-12, 2, -1], s: [0.5, 4, 42], color: W },
  { c: [12, 2, -1], s: [0.5, 4, 42], color: W },

  // Lane dividers z[-16,4]: split the approach into West / Mid / East.
  { c: [-4, 2, -6], s: [0.5, 4, 20], color: D },
  { c: [4, 2, -6], s: [0.5, 4, 20], color: D },

  // Mid choke: doorway at z=-6, 3 m gap centred on x=0.
  { c: [-2.75, 2, -6], s: [2.5, 4, 0.5], color: D },
  { c: [2.75, 2, -6], s: [2.5, 4, 0.5], color: D },

  // Site cover crates.
  { c: [-3, 0.6, 9], s: [1.4, 1.2, 1.4], color: C },
  { c: [3, 0.75, 10], s: [1.5, 1.5, 1.5], color: C },
  { c: [6.5, 0.6, 7], s: [1.4, 1.2, 1.4], color: C },
  { c: [-6, 0.6, 12], s: [1.4, 1.2, 1.4], color: C },

  // Pillars — vertical cover / sightline breakers in the open site.
  { c: [0, 2, 6], s: [0.6, 4, 0.6], color: W },
  { c: [8, 2, 16], s: [0.6, 4, 0.6], color: W },

  // Step (top 0.4 m) → platform (top 0.8 m): proves walk-up under STEP_HEIGHT.
  { c: [9, 0.2, 10], s: [4, 0.4, 1.5], color: D },
  { c: [9, 0.4, 12.75], s: [4, 0.8, 3], color: D },
];

// Shallow slope in the site (~16.7°, under the walkable normal threshold):
// standing on it must not slide.
export const MAP_RAMPS: readonly MapRamp[] = [
  { start: [-11, 0, 14], end: [-7, 1.2, 14], width: 3, thickness: 0.3, color: C },
];

/** Feet-on-floor spawns (y just above the floor top). */
export const T_SPAWN: readonly [number, number, number] = [0, 0.05, -19];
export const CT_SPAWN: readonly [number, number, number] = [0, 0.05, 18];
