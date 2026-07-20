import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Buttons } from '../core/input';
import { moveSpectator, SPEC_SPEED } from './spectator';

describe('moveSpectator', () => {
  it('W at yaw 0 flies down -z (the default forward)', () => {
    const p = new Vector3();
    moveSpectator(p, Buttons.FORWARD, 0, 0, 1); // 1 s
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-SPEC_SPEED);
  });

  it('D strafes +x at yaw 0, independent of pitch', () => {
    const p = new Vector3();
    moveSpectator(p, Buttons.RIGHT, 0, 0.5, 1);
    expect(p.x).toBeCloseTo(SPEC_SPEED);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(0);
  });

  it('W while looking straight up climbs +y', () => {
    const p = new Vector3();
    moveSpectator(p, Buttons.FORWARD, 0, Math.PI / 2, 1);
    expect(p.y).toBeCloseTo(SPEC_SPEED);
  });

  it('no buttons → no movement', () => {
    const p = new Vector3(1, 2, 3);
    moveSpectator(p, 0, 1, 1, 1);
    expect(p.toArray()).toEqual([1, 2, 3]);
  });
});
