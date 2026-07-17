import { describe, expect, it } from 'vitest';
import {
  beginDraw,
  beginHolster,
  beginReload,
  createViewmodelAnim,
  onFire,
  tickViewmodelAnim,
  viewmodelPose,
  type AnimPose,
} from './viewmodel';

/**
 * T0 for the procedural viewmodel FSM (the models have no armature, so
 * draw/idle/reload/holster are pose offsets computed here). Deterministic and
 * clock-free — it ticks at the fixed sim rate.
 */

const pose = (): AnimPose => ({ x: 0, y: 0, z: 0, pitch: 0, roll: 0 });

function run(a: ReturnType<typeof createViewmodelAnim>, seconds: number, dt = 1 / 64): void {
  for (let t = 0; t < seconds; t += dt) tickViewmodelAnim(a, dt);
}

describe('viewmodel anim FSM', () => {
  it('starts drawing from a lowered pose and settles to rest', () => {
    const a = createViewmodelAnim();
    const p = viewmodelPose(a, pose());
    expect(p.y).toBeLessThan(-0.1); // gun starts low
    expect(p.pitch).toBeLessThan(-0.1); // and tilted down
    run(a, 0.5); // past DRAW_TIME
    expect(a.state).toBe('idle');
    const rest = viewmodelPose(a, pose());
    expect(rest.y).toBeCloseTo(0, 5);
    expect(rest.pitch).toBeCloseTo(0, 5);
  });

  it('holster lowers the gun and reports the next weapon exactly once', () => {
    const a = createViewmodelAnim();
    run(a, 0.5); // finish draw -> idle
    beginHolster(a, 'pistol');
    let swapped: string | null = null;
    let swaps = 0;
    for (let t = 0; t < 0.5; t += 1 / 64) {
      const r = tickViewmodelAnim(a, 1 / 64);
      if (r) {
        swapped = r;
        swaps++;
      }
    }
    expect(swapped).toBe('pistol');
    expect(swaps).toBe(1); // not every subsequent tick
  });

  it('reload dips the gun mid-animation and returns to rest', () => {
    const a = createViewmodelAnim();
    run(a, 0.5);
    beginReload(a, 2.2);
    tickViewmodelAnim(a, 1.1); // ~halfway
    const mid = viewmodelPose(a, pose());
    expect(mid.y).toBeLessThan(-0.02); // dipped down
    expect(mid.pitch).toBeLessThan(-0.05);
    run(a, 1.3); // finish
    expect(a.state).toBe('idle');
    const rest = viewmodelPose(a, pose());
    expect(rest.y).toBeCloseTo(0, 5);
  });

  it('firing kicks the gun back toward the camera (+z) and up, then decays', () => {
    const a = createViewmodelAnim();
    run(a, 0.5);
    onFire(a);
    const kicked = viewmodelPose(a, pose());
    expect(kicked.z).toBeGreaterThan(0.01); // toward the eye
    expect(kicked.pitch).toBeGreaterThan(0.01); // muzzle up
    run(a, 0.3); // let it decay
    const settled = viewmodelPose(a, pose());
    expect(settled.z).toBeLessThan(0.001);
  });

  it('is deterministic: identical event/tick sequences give identical poses', () => {
    const play = (): AnimPose => {
      const a = createViewmodelAnim();
      run(a, 0.5);
      onFire(a);
      run(a, 0.02);
      beginReload(a, 2.2);
      run(a, 0.7);
      return viewmodelPose(a, pose());
    };
    expect(play()).toEqual(play());
  });

  it('beginDraw clears any pending holster target', () => {
    const a = createViewmodelAnim();
    run(a, 0.5);
    beginHolster(a, 'pistol');
    beginDraw(a);
    expect(a.next).toBeNull();
    expect(a.state).toBe('draw');
  });
});
