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
 * the animation): the arms hold still while the mixer keeps driving spine and
 * legs, and the pose can't drift when a clip doesn't re-key a bone.
 *
 * The hold is a shouldered rifle: butt pad in the right shoulder pocket, right
 * hand on the pistol grip, left hand on the handguard, and the barrel pointing
 * dead down −Z — the gun is aimed where the actor is aimed. The rig's arms are
 * short (0.44 m shoulder-to-wrist) and its shoulders wide (±0.27), so that's
 * only reachable because the pose also BLADES THE TORSO ~36° right (Spine1 +
 * Spine2), bringing the support shoulder forward and across — what a shooter
 * actually does. Neck and Head counter-yaw so the actor still faces the target.
 *
 * ponytail: solved for this specific mixamorig bind pose. Model-forward is −Z
 * (confirmed from aim.yaw = atan2(-dir.x,-dir.z) with root.rotation.y = yaw).
 * Re-solve if the rig or the weapon glb changes:
 *     npx tsx tools/modelview/solvepose.ts
 * and inspect the result with
 *     pnpm modelview assets/characters/ct_player.glb \
 *       --weapon assets/weapons/ak_viewmodel.glb --pose rifle --angles hero,top
 */
import { Object3D, Quaternion, Vector3 } from 'three';

// Scratch — reused to keep the hot path allocation-free.
const sQuat = new Quaternion();
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
// SOLVED, not eyeballed — by tools/modelview/solvepose.ts, which states the
// hold as landmarks (butt pad in the right shoulder pocket, right hand on the
// pistol grip, left hand on the handguard) and runs two-bone IK to get these
// quaternions. Edit the landmarks there, not the numbers here.

export interface BonePose {
  /** regex to match the bone name (case-insensitive) */
  re: RegExp;
  /** absolute local rotation, quaternion [x, y, z, w] */
  quat: [number, number, number, number];
}

const POSE_RIFLE: BonePose[] = [
  { re: /spine1$/i,       quat: [0.0173, -0.1392, 0.0024, 0.9901] },
  { re: /spine2$/i,       quat: [0.026, -0.1736, 0.0033, 0.9845] },
  { re: /neck$/i,         quat: [-0.002, 0.1387, -0.0118, 0.9903] },
  { re: /head$/i,         quat: [0.0428, 0.1712, -0.0409, 0.9835] },
  { re: /rightarm$/i,     quat: [0.4384, -0.0769, 0.3458, 0.826] },
  { re: /rightforearm/i,  quat: [0.5102, 0.0004, 0.5965, 0.6196] },
  { re: /righthand/i,     quat: [-0.927, 0.2711, -0.2209, 0.1357] },
  { re: /leftarm$/i,      quat: [0.3186, 0.0885, -0.516, 0.7902] },
  { re: /leftforearm/i,   quat: [0.4223, -0.0013, -0.3511, 0.8357] },
  { re: /lefthand/i,      quat: [-0.1257, -0.5841, 0.0651, 0.7992] },
];

// Weapon transform in RIGHT-HAND-BONE space — solved alongside the pose above
// and only valid together with it. The world model is scaled down because the
// glb is a viewmodel (deliberately oversized for first-person FOV); at 1.0 the
// handguard sits beyond the rig's arm reach.
export const WEAPON_POS = new Vector3(0, -0.0061, -0.0039);
export const WEAPON_QUAT = new Quaternion(-0.9859, 0, 0, 0.1675);
export const WEAPON_SCALE = 0.66;

// Weapon-local contact landmarks, unscaled — the *inputs* the pose above was
// solved from. They live here rather than in the solver so the geometry test
// can import them without src/ depending on tools/ (which isn't shipped to the
// Docker build). solvepose.ts imports these.
export const BUTT = new Vector3(0, -0.01, 0.375); // centre of the butt pad
export const GRIP = new Vector3(0, -0.075, 0.02); // pistol grip, where the palm sits
export const FORE = new Vector3(0, -0.03, -0.27); // handguard, mid (AK_hg_low spans -0.23..-0.45)

// ponytail: pistol reuses the rifle hold for now (bots only spawn with rifles;
// the pistol path is param plumbing). Solve a tighter two-hand pistol stance if
// a bot ever spawns with one.
const POSE_PISTOL: BonePose[] = POSE_RIFLE;

export const POSES: Record<string, BonePose[]> = { rifle: POSE_RIFLE, pistol: POSE_PISTOL };

/**
 * Overwrite the arm bones with the fixed weapon-hold pose. Call after
 * mixer.update() and before the scene renders, so it wins over the clip.
 *
 * Absolute (not composed on the animation): the upper body holds still. Bones
 * not in the pose list — Hips, Spine, and the legs — keep animating normally,
 * so the walk cycle still reads. (Spine1/Spine2/Neck/Head ARE in the list now:
 * the blade is what makes the hold reachable, so it can't be left to the clip.)
 */
export function applyWeaponPose(root: Object3D, weapon: 'rifle' | 'pistol'): void {
  const poses = POSES[weapon]!;
  for (const pose of poses) {
    const bone = findBone(root, pose.re);
    if (!bone) continue;
    bone.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
  }
}

/** Muzzle tip in weapon-local space: the -Z extent of the ak/pistol glbs. */
const MUZZLE_Z = -0.67;

/**
 * Compute the world-space muzzle position and firing direction from a
 * character's attached weapon. Returns null if no weapon or right-hand bone
 * is found.
 *
 * Position comes from the weapon model (local -Z tip through its world matrix,
 * so WEAPON_SCALE is accounted for). Direction comes from the CHARACTER, not
 * the weapon: the barrel is square to the body so the two now agree, but the
 * root is the authoritative aim and doesn't accumulate IK error.
 *
 * ponytail: if a weapon glb ever gets a named "muzzle" empty, use that instead
 * of MUZZLE_Z. Direction ignores pitch — the root only yaws, same as before.
 */
export function getWeaponMuzzle(root: Object3D): { pos: Vector3; dir: Vector3 } | null {
  const hand = findBone(root, /righthand/i);
  if (!hand) return null;

  let weapon: Object3D | undefined;
  hand.traverse((o) => {
    if (!weapon && o !== hand && o.type === 'Mesh') weapon = o;
  });
  if (!weapon) return null;

  sWorldPos.copy(sMuzzlePos.set(0, 0, MUZZLE_Z)).applyMatrix4(weapon.matrixWorld);
  sWorldDir.set(0, 0, -1).applyQuaternion(root.getWorldQuaternion(sQuat));
  return { pos: sWorldPos, dir: sWorldDir };
}
