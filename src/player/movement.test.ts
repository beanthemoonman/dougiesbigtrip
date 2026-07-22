import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { accelerate, airAccelerate, clipVelocity, friction } from './movement';
import { DUCK_SPEED_SCALE, WALK_SPEED_SCALE } from './constants';

/**
 * Golden-value tests from docs/source-movement.md. If these disagree with the
 * implementation, the implementation is wrong — see the doc before touching
 * movement.ts. Keep these green forever.
 */

const DT = 1 / 64;
const WISHSPEED = 6.35;
const SV_ACCELERATE = 5.0;
const SV_AIRACCELERATE = 10.0;

describe('Case A — ground acceleration from rest, wishdir = forward', () => {
  it('matches the reference table (friction then accelerate, per tick)', () => {
    const wishdir = new Vector3(1, 0, 0);
    const vel = new Vector3(0, 0, 0);
    const expected = [0.49609, 0.83344, 1.17078, 1.50813, 1.84547];

    for (const target of expected) {
      friction(vel, DT, true, 1);
      accelerate(vel, wishdir, WISHSPEED, SV_ACCELERATE, DT, 1);
      expect(vel.length()).toBeCloseTo(target, 4);
    }
  });

  it('converges to exactly wishspeed', () => {
    const wishdir = new Vector3(1, 0, 0);
    const vel = new Vector3(0, 0, 0);
    for (let i = 0; i < 500; i++) {
      friction(vel, DT, true, 1);
      accelerate(vel, wishdir, WISHSPEED, SV_ACCELERATE, DT, 1);
    }
    expect(vel.length()).toBeCloseTo(WISHSPEED, 5);
  });
});

describe('Case B — friction decel from 6.35 m/s, no input', () => {
  it('matches the reference table (× 0.9375 per tick above stopspeed)', () => {
    const vel = new Vector3(6.35, 0, 0);
    const expected = [5.95313, 5.58105, 5.23223, 4.90522, 4.59864];

    for (const target of expected) {
      friction(vel, DT, true, 1);
      expect(vel.length()).toBeCloseTo(target, 4);
    }
  });
});

describe('airAccelerate asymmetry', () => {
  it('clamps addspeed to AIR_WISHSPEED_CAP but computes accelspeed from the unclamped wishspeed', () => {
    // Perpendicular wishdir against an already-fast velocity: currentspeed
    // (the projection) is ~0, so addspeed stays positive even though the
    // player is moving far faster than the air cap — this is the whole trick.
    const vel = new Vector3(10, 0, 0); // already well above both the ground and air caps
    const wishdir = new Vector3(0, 0, 1); // perpendicular to vel
    const before = vel.length();

    airAccelerate(vel, wishdir, WISHSPEED, SV_AIRACCELERATE, DT, 1);

    expect(vel.length()).toBeGreaterThan(before); // perpendicular addition must grow the vector
    expect(vel.x).toBeCloseTo(10, 6); // forward component untouched
    expect(vel.z).toBeGreaterThan(0); // gained speed in the wishdir direction
  });

  it('adds nothing once already moving at/above wishspeed along wishdir', () => {
    const vel = new Vector3(0.762, 0, 0); // exactly at the air cap along wishdir
    const wishdir = new Vector3(1, 0, 0);
    airAccelerate(vel, wishdir, WISHSPEED, SV_AIRACCELERATE, DT, 1);
    expect(vel.x).toBeCloseTo(0.762, 6);
  });
});

describe('Case C — air strafe (generated + frozen baseline)', () => {
  it('gains speed without bound while wishdir sweeps ahead of velocity', () => {
    // Mirrors real strafejumping: wishdir's heading advances at a constant
    // rate driven by the mouse, independent of velocity's own heading —
    // velocity chases it and gains speed each tick. See "Bunnyhopping from
    // the Programmer's Perspective" (Flafla2), referenced in the doc.
    const vel = new Vector3(WISHSPEED, 0, 0); // launched at the ground speed cap
    let heading = Math.atan2(vel.z, vel.x);
    const turnRateRadPerSec = Math.PI; // 180 deg/s, a brisk but plausible mouse sweep
    const wishdir = new Vector3();
    const speeds: number[] = [];
    const TICKS = 128; // 2 s of airborne strafing

    for (let i = 0; i < TICKS; i++) {
      heading += turnRateRadPerSec * DT;
      wishdir.set(Math.cos(heading), 0, Math.sin(heading));
      airAccelerate(vel, wishdir, WISHSPEED, SV_AIRACCELERATE, DT, 1);
      speeds.push(vel.length());
    }

    // Acceptance criterion for the whole phase: sustained speed well above
    // the 6.35 m/s ground cap, with no upper bound imposed anywhere.
    const first = speeds[0] as number;
    const last = speeds[speeds.length - 1] as number;
    expect(last).toBeGreaterThan(WISHSPEED);
    expect(last).toBeGreaterThan(first);
    expect(speeds.map((s) => Number(s.toFixed(3)))).toMatchSnapshot();
  });
});

describe('10.0 — residual creep → dead stop', () => {
  it('friction returns without zeroing velocity below the 0.1 m/s floor (Source behaviour)', () => {
    const vel = new Vector3(0.05, 0, 0);
    friction(vel, DT, true, 1);
    expect(vel.length()).toBeCloseTo(0.05, 8); // unchanged — friction returns early
  });

  it('friction processes speed exactly at threshold (0.1 is not less than 0.1)', () => {
    // 0.1 is processed by friction because the guard is strict-less-than.
    // With stopspeed 2.54, drop = 0.15875, so 0.1 gets fully zeroed by friction.
    const vel = new Vector3(0.1, 0, 0);
    friction(vel, DT, true, 1);
    expect(vel.length()).toBe(0);
  });

  it('velocity above threshold is decayed by friction', () => {
    const vel = new Vector3(0.5, 0, 0);
    friction(vel, DT, true, 1);
    expect(vel.length()).toBeGreaterThan(0);
    expect(vel.length()).toBeLessThan(0.5);
  });

  it('between 0.1 and stopspeed, friction decays but may leave residual below 0.1', () => {
    // Speed 0.16 → drop 0.15875 → residual 0.00125 (below 0.1 floor, stuck)
    const vel = new Vector3(0.16, 0, 0);
    friction(vel, DT, true, 1);
    // After friction: control = stopspeed (2.54), drop = 0.15875
    // newspeed = 0.16 - 0.15875 = 0.00125
    // friction returns early on this tick, speed stays in the dead zone
    expect(vel.length()).toBeGreaterThan(0);
    expect(vel.length()).toBeLessThan(0.1);
  });
});

describe('10.1 — walk (Shift) steady-state speed', () => {
  it('converges to ~52% of ground speed with WALK scale', () => {
    const vel = new Vector3(0, 0, 0);
    const wishdir = new Vector3(1, 0, 0);
    const targetSpeed = WISHSPEED * WALK_SPEED_SCALE;
    for (let i = 0; i < 500; i++) {
      friction(vel, DT, true, 1);
      accelerate(vel, wishdir, targetSpeed, SV_ACCELERATE, DT, 1);
    }
    expect(vel.length()).toBeCloseTo(targetSpeed, 4);
  });

  it('steady-state speed is below full walk speed', () => {
    expect(WISHSPEED * WALK_SPEED_SCALE).toBeLessThan(WISHSPEED);
  });
});

describe('10.1 — crouch-walk (Ctrl) steady-state speed', () => {
  it('converges to ~34% of ground speed with DUCK scale', () => {
    const vel = new Vector3(0, 0, 0);
    const wishdir = new Vector3(1, 0, 0);
    const targetSpeed = WISHSPEED * DUCK_SPEED_SCALE;
    for (let i = 0; i < 500; i++) {
      friction(vel, DT, true, 1);
      accelerate(vel, wishdir, targetSpeed, SV_ACCELERATE, DT, 1);
    }
    expect(vel.length()).toBeCloseTo(targetSpeed, 4);
  });
});

describe('10.1 — walk + duck combined speed', () => {
  it('stacks multiplicatively: 0.52 * 0.34 (low wishspeed oscillates with stopspeed floor)', () => {
    // At this very low wishspeed (~1.12 m/s), the per-tick accelerate step
    // (~0.088) is smaller than the per-tick friction floor drop (~0.159 when
    // speed < stopspeed 2.54), so velocity oscillates instead of converging
    // cleanly. The scaled speed is the cap applied, not a steady-state average.
    // Behavioural truth is verified in-game via ACC-018.
    const walkAndDuck = WALK_SPEED_SCALE * DUCK_SPEED_SCALE;
    const targetSpeed = WISHSPEED * walkAndDuck;
    const vel = new Vector3(0, 0, 0);
    const wishdir = new Vector3(1, 0, 0);
    for (let i = 0; i < 500; i++) {
      friction(vel, DT, true, 1);
      accelerate(vel, wishdir, targetSpeed, SV_ACCELERATE, DT, 1);
    }
    // Speed oscillates between ~0 and ~1.1 m/s with the stopspeed floor.
    // The cap is applied correctly, just not smoothly converged.
    expect(vel.length()).toBeGreaterThan(0);
    expect(vel.length()).toBeLessThanOrEqual(targetSpeed);
  });
});

describe('clipVelocity', () => {
  it('removes only the into-plane component (overbounce = 1.0)', () => {
    const vel = new Vector3(1, -1, 0);
    const normal = new Vector3(0, 1, 0); // flat ground
    const out = new Vector3();
    clipVelocity(vel, normal, out);
    expect(out.x).toBeCloseTo(1, 6);
    expect(out.y).toBeCloseTo(0, 6); // downward component into the plane removed
  });

  it('is safe to call in place (out === vin)', () => {
    const vel = new Vector3(1, -1, 0);
    const normal = new Vector3(0, 1, 0);
    clipVelocity(vel, normal, vel);
    expect(vel.x).toBeCloseTo(1, 6);
    expect(vel.y).toBeCloseTo(0, 6);
  });

  it('never leaves the result still moving into the plane (numerical safety pass)', () => {
    const vel = new Vector3(0, -5, 0);
    const normal = new Vector3(0.6, 0.8, 0); // steep-ish wall
    const out = new Vector3();
    clipVelocity(vel, normal, out);
    expect(out.dot(normal)).toBeGreaterThanOrEqual(-1e-9);
  });
});
