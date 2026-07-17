import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Pooled math scratch objects for the hot loop (sim tick + render).
 *
 * Never hold a reference to one of these across frames — the next caller
 * to request the same slot will silently overwrite it. Grab it, use it,
 * discard it within the same function.
 */

function makePool<T>(factory: () => T, size: number): { next: () => T } {
  const pool: T[] = [];
  for (let i = 0; i < size; i++) pool.push(factory());
  let cursor = 0;
  return {
    next(): T {
      const item = pool[cursor];
      cursor = (cursor + 1) % pool.length;
      return item as T;
    },
  };
}

const vec3Pool = makePool(() => new Vector3(), 32);
const quatPool = makePool(() => new Quaternion(), 8);
const mat4Pool = makePool(() => new Matrix4(), 4);

export function scratchVec3(): Vector3 {
  return vec3Pool.next().set(0, 0, 0);
}

export function scratchQuat(): Quaternion {
  return quatPool.next().identity();
}

export function scratchMat4(): Matrix4 {
  return mat4Pool.next().identity();
}
