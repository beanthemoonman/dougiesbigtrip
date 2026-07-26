/**
 * T0 unit test for the third-person weapon pose (src/ai/thirdperson.ts).
 *
 * applyWeaponPose sets absolute local rotations, so the arms hold still. This
 * guards two things: the pose actually rotates the arm (regression from when
 * bad values left it near identity), and it's stable across frames — even if
 * the mixer re-keys the bone in between, the next call clamps it back (the old
 * premultiply version accumulated and spun the arms wildly).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Bone, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  applyWeaponPose, BUTT, FORE, GRIP, WEAPON_POS, WEAPON_QUAT, WEAPON_SCALE,
} from './thirdperson';

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

/**
 * The hold, checked against the real rig instead of by eye. States the *intent*
 * — stock in the shoulder, hands on grip and handguard — as distances, so it
 * fails if the baked quaternions drift away from what solvepose.ts designed
 * (including if someone edits the solver's landmarks and forgets to re-bake).
 */
describe('rifle hold geometry (ct_player.glb)', () => {
  const root = new Object3D();
  const gun = new Object3D();

  const bone = (re: RegExp): Object3D => {
    let hit: Object3D | undefined;
    root.traverse((o) => { if (!hit && re.test(o.name)) hit = o; });
    if (!hit) throw new Error(`no bone ${re}`);
    return hit;
  };

  beforeAll(async () => {
    const glb = readFileSync('assets/characters/ct_player.glb');
    const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
    root.add(
      await new Promise<Object3D>((res, rej) =>
        new GLTFLoader().parse(ab as ArrayBuffer, '', (g) => res(g.scene), rej),
      ),
    );
    applyWeaponPose(root, 'rifle');
    // Weapon rides the right-hand bone; landmark points ride the weapon.
    gun.position.copy(WEAPON_POS);
    gun.quaternion.copy(WEAPON_QUAT);
    gun.scale.setScalar(WEAPON_SCALE);
    bone(/righthand/i).add(gun);
    root.updateMatrixWorld(true);
  });

  const world = (local: Vector3) => gun.localToWorld(local.clone());
  const at = (o: Object3D) => o.getWorldPosition(new Vector3());

  it('puts the butt pad in the right shoulder, not the left and not mid-air', () => {
    const butt = world(BUTT);
    const right = at(bone(/rightarm$/i));
    const left = at(bone(/leftarm$/i));
    expect(butt.distanceTo(right)).toBeLessThan(0.2);
    expect(butt.distanceTo(right)).toBeLessThan(butt.distanceTo(left));
  });

  it('puts the right hand on the pistol grip', () => {
    expect(at(bone(/righthand/i)).distanceTo(world(GRIP))).toBeLessThan(0.07);
  });

  it('puts the left hand on the handguard', () => {
    expect(at(bone(/lefthand/i)).distanceTo(world(FORE))).toBeLessThan(0.09);
  });

  it('points the barrel where the actor is facing', () => {
    // The gun's local -Z is the bore. The actor faces -Z, so from behind the
    // model the barrel must run straight away, not canted across the chest.
    const bore = world(new Vector3(0, 0, -1)).sub(world(new Vector3())).normalize();
    expect(Math.abs(Math.atan2(-bore.x, -bore.z))).toBeLessThan(0.05); // < ~3° of yaw
    expect(Math.abs(bore.y)).toBeLessThan(0.05);             // and level
  });
});
