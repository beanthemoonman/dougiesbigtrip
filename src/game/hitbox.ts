/**
 * Per-bone hitboxes for the box-built player world-models. This is the debt the
 * Phase 4.5 "character rig" line item exists to clear: Phases 2–3 shipped a
 * height-band approximation (hitboxAt, kept below as a fallback) because there
 * was no rig to test bullet geometry against. There still isn't a *skinned*
 * armature — the bots render as rigid translating boxes and play no animation
 * clips, so a skinned mesh + Mixamo walk/idle/death buys nothing until a bot
 * animation driver exists (Phase 5). But the per-bone hitbox query it was
 * blocking is a static geometry problem: the model's parts don't move relative
 * to the body, so their boxes are fixed in body-local space and we can ray-test
 * them directly.
 *
 * BONES mirrors the boxes in tools/blender/build_characters.py exactly (the
 * source of truth for the mesh), so a shot that misses the narrow head sideways
 * is no longer a headshot the way the height band made it.
 *
 * ponytail: static per-bone AABBs, not skinned capsules. Upgrade to bone-driven
 * volumes if/when bots animate and limbs actually swing; damage.ts multipliers
 * stay the same either way.
 */
import { STANDING_HEIGHT } from '../player/constants';
import type { Hitbox } from './damage';

/** Zone of a hit `hitY` metres in world space, given the target's `feetY`.
 *  Height-band fallback for when the precise ray test grazes the collider but
 *  misses every bone box (an edge clip that still counts as a hit). */
export function hitboxAt(feetY: number, hitY: number): Hitbox {
  const frac = (hitY - feetY) / STANDING_HEIGHT; // 0 = feet, 1 = crown
  if (frac >= 0.88) return 'head';
  if (frac >= 0.66) return 'chest';
  if (frac >= 0.45) return 'stomach';
  return 'leg';
}

// A bone box in three-space, body-local (feet at y=0, model faces -Z). Built by
// converting each build_characters.py box (Blender Z-up center/size) into a
// three-space AABB: center (bx, bz, -by), half-extent (sx/2, sz/2, sy/2).
interface Bone {
  zone: Hitbox;
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

// [zone, blender center (x,y,z), blender full size (x,y,z)] — copied 1:1 from
// build_characters.py. Symmetric limb pairs are listed once per side.
const SRC: readonly [Hitbox, [number, number, number], [number, number, number]][] = (() => {
  const rows: [Hitbox, [number, number, number], [number, number, number]][] = [
    ['stomach', [0, -0.02, 0.99], [0.34, 0.2, 0.16]], // pelvis
    ['stomach', [0, -0.02, 1.16], [0.36, 0.21, 0.2]], // abdomen
    ['chest', [0, -0.02, 1.37], [0.42, 0.23, 0.24]], // chest
    ['chest', [0, 0.09, 1.33], [0.4, 0.1, 0.34]], // vest
    ['head', [0, -0.02, 1.53], [0.11, 0.11, 0.08]], // neck
    ['head', [0, -0.01, 1.64], [0.19, 0.21, 0.22]], // head
    ['head', [0, -0.01, 1.74], [0.21, 0.23, 0.1]], // helmet
  ];
  for (const sx of [-1, 1]) {
    const x = 0.11 * sx;
    rows.push(['leg', [x, 0.05, 0.045], [0.11, 0.28, 0.09]]); // foot
    rows.push(['leg', [x, -0.02, 0.3], [0.13, 0.15, 0.45]]); // shin
    rows.push(['leg', [x, -0.02, 0.72], [0.16, 0.18, 0.42]]); // thigh
    rows.push(['chest', [0.24 * sx, -0.02, 1.44], [0.16, 0.2, 0.16]]); // shoulder
    rows.push(['arm', [0.24 * sx, -0.02, 1.24], [0.13, 0.14, 0.3]]); // upper arm
    rows.push(['arm', [0.2 * sx, -0.02, 0.99], [0.11, 0.12, 0.28]]); // lower arm
    rows.push(['arm', [0.19 * sx, -0.02, 0.82], [0.1, 0.11, 0.12]]); // hand
  }
  return rows;
})();

const BONES: readonly Bone[] = SRC.map(([zone, [cx, cy, cz], [sx, sy, sz]]) => {
  // Blender (x,y,z) -> three (x, z, -y). Extents stay axis-aligned.
  const tcx = cx;
  const tcy = cz;
  const tcz = -cy;
  const hx = sx / 2;
  const hy = sz / 2;
  const hz = sy / 2;
  return {
    zone,
    min: [tcx - hx, tcy - hy, tcz - hz] as const,
    max: [tcx + hx, tcy + hy, tcz + hz] as const,
  };
});

/** Local vertical span of the union of bone boxes (min y, max y) — for tests. */
export const BONES_Y_SPAN: readonly [number, number] = [
  Math.min(...BONES.map((b) => b.min[1])),
  Math.max(...BONES.map((b) => b.max[1])),
];

/**
 * Precise hit zone for a world-space ray against a bot at `p` (feet) with body
 * yaw `yaw`. Transforms the ray into body-local space and slab-tests every bone
 * box, returning the zone of the nearest one entered, or null if the ray misses
 * all bones (caller falls back to the height band). Pure scalar math, no alloc.
 */
export function hitboxRay(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  px: number, py: number, pz: number,
  yaw: number,
): Hitbox | null {
  // World -> body-local: subtract feet, rotate by -yaw about Y.
  const rx = ox - px;
  const ry = oy - py;
  const rz = oz - pz;
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  const lox = rx * c + rz * s;
  const loy = ry;
  const loz = -rx * s + rz * c;
  const ldx = dx * c + dz * s;
  const ldy = dy;
  const ldz = -dx * s + dz * c;

  let bestT = Infinity;
  let best: Hitbox | null = null;
  for (const b of BONES) {
    const t = slab(lox, loy, loz, ldx, ldy, ldz, b.min, b.max);
    if (t !== null && t < bestT) {
      bestT = t;
      best = b.zone;
    }
  }
  return best;
}

const EPS = 1e-9;

/** Ray/AABB slab test; returns entry distance (>=0) along a *unit* dir, or null.
 *  Distance is preserved through the rigid world->local transform (no scale). */
function slab(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): number | null {
  const range = { tmin: 0, tmax: Infinity };
  if (!axisClip(ox, dx, min[0], max[0], range)) return null;
  if (!axisClip(oy, dy, min[1], max[1], range)) return null;
  if (!axisClip(oz, dz, min[2], max[2], range)) return null;
  return range.tmin;
}

/** Clip the [tmin,tmax] interval against one axis' slab; false if the ray misses. */
function axisClip(o: number, d: number, mn: number, mx: number, r: { tmin: number; tmax: number }): boolean {
  if (Math.abs(d) < EPS) return o >= mn && o <= mx; // parallel: inside the slab?
  const inv = 1 / d;
  let t1 = (mn - o) * inv;
  let t2 = (mx - o) * inv;
  if (t1 > t2) [t1, t2] = [t2, t1];
  if (t1 > r.tmin) r.tmin = t1;
  if (t2 < r.tmax) r.tmax = t2;
  return r.tmin <= r.tmax;
}
