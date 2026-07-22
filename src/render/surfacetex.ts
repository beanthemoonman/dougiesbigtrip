/**
 * Tiling surface detail textures for the map materials, assigned onto the glb's
 * MeshStandardMaterials by material name (M_Concrete / M_Sandstone / M_Wood).
 *
 * Phase 13: real CC0 Poly Haven diffuse textures (2K JPG, ~3.1 MB total),
 * imported via Vite ?url so they're content-hashed into dist like every other
 * asset. Falls back to the Phase 4.5 procedural noise maps if a file fails to
 * load — keeps the map readable offline or before assets deploy.
 *
 * The lightmap (UV1) does the heavy lifting for lighting; these diffuse maps
 * replace the old palettised procedural detail on UV0.
 */
import { CanvasTexture, type Mesh, type MeshStandardMaterial, type Object3D, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';
import { makeRng, type Rng } from '../core/rng';
import concreteUrl from '../../assets/tex/concrete_diff.jpg?url';
import sandstoneUrl from '../../assets/tex/sandstone_diff.jpg?url';
import woodUrl from '../../assets/tex/wood_diff.jpg?url';

const TEX = 256; // procedural fallback size

type Gen = (rng: Rng) => Uint8ClampedArray;

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

const concreteGen: Gen = (rng) => {
  const n = noiseField(rng, 16);
  const fine = noiseField(rng, 64);
  return grey((u, v) => 0.72 + 0.2 * n(u, v) + 0.08 * fine(u, v) - 0.02);
};

const sandstoneGen: Gen = (rng) => {
  const n = noiseField(rng, 20);
  const band = noiseField(rng, 8);
  return grey((u, v) => {
    const layers = 0.5 + 0.5 * Math.sin((v + 0.15 * band(u, v)) * Math.PI * 14);
    return 0.66 + 0.14 * layers + 0.16 * n(u, v);
  });
};

const woodGen: Gen = (rng) => {
  const grain = noiseField(rng, 48);
  const warp = noiseField(rng, 6);
  return grey((u, v) => {
    const stripe = 0.5 + 0.5 * Math.sin((u + 0.06 * warp(u, v)) * Math.PI * 40);
    const seam = (u * 4) % 1 < 0.04 ? -0.22 : 0;
    return 0.7 + 0.18 * stripe + 0.1 * grain(u, v) + seam;
  });
};

interface SurfaceDef {
  name: string;
  gen: Gen;
  repeat: number;
  texPath: string;
}

const SURFACES: readonly SurfaceDef[] = [
  { name: 'Concrete', gen: concreteGen, repeat: 2, texPath: concreteUrl },
  { name: 'Sandstone', gen: sandstoneGen, repeat: 2, texPath: sandstoneUrl },
  { name: 'Wood', gen: woodGen, repeat: 1.5, texPath: woodUrl },
];

function makeProcedural(gen: Gen, repeat: number, seed: number): CanvasTexture {
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

function setupTexture(tex: Texture, repeat: number): Texture {
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Assign tiling surface detail maps to the map materials. Loads real CC0
 * Poly Haven textures (Phase 13) and falls back to procedural noise if any
 * load fails. Call once, after the lightmapped map is in the scene.
 */
export async function applySurfaceTextures(mapRoot: Object3D): Promise<void> {
  const loader = new TextureLoader();
  const real: Map<string, Texture> = new Map();

  await Promise.all(SURFACES.map(async ({ name, texPath }) => {
    try {
      const tex = await loader.loadAsync(texPath);
      real.set(name, tex);
    } catch {
      // Fall back to procedural below.
    }
  }));

  mapRoot.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as MeshStandardMaterial;
    const surf = SURFACES.find((s) => mat.name.includes(s.name));
    if (!surf) return;

    const realTex = real.get(surf.name);
    if (realTex) {
      mat.map = setupTexture(realTex, surf.repeat);
    } else {
      mat.map = makeProcedural(surf.gen, surf.repeat, hashName(surf.name));
    }
    mat.needsUpdate = true;
  });
}
