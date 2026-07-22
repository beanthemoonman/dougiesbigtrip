/**
 * T0 unit test for the third-person weapon pose (src/ai/thirdperson.ts).
 *
 * applyWeaponPose sets absolute local rotations, so the arms hold still. This
 * guards two things: the pose actually rotates the arm (regression from when
 * bad values left it near identity), and it's stable across frames — even if
 * the mixer re-keys the bone in between, the next call clamps it back (the old
 * premultiply version accumulated and spun the arms wildly).
 */
import { describe, expect, it } from 'vitest';
import { Bone, Object3D, Quaternion } from 'three';
import { applyWeaponPose } from './thirdperson';

function rig(): Object3D {
  const root = new Object3D();
  for (const name of ['mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand',
                       'mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand']) {
    const b = new Bone();
    b.name = name;
    root.add(b);
  }
  return root;
}

describe('applyWeaponPose', () => {
  it('raises the arm out of the identity/rest pose', () => {
    const root = rig();
    applyWeaponPose(root, 'rifle');
    const arm = root.children.find((c) => c.name === 'mixamorig:RightArm')!;
    // ~1.4 rad of rotation from rest — a real forward raise, not a no-op.
    expect(arm.quaternion.angleTo(new Quaternion())).toBeGreaterThan(1);
  });

  it('holds a fixed pose regardless of what the mixer did that frame', () => {
    const root = rig();
    applyWeaponPose(root, 'rifle');
    const arm = root.children.find((c) => c.name === 'mixamorig:RightArm')!;
    const target = arm.quaternion.clone();
    for (let i = 0; i < 200; i++) {
      arm.quaternion.set(Math.sin(i), Math.cos(i * 1.7), Math.sin(i * 0.3), 1).normalize(); // mixer noise
      applyWeaponPose(root, 'rifle');
      expect(arm.quaternion.angleTo(target)).toBeLessThan(1e-6);
    }
  });
});
