import { describe, expect, it } from 'vitest';
import { spawnRing } from './spawning';
import { LIMITS } from './round';

describe('spawnRing budget', () => {
  it('max bot count produces exactly LIMITS.botCount[1] spawns total', () => {
    const max = LIMITS.botCount[1];
    const ctCount = Math.floor(max / 2);
    const tCount = max - ctCount;
    expect(spawnRing('CT', ctCount).length + spawnRing('T', tCount).length).toBe(max);
  });

  it('min bot count produces 0 spawns', () => {
    expect(spawnRing('CT', 0).length + spawnRing('T', 0).length).toBe(0);
  });

  it('every spawn at max count has a distinct position', () => {
    const max = LIMITS.botCount[1];
    const ctCount = Math.floor(max / 2);
    const tCount = max - ctCount;
    const all = [...spawnRing('CT', ctCount), ...spawnRing('T', tCount)];
    const keys = all.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
    expect(new Set(keys).size).toBe(max);
  });
});
