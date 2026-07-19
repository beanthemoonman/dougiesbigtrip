import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';

// The panel itself is DOM glue over native <input type=range> (which clamps for
// us) — not worth a jsdom dependency to test. What's worth pinning is that the
// defaults stay sane, so a fat-fingered edit (volume 11, FOV 900) is caught.
describe('settings defaults', () => {
  it('are in a sane range', () => {
    expect(DEFAULT_SETTINGS.sensitivity).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.sensitivity).toBeLessThan(0.01);
    expect(DEFAULT_SETTINGS.worldFovDeg).toBe(90); // CS default, per art-direction.md
    expect(DEFAULT_SETTINGS.volume).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_SETTINGS.volume).toBeLessThanOrEqual(1);
  });
});
