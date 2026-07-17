/**
 * Impact decals — the bullet holes that make the spray pattern visible, which
 * is the whole of the Phase 2 exit test (docs/weapon-feel.md §3: "fire two full
 * mags at a wall from 10 m; the patterns must be recognisably the same shape").
 *
 * One InstancedMesh, one draw call, fixed-size ring buffer: the oldest hole is
 * recycled once the pool is full. No allocation per impact.
 */
import { CircleGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Scene, Vector3 } from 'three';

/** Bullet hole diameter, metres. Roughly CS's — big enough to read at 10 m. */
export const DECAL_SIZE = 0.06;

/** Lift off the surface along its normal, metres. Below this the hole z-fights. */
export const DECAL_OFFSET = 0.005;

/**
 * ponytail: 128 holes ≈ four rifle mags before the oldest recycles — enough for
 * the two-mag exit test to have both patterns on the wall at once. Raise it if a
 * real map ever needs more; it costs one matrix each, not a draw call.
 */
export const MAX_DECALS = 128;

const scratchUp = new Vector3();
const scratchEye = new Vector3();
const scratchScale = new Vector3();
const ORIGIN = new Vector3(0, 0, 0);
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/**
 * Transform placing a unit quad (PlaneGeometry/CircleGeometry face +Z) flat on a
 * surface at `point`, facing out along `normal`, `size` metres across.
 */
export function decalMatrix(point: Vector3, normal: Vector3, size: number, out: Matrix4): Matrix4 {
  // lookAt's up must not be parallel to the look axis or the basis collapses to
  // NaN — which is every floor and ceiling hit, not an edge case.
  const up = Math.abs(normal.y) < 0.99 ? scratchUp.set(0, 1, 0) : scratchUp.set(0, 0, 1);
  // Matrix4.lookAt's +Z column points eye→target, i.e. from the surface outward.
  out.lookAt(scratchEye.copy(normal), ORIGIN, up);
  out.scale(scratchScale.set(size, size, size));
  out.setPosition(
    point.x + normal.x * DECAL_OFFSET,
    point.y + normal.y * DECAL_OFFSET,
    point.z + normal.z * DECAL_OFFSET,
  );
  return out;
}

export interface Decals {
  /** Stamp a hole at a world-space impact point with that surface's normal. */
  add: (point: Vector3, normal: Vector3) => void;
  mesh: InstancedMesh;
}

const scratchMatrix = new Matrix4();

export function createDecals(scene: Scene): Decals {
  // ponytail: a flat dark disc, no texture — no asset, so no licence and no
  // CREDITS row. Swap in a real bullet-hole alpha per surface type in Phase 5,
  // where surface-matched decals are already on the list.
  const geometry = new CircleGeometry(0.5, 8); // radius 0.5 → unit-diameter quad
  const material = new MeshBasicMaterial({ color: 0x141210 });
  const mesh = new InstancedMesh(geometry, material, MAX_DECALS);
  // Instances are scattered across the map, so the mesh's shared bounding
  // volume is meaningless — culling it would pop every hole at once.
  mesh.frustumCulled = false;
  for (let i = 0; i < MAX_DECALS; i++) mesh.setMatrixAt(i, HIDDEN);
  scene.add(mesh);

  let next = 0;
  return {
    mesh,
    add(point: Vector3, normal: Vector3): void {
      mesh.setMatrixAt(next, decalMatrix(point, normal, DECAL_SIZE, scratchMatrix));
      mesh.instanceMatrix.needsUpdate = true;
      next = (next + 1) % MAX_DECALS;
    },
  };
}
