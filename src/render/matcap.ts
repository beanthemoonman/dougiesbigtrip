/**
 * A procedural matcap for characters and their world-model weapons.
 *
 * The baked-lighting world has no realtime lights, so anything not lightmapped
 * (skinned characters, guns in hands) was unlit MeshBasicMaterial — a flat
 * silhouette of one colour, which reads as washed out next to the shaded world.
 * A matcap gives form shading with zero lights and zero extra draw state: the
 * material samples the sphere image by view-space normal. Tint still works,
 * MeshMatcapMaterial multiplies `color` over the matcap.
 *
 * ponytail: one hand-tuned gradient, no per-material variation. Swap in an
 * authored matcap texture if characters ever need distinct surface responses.
 */

import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

let cached: Texture | undefined;

/** Shared matcap: key from the upper-left, shadowed lower-right, dark rim. */
export function characterMatcap(): Texture {
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('matcap: no 2d context');

  // Highlight sits up-left of centre; falls off to a dark terminator at the rim.
  const g = ctx.createRadialGradient(size * 0.36, size * 0.3, 0, size * 0.36, size * 0.3, size * 0.9);
  g.addColorStop(0.0, '#ffffff');
  g.addColorStop(0.35, '#cfcfcf');
  g.addColorStop(0.7, '#8a8a8a');
  g.addColorStop(1.0, '#3a3a3a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  cached = tex;
  return tex;
}
