import { describe, it, expect } from 'vitest';
import { WEAPONS } from './defs';
import { createRecoilState, onShot, tickRecoil } from './recoil';

const rifle = WEAPONS.rifle;

describe('recoil accumulator', () => {
  it('first shot fires pattern step 0 and climbs on subsequent shots', () => {
    const s = createRecoilState();
    onShot(s, rifle);
    expect(s.sprayIndex).toBe(0);
    const [step0] = rifle.recoil.pattern;
    expect(s.punch.pitch).toBeCloseTo(step0?.pitch ?? NaN, 5);
    const p0 = s.punch.pitch;
    onShot(s, rifle);
    expect(s.sprayIndex).toBe(1);
    expect(s.punch.pitch).toBeGreaterThan(p0); // still climbing early in the spray
  });

  it('is deterministic — same shots produce the same punch', () => {
    const run = () => {
      const s = createRecoilState();
      for (let i = 0; i < 10; i++) onShot(s, rifle);
      return s.punch;
    };
    expect(run()).toEqual(run());
  });

  it('spray index clamps to the last pattern step for long sprays', () => {
    const s = createRecoilState();
    for (let i = 0; i < rifle.recoil.pattern.length + 5; i++) onShot(s, rifle);
    expect(s.sprayIndex).toBe(rifle.recoil.pattern.length - 1);
  });

  it('punch decays toward zero while not firing', () => {
    const s = createRecoilState();
    onShot(s, rifle);
    const before = s.punch.pitch;
    tickRecoil(s, rifle, 1 / 64);
    expect(s.punch.pitch).toBeLessThan(before);
    expect(s.punch.pitch).toBeGreaterThan(0);
  });

  it('spray index resets after resetTime of no fire', () => {
    const s = createRecoilState();
    onShot(s, rifle);
    onShot(s, rifle);
    tickRecoil(s, rifle, rifle.recoil.resetTime + 0.01);
    expect(s.sprayIndex).toBe(-1); // next onShot starts from step 0 again
    onShot(s, rifle);
    expect(s.sprayIndex).toBe(0);
  });
});
