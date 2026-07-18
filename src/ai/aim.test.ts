import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { angleDelta, desiredYawPitch, onTarget, stepAim, stepAngle } from './aim';

// T0: pure aim geometry. The load-bearing property is "never snaps": one step
// moves at most turnRate*dt, and it takes the shortest way round the ±π wrap.

describe('aim: angleDelta', () => {
  it('is shortest signed and wraps across ±π', () => {
    expect(angleDelta(0, 1)).toBeCloseTo(1);
    expect(angleDelta(1, 0)).toBeCloseTo(-1);
    // From +3.0 to -3.0 the short way is +0.28 (over the wrap), not -6.0.
    expect(angleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6.0, 5);
  });
});

describe('aim: stepAngle', () => {
  it('never moves more than maxStep (no snap)', () => {
    expect(stepAngle(0, Math.PI, 0.1)).toBeCloseTo(0.1);
  });
  it('lands exactly on target once within reach', () => {
    expect(stepAngle(0, 0.05, 0.1)).toBe(0.05);
  });
  it('turns the short way across the wrap', () => {
    // current 3.0, target -3.0: short way is +, so it increases past π.
    expect(stepAngle(3.0, -3.0, 0.1)).toBeCloseTo(3.1);
  });
});

describe('aim: stepAim converges without snapping', () => {
  it('reaches a target 180° away in ~ (π / turnRate) seconds, never overshooting a tick cap', () => {
    const aim = { yaw: 0, pitch: 0 };
    const turnRate = 6; // rad/s
    const dt = 1 / 64;
    const targetYaw = Math.PI - 0.001;
    let prev = 0;
    for (let t = 0; t < 64; t++) {
      stepAim(aim, targetYaw, 0, turnRate, dt);
      expect(Math.abs(angleDelta(prev, aim.yaw))).toBeLessThanOrEqual(turnRate * dt + 1e-9);
      prev = aim.yaw;
    }
    // π rad at 6 rad/s ≈ 0.52 s < 1 s → converged.
    expect(onTarget(aim, targetYaw, 0, 0.02)).toBe(true);
  });
});

describe('aim: desiredYawPitch', () => {
  it('yaw=pitch=0 looks down -Z; +Y target pitches up', () => {
    const out = { yaw: 0, pitch: 0 };
    desiredYawPitch(new Vector3(0, 0, 0), new Vector3(0, 0, -1), out);
    expect(out.yaw).toBeCloseTo(0);
    expect(out.pitch).toBeCloseTo(0);
    desiredYawPitch(new Vector3(0, 0, 0), new Vector3(0, 1, 0), out);
    expect(out.pitch).toBeCloseTo(Math.PI / 2);
  });
});
