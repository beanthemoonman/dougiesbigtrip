import { describe, it, expect } from 'vitest';
import { WEAPONS, type WeaponId } from './defs';

const ids = Object.keys(WEAPONS) as WeaponId[];

describe('weapon defs invariants', () => {
  it.each(ids)('%s has sane, in-range fields', (id) => {
    const w = WEAPONS[id];
    expect(w.fireInterval).toBeGreaterThan(0);
    expect(w.damage).toBeGreaterThan(0);
    expect(w.armorPen).toBeGreaterThanOrEqual(0);
    expect(w.armorPen).toBeLessThanOrEqual(1);
    expect(w.falloffCoef).toBeGreaterThan(0);
    expect(w.falloffCoef).toBeLessThanOrEqual(1);
    expect(w.baseSpread).toBeGreaterThan(0);
    expect(w.mag).toBeGreaterThan(0);
    expect(w.reloadTime).toBeGreaterThan(0);
    expect(w.speedMult).toBeGreaterThan(0);
    expect(w.speedMult).toBeLessThanOrEqual(1);
    expect(w.recoil.pattern.length).toBeGreaterThan(0);
    expect(w.recoil.pattern.every((s) => Number.isFinite(s.yaw) && Number.isFinite(s.pitch))).toBe(true);
  });

  it('rifle recoil climbs (net upward pitch over the first 7 shots)', () => {
    const climb = WEAPONS.rifle.recoil.pattern.slice(0, 7).reduce((a, s) => a + s.pitch, 0);
    expect(climb).toBeGreaterThan(0);
  });

  it('range falloff makes the pistol a pea-shooter at distance vs the rifle', () => {
    const at = (coef: number, d: number) => Math.pow(coef, d / 5);
    expect(at(WEAPONS.pistol.falloffCoef, 40)).toBeLessThan(at(WEAPONS.rifle.falloffCoef, 40));
  });
});
