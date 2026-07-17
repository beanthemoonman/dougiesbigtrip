import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  aimDirection,
  applySpread,
  canFire,
  createWeaponState,
  fireShot,
  startReload,
  tickWeapon,
} from './hitscan';
import { WEAPONS } from './defs';
import { makeRng } from '../core/rng';

const rifle = WEAPONS.rifle;

describe('aimDirection', () => {
  it('yaw=pitch=0 looks down -Z', () => {
    const d = aimDirection(0, 0, new Vector3());
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(-1, 6);
  });

  it('+pitch looks up, +yaw swings toward -X (matches camera YXZ)', () => {
    const up = aimDirection(0, Math.PI / 2, new Vector3());
    expect(up.y).toBeCloseTo(1, 6);
    const right = aimDirection(Math.PI / 2, 0, new Vector3());
    expect(right.x).toBeCloseTo(-1, 6);
    expect(right.z).toBeCloseTo(0, 6);
  });

  it('always returns a unit vector', () => {
    expect(aimDirection(0.7, -0.3, new Vector3()).length()).toBeCloseTo(1, 6);
  });
});

describe('applySpread', () => {
  const fwd = new Vector3(0, 0, -1);

  it('zero spread is a no-op', () => {
    const out = applySpread(fwd, 0, makeRng(1), new Vector3());
    expect(out.distanceTo(fwd)).toBeCloseTo(0, 6);
  });

  it('never exceeds the cone half-angle and stays unit-length', () => {
    const rng = makeRng(42);
    const spread = 0.1; // rad
    for (let i = 0; i < 2000; i++) {
      const out = applySpread(fwd, spread, rng, new Vector3());
      expect(out.length()).toBeCloseTo(1, 5);
      const angle = Math.acos(Math.min(1, out.dot(fwd)));
      expect(angle).toBeLessThanOrEqual(spread + 1e-6);
    }
  });

  it('is unbiased: mean direction ≈ aim over many samples', () => {
    const rng = makeRng(7);
    const acc = new Vector3();
    const n = 20000;
    for (let i = 0; i < n; i++) acc.add(applySpread(fwd, 0.1, rng, new Vector3()));
    acc.divideScalar(n).normalize();
    expect(acc.distanceTo(fwd)).toBeLessThan(0.01);
  });

  it('is deterministic for a given seed', () => {
    const x = applySpread(fwd, 0.1, makeRng(5), new Vector3());
    const y = applySpread(fwd, 0.1, makeRng(5), new Vector3());
    expect(x.equals(y)).toBe(true);
  });
});

describe('fire-rate / ammo gating', () => {
  it('fires immediately, then blocks until fireInterval elapses', () => {
    const s = createWeaponState(rifle);
    const rng = makeRng(1);
    expect(fireShot(s, rifle, 0, 0, 'crouchStill', rng, new Vector3())).not.toBeNull();
    expect(s.ammo).toBe(rifle.mag - 1);
    // same tick, no time passed → blocked
    expect(fireShot(s, rifle, 0, 0, 'crouchStill', rng, new Vector3())).toBeNull();
    // advance a full interval → allowed again
    tickWeapon(s, rifle, rifle.fireInterval);
    expect(canFire(s, rifle)).toBe(true);
  });

  it('empties the mag then refuses to fire', () => {
    const s = createWeaponState(rifle);
    const rng = makeRng(2);
    for (let i = 0; i < rifle.mag; i++) {
      expect(fireShot(s, rifle, 0, 0, 'crouchStill', rng, new Vector3())).not.toBeNull();
      tickWeapon(s, rifle, rifle.fireInterval);
    }
    expect(s.ammo).toBe(0);
    expect(fireShot(s, rifle, 0, 0, 'crouchStill', rng, new Vector3())).toBeNull();
  });
});

describe('reload', () => {
  it('refills the mag only after reloadTime, and blocks firing meanwhile', () => {
    const s = createWeaponState(rifle);
    s.ammo = 3;
    startReload(s, rifle);
    expect(s.reloading).toBe(true);
    expect(canFire(s, rifle)).toBe(false);
    tickWeapon(s, rifle, rifle.reloadTime - 0.01);
    expect(s.ammo).toBe(3); // not done yet
    tickWeapon(s, rifle, 0.02);
    expect(s.reloading).toBe(false);
    expect(s.ammo).toBe(rifle.mag);
  });

  it('does not reload a full mag', () => {
    const s = createWeaponState(rifle);
    startReload(s, rifle);
    expect(s.reloading).toBe(false);
  });
});

describe('fireShot integration', () => {
  it('a full spray drifts up-and-around (recoil punch accumulates into aim)', () => {
    const s = createWeaponState(rifle);
    const rng = makeRng(3);
    const fire = () => {
      const shot = fireShot(s, rifle, 0, 0, 'crouchStill', rng, new Vector3());
      if (!shot) throw new Error('expected a shot');
      return shot.direction.clone();
    };
    const first = fire();
    for (let i = 0; i < 6; i++) {
      tickWeapon(s, rifle, rifle.fireInterval);
      fire();
    }
    tickWeapon(s, rifle, rifle.fireInterval);
    const seventh = fire();
    // AK climbs for the first shots → later bullet aims higher (more +Y) than the first.
    expect(seventh.y).toBeGreaterThan(first.y);
  });

  it('is fully deterministic given the same seed and inputs', () => {
    const run = () => {
      const s = createWeaponState(rifle);
      const rng = makeRng(99);
      const dirs: number[] = [];
      for (let i = 0; i < 10; i++) {
        const shot = fireShot(s, rifle, 0.1, 0.2, 'still', rng, new Vector3());
        if (shot) dirs.push(shot.direction.x, shot.direction.y, shot.direction.z);
        tickWeapon(s, rifle, rifle.fireInterval);
      }
      return dirs;
    };
    expect(run()).toEqual(run());
  });
});
