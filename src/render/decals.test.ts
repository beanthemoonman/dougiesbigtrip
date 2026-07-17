import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { DECAL_OFFSET, decalMatrix } from './decals';

/**
 * T0 for the decal transform. The load-bearing property is that a decal quad
 * lands *on* the surface it was shot into and faces out of it — get the basis
 * wrong and the spray pattern the Phase 2 exit test reads is drawn edge-on or
 * inside the wall.
 */

const out = new Matrix4();

/** The direction the quad's face (+Z, PlaneGeometry's normal) points after transform. */
function facing(m: Matrix4): Vector3 {
  return new Vector3(0, 0, 1).transformDirection(m);
}

function translation(m: Matrix4): Vector3 {
  return new Vector3().setFromMatrixPosition(m);
}

describe('decalMatrix', () => {
  it('faces the quad along the surface normal', () => {
    const normal = new Vector3(0, 0, 1); // a wall the player is looking at
    decalMatrix(new Vector3(1, 2, 3), normal, 0.06, out);
    expect(facing(out).distanceTo(normal)).toBeLessThan(1e-6);
  });

  it('offsets the quad off the surface along the normal, to beat z-fighting', () => {
    const point = new Vector3(1, 2, 3);
    const normal = new Vector3(0, 0, 1);
    decalMatrix(point, normal, 0.06, out);
    expect(translation(out).distanceTo(point.clone().addScaledVector(normal, DECAL_OFFSET))).toBeLessThan(1e-6);
  });

  it('stays finite on a floor hit, where the normal is parallel to world up', () => {
    // The classic degenerate case: an up-vector parallel to the look axis makes
    // the basis cross product collapse to zero and every element goes NaN.
    decalMatrix(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.06, out);
    expect(out.elements.every(Number.isFinite)).toBe(true);
    expect(facing(out).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });

  it('stays finite on a ceiling hit', () => {
    decalMatrix(new Vector3(0, 0, 0), new Vector3(0, -1, 0), 0.06, out);
    expect(out.elements.every(Number.isFinite)).toBe(true);
    expect(facing(out).distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-6);
  });

  it('scales the unit quad to the requested size, uniformly in the surface plane', () => {
    decalMatrix(new Vector3(0, 0, 0), new Vector3(0, 0, 1), 0.06, out);
    expect(new Vector3().setFromMatrixColumn(out, 0).length()).toBeCloseTo(0.06, 10);
    expect(new Vector3().setFromMatrixColumn(out, 1).length()).toBeCloseTo(0.06, 10);
  });
});
