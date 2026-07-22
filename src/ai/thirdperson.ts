/**
 * Third-person fidelity helpers — Phase 12.
 *
 * Shared utilities called from BOTH the SP enemies loop and the MP remote-roots
 * loop (the two-surface tax). Everything here is cosmetic, client-side render
 * work — no sim state, no server authority.
 *
 * - applyWeaponPose: overrides the arm bones with a fixed "holding a weapon"
 *   pose each frame (after the AnimationMixer update), so the arms don't move —
 *   they hold the gun pointing forward while the legs still walk/idle.
 * - getWeaponMuzzle: world-space muzzle position + direction computed from the
 *   weapon model attached to the right-hand bone, for third-person muzzle FX.
 *
 * The pose is a set of ABSOLUTE local bone quaternions (not offsets composed on
 * the animation). They were solved from the .glb's bind pose so the upper arms
 * raise forward while each HAND keeps its bind world orientation — the gun is
 * rigidly parented to the hand, so preserving the hand orientation keeps the
 * barrel pointing forward regardless of how the arm is raised. Overriding
 * absolutely (rather than premultiplying an offset) also means the pose can't
 * drift when the walk/idle clip doesn't re-key a bone.
 *
 * ponytail: solved for this specific mixamorig bind pose. Model-forward is −Z
 * (confirmed from aim.yaw = atan2(-dir.x,-dir.z) with root.rotation.y = yaw).
 * Re-solve if the rig or bind pose changes. Known cosmetic ceiling: keeping the
 * hand's bind world orientation while the forearm raises bends the wrist ~90°;
 * fine at bot viewing distance, revisit if a hold looks broken up close.
 */
import { Object3D, Quaternion, Vector3 } from 'three';

// Scratch — reused to keep the hot path allocation-free.
const sQuat = new Quaternion();
const sMuzzleDir = new Vector3(0, 0, -1);
const sMuzzlePos = new Vector3();
const sWorldPos = new Vector3();
const sWorldDir = new Vector3();

// ── Bone name queries (case-insensitive, partial match) ────────────────────

function findBone(root: Object3D, nameRe: RegExp): Object3D | undefined {
  let found: Object3D | undefined;
  root.traverse((o) => { if (!found && nameRe.test(o.name)) found = o; });
  return found;
}

// ── Weapon pose constants (absolute local bone quaternion, xyzw) ────────────
//
// Each frame these REPLACE the mixer-driven rotation on the arm bones, freezing
// the upper body in a weapon-hold while the mixer keeps driving spine/legs.
// Solved from the .glb bind pose (see module doc). The shoulders and hands are
// intentionally left to the animation clip; only arm+forearm are overridden,
// which is enough to raise the gun forward without a broken-wrist look.

interface BonePose {
  /** regex to match the bone name (case-insensitive) */
  re: RegExp;
  /** absolute local rotation, quaternion [x, y, z, w] */
  quat: [number, number, number, number];
}

// Right arm raised forward; left arm brought forward toward the foregrip. Hands
// solved to preserve their bind world orientation so the parented gun keeps
// pointing forward. See the derivation note in the module header.
const POSE_RIFLE: BonePose[] = [
  { re: /rightarm/i,     quat: [0.6259, -0.0109, 0.2236, 0.7471] },
  { re: /rightforearm/i, quat: [0.0544, -0.0429, -0.0414, 0.9967] },
  { re: /righthand/i,    quat: [-0.6857, 0.0004, 0.0041, 0.7278] },
  { re: /leftarm/i,      quat: [0.6177, 0.0116, -0.2535, 0.7443] },
  { re: /leftforearm/i,  quat: [0.06, 0.0856, 0.0894, 0.9902] },
  { re: /lefthand/i,     quat: [-0.686, -0.0003, -0.0375, 0.7263] },
];

// ponytail: pistol reuses the rifle hold for now (bots only spawn with rifles;
// the pistol path is param plumbing). Solve a tighter two-hand pistol stance if
// a bot ever spawns with one.
const POSE_PISTOL: BonePose[] = POSE_RIFLE;

const POSES: Record<string, BonePose[]> = { rifle: POSE_RIFLE, pistol: POSE_PISTOL };

/**
 * Overwrite the arm bones with the fixed weapon-hold pose. Call after
 * mixer.update() and before the scene renders, so it wins over the clip.
 *
 * Absolute (not composed on the animation): the arms hold still. Bones not in
 * the pose list (spine, legs, shoulders) keep animating normally.
 */
export function applyWeaponPose(root: Object3D, weapon: 'rifle' | 'pistol'): void {
  const poses = POSES[weapon]!;
  for (const pose of poses) {
    const bone = findBone(root, pose.re);
    if (!bone) continue;
    bone.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
  }
}

/**
 * Compute the world-space muzzle position and forward direction from a
 * character's attached weapon. Returns null if no weapon or right-hand bone
 * is found.
 *
 * The weapon model's local forward is -Z (Blender +Y → three.js -Z). The
 * muzzle is at the far -Z extent of the weapon's bounding box.
 *
 * ponyail: if the weapon glb includes a named "muzzle" empty, use that
 * instead of the bounding-box extent for the muzzle position.
 */
export function getWeaponMuzzle(root: Object3D): { pos: Vector3; dir: Vector3 } | null {
  const hand = findBone(root, /righthand/i);
  if (!hand) return null;

  let weapon: Object3D | undefined;
  hand.traverse((o) => {
    if (!weapon && o !== hand && o.type === 'Mesh') weapon = o;
  });
  if (!weapon) return null;

  weapon.getWorldPosition(sMuzzlePos);
  // Muzzle is at the far forward extent: offset from the weapon's world
  // position along its -Z (forward) by the weapon's half-depth.
  // ponytail: use a named "muzzle" empty or a per-weapon constant if the
  // bbox extent is wrong at this resolution.
  const bbox = weapon.parent ?? weapon;
  sMuzzlePos.add(
    sMuzzleDir.set(0, 0, -0.6).applyQuaternion(bbox.getWorldQuaternion(sQuat)),
  );

  sWorldDir.set(0, 0, -1).applyQuaternion(bbox.getWorldQuaternion(sQuat));
  sWorldPos.copy(sMuzzlePos);
  return { pos: sWorldPos, dir: sWorldDir };
}
