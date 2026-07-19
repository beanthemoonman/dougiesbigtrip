/**
 * Procedural gradient skybox — the Phase 4.5 "real skybox matching the lightmap's
 * sun direction" item. Source skyboxes are low-detail painted gradients, not HDRIs,
 * so this is an equirect CanvasTexture (zenith→horizon gradient + one warm sun
 * glow) used directly as scene.background: no skydome mesh, no draw call, no fog
 * bleed (three renders the background behind fog). Original → zero licensing.
 *
 * The sun disk is placed at the direction the map was baked with: build_map.py's
 * Sun rotation_euler=(50°,0,35°) → three-space direction ≈ (0.44, 0.64, 0.63)
 * (≈40° elevation). If the bake sun ever moves, move this to match — the doc note
 * in build_map.py is the source of truth.
 */
import { EquirectangularReflectionMapping, SRGBColorSpace, Texture } from 'three';

const W = 1024;
const H = 512;
const SUN_DIR: readonly [number, number, number] = [0.44, 0.64, 0.63];

export function makeSky(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');

  // Vertical gradient: deep zenith blue (top) → hazy horizon (matches fog/SKY).
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#5b7ba8'); // zenith
  grad.addColorStop(0.5, '#9fb8d6'); // horizon haze (== scene fog colour)
  grad.addColorStop(1, '#8aa0bd'); // ground-side, slightly muted
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Sun: equirect uv from direction, then a warm radial glow with a bright core.
  const [sx, sy, sz] = SUN_DIR;
  const u = Math.atan2(sz, sx) / (2 * Math.PI) + 0.5;
  const v = Math.asin(sy) / Math.PI + 0.5;
  const px = u * W;
  const py = (1 - v) * H; // canvas row 0 is the top (flipY default)
  const glow = ctx.createRadialGradient(px, py, 0, px, py, 150);
  glow.addColorStop(0, 'rgba(255,242,217,1)'); // Sun #FFF2D9 core
  glow.addColorStop(0.12, 'rgba(255,240,210,0.9)');
  glow.addColorStop(0.5, 'rgba(230,225,205,0.25)');
  glow.addColorStop(1, 'rgba(200,210,220,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const tex = new Texture(canvas);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
