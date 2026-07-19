import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { createVfx, SURFACE_FX, TRACER_POOL, IMPACT_POOL, type Surface } from './vfx';

const DIR = new Vector3(0, 0, -1);
const P = new Vector3(0, 1, 0);
const N = new Vector3(0, 0, 1);

describe('surface fx table', () => {
  it('flesh is blood-red and takes no bullet-hole decal; hard surfaces spark and mark', () => {
    expect(SURFACE_FX.flesh.decal).toBe(false);
    expect(SURFACE_FX.concrete.decal).toBe(true);
    expect(SURFACE_FX.wood.decal).toBe(true);
    expect(SURFACE_FX.metal.decal).toBe(true);
    // Blood reads red (R dominant); sparks read warm/pale (not R-dominant-and-dark).
    const r = (c: number) => (c >> 16) & 0xff;
    const g = (c: number) => (c >> 8) & 0xff;
    expect(r(SURFACE_FX.flesh.color)).toBeGreaterThan(g(SURFACE_FX.flesh.color) + 60);
  });

  it('covers exactly the four surfaces', () => {
    const keys = Object.keys(SURFACE_FX).sort();
    expect(keys).toEqual(['concrete', 'flesh', 'metal', 'wood'] satisfies Surface[]);
  });
});

describe('vfx pools are bounded (draw-call budget: pooled, not per-shot allocation)', () => {
  it('adds a constant, small number of scene objects regardless of how many effects fire', () => {
    const scene = new Scene();
    const before = scene.children.length;
    const vfx = createVfx(scene);
    const added = scene.children.length - before;
    // muzzle flash (1) + tracer instanced mesh (1) + impact instanced mesh (1).
    expect(added).toBe(3);

    // Fire far more effects than the pools hold; object count must not grow.
    for (let i = 0; i < TRACER_POOL * 4; i++) vfx.tracer(P, new Vector3(0, 1, -10));
    for (let i = 0; i < IMPACT_POOL * 4; i++) vfx.impact(P, N, 'concrete');
    vfx.muzzleFlash(P, DIR);
    expect(scene.children.length - before).toBe(added);
  });
});

describe('transient lifetimes', () => {
  it('a tracer/impact/flash is live when spawned and gone after its lifetime elapses', () => {
    const vfx = createVfx(new Scene());
    vfx.muzzleFlash(P, DIR);
    vfx.tracer(P, new Vector3(0, 1, -10));
    vfx.impact(P, N, 'flesh');
    expect(vfx.liveCount()).toBe(3);
    // One long frame past the longest lifetime clears everything.
    vfx.update(5);
    expect(vfx.liveCount()).toBe(0);
  });

  it('update never drives life negative or throws when idle', () => {
    const vfx = createVfx(new Scene());
    expect(() => vfx.update(0.016)).not.toThrow();
    expect(vfx.liveCount()).toBe(0);
  });
});
