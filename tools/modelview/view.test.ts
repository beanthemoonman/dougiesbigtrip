import { describe, it, expect } from 'vitest';
import { renderModel, type AngleBuffer } from './view';

/**
 * Self-check: renders the crate at iso, 256², and asserts > 1% non-background
 * pixels (i.e. something actually drew — not a blank grey frame). No golden
 * image, no pixel-diff. Just "not blank."
 */
describe('modelview CLI', () => {
  it('renders crate_wood.glb at iso and produces non-blank pixels', async () => {
    const bgHex = '808080';
    const bgR = parseInt(bgHex.substring(0, 2), 16);
    const bgG = parseInt(bgHex.substring(2, 4), 16);
    const bgB = parseInt(bgHex.substring(4, 6), 16);
    const threshold = 5; // tolerance for background match

    const results: AngleBuffer[] = await renderModel({
      glbPath: 'assets/props/crate_wood.glb',
      angles: ['iso'],
      size: 256,
      bg: bgHex,
      outDir: '.modelview',
      returnBuffers: true,
    });

    expect(results).toHaveLength(1);
    const { name, rgba } = results[0]!;
    expect(name).toBe('iso');
    expect(rgba).toHaveLength(256 * 256 * 4);

    let nonBg = 0;
    const total = 256 * 256;
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      if (
        Math.abs(r - bgR) > threshold ||
        Math.abs(g - bgG) > threshold ||
        Math.abs(b - bgB) > threshold
      ) {
        nonBg++;
      }
    }

    const pct = (nonBg / total) * 100;
    expect(pct).toBeGreaterThan(1);
  }, 30000);
});
