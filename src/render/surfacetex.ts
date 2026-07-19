/**
 * Procedural tiling surface detail for the greybox map — the Phase 4.5 texturing
 * pass, done in-repo rather than downloaded. art-direction.md is explicit: the
 * Source look is "~512² textures, tiled, high contrast, hand-authored detail
 * rather than photoscanned mush." So each surface gets a small, seamless-tiling
 * greyscale detail map generated once at load; the map material keeps its palette
 * base colour as the tint, and final = palette · detail · lightMap.
 *
 * Zero shipped bytes (generated on the client), zero licensing (original), and
 * reproducible like build_map.py. Assigned onto the glb's MeshStandardMaterials
 * by material name (M_Concrete / M_Sandstone / M_Wood), on UV0 (the cube-projected
 * tiling channel; the lightmap owns UV1).
 *
 * ponytail: value noise + a couple of per-surface tricks, not a PBR authoring
 * suite. Upgrade to real CC0 texture sets (Poly Haven/Kenney) only if the
 * procedural read looks flat in the ACC playtest — the wiring here stays the same.
 */
import { CanvasTexture, type Mesh, type MeshStandardMaterial, type Object3D, RepeatWrapping, SRGBColorSpace } from 'three';
import { makeRng, type Rng } from '../core/rng';

const TEX = 256; // Source-scale; generated once, never sampled in the hot loop.

// [substring of material name, generator, UV repeats across the cube-projected
// 1-unit(≈1 m) UV0 — <1 stretches the tile larger]. Tuned by eye; a T3/ACC pass
// dials the final numbers. See docs/art-direction.md palette for the base hues.
type Gen = (rng: Rng) => Uint8ClampedArray;

/** Seamless value noise in [0,1]: a GxG lattice, wrapped, bilinear, 2 octaves. */
export function noiseField(rng: Rng, g: number): (x: number, y: number) => number {
  const lat = new Float32Array(g * g);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  const at = (ix: number, iy: number): number => lat[(iy % g) * g + (ix % g)] ?? 0;
  return (x, y) => {
    const fx = x * g;
    const fy = y * g;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
}

/** Pack a per-pixel greyscale value [0,1] into an RGBA byte buffer. */
function grey(fn: (u: number, v: number) => number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const g = Math.max(0, Math.min(1, fn(x / TEX, y / TEX))) * 255;
      const o = (y * TEX + x) * 4;
      buf[o] = g;
      buf[o + 1] = g;
      buf[o + 2] = g;
      buf[o + 3] = 255;
    }
  }
  return buf;
}

// Detail maps sit in a high, narrow band (≈0.62–1.0) so they read as wear and
// variation without halving the palette brightness they multiply.
const concreteGen: Gen = (rng) => {
  const n = noiseField(rng, 16);
  const fine = noiseField(rng, 64);
  return grey((u, v) => 0.72 + 0.2 * n(u, v) + 0.08 * fine(u, v) - 0.02);
};

const sandstoneGen: Gen = (rng) => {
  const n = noiseField(rng, 20);
  const band = noiseField(rng, 8);
  // Horizontal sedimentary banding + noise.
  return grey((u, v) => {
    const layers = 0.5 + 0.5 * Math.sin((v + 0.15 * band(u, v)) * Math.PI * 14);
    return 0.66 + 0.14 * layers + 0.16 * n(u, v);
  });
};

const woodGen: Gen = (rng) => {
  const grain = noiseField(rng, 48);
  const warp = noiseField(rng, 6);
  return grey((u, v) => {
    // Vertical grain: sine stripes warped by low-freq noise, + plank seams.
    const stripe = 0.5 + 0.5 * Math.sin((u + 0.06 * warp(u, v)) * Math.PI * 40);
    const seam = (u * 4) % 1 < 0.04 ? -0.22 : 0; // darker line every quarter (≈plank)
    return 0.7 + 0.18 * stripe + 0.1 * grain(u, v) + seam;
  });
};

const SURFACES: readonly [string, Gen, number][] = [
  ['Concrete', concreteGen, 2],
  ['Sandstone', sandstoneGen, 2],
  ['Wood', woodGen, 1.5],
];

function makeTexture(gen: Gen, repeat: number, seed: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX;
  canvas.height = TEX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const img = ctx.createImageData(TEX, TEX);
  img.data.set(gen(makeRng(seed)));
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Assign a procedural tiling detail map to each of the greybox map's materials,
 * matched by name. Call once, after the map (with its lightmap) is in the scene.
 */
export function applySurfaceTextures(mapRoot: Object3D): void {
  const cache = new Map<string, CanvasTexture>();
  mapRoot.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as MeshStandardMaterial;
    const hit = SURFACES.find(([name]) => mat.name.includes(name));
    if (!hit) return;
    const [name, gen, repeat] = hit;
    let tex = cache.get(name);
    if (!tex) {
      // Seed from the name so every run is identical (determinism rule).
      tex = makeTexture(gen, repeat, hashName(name));
      cache.set(name, tex);
    }
    mat.map = tex;
    mat.needsUpdate = true;
  });
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
