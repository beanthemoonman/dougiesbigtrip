/**
 * Solve the third-person weapon-hold pose and print the constants for
 * `src/ai/thirdperson.ts` (POSE_RIFLE + WEAPON_ATTACH).
 *
 * Why this exists: the hold is eight bone quaternions plus a hand-space weapon
 * transform. Hand-tuning those produced a gun floating off the shoulder with
 * the left arm nowhere near the foregrip. Instead, state the pose in terms you
 * can actually reason about — "butt pad sits in the shoulder pocket, right hand
 * on the pistol grip, left hand on the handguard, barrel dead ahead" — and let
 * a shoulder roll plus two-bone IK produce the quaternions.
 *
 *   npx tsx tools/modelview/solvepose.ts         # prints the constants
 *
 * Iterate on the landmarks below with `pnpm modelview ... --pose rifle --solve`
 * (which renders this solver's live output instead of the baked constants),
 * then paste the printed block into src/ai/thirdperson.ts. Re-run after any
 * change to the rig's bind pose or the weapon glb's proportions.
 *
 * All coordinates are three.js space (Y up, model faces -Z), metres.
 */
import { readFileSync } from 'node:fs';
import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// The weapon-local contact points (BUTT/GRIP/FORE — from tools/blender/build_weapons.py,
// Blender xyz → three `(x, z, -y)`) live in src/ so the geometry test can reach
// them; they're tunables of *this* solver, edit them there.
import { BUTT, FORE, GRIP } from '../../src/ai/thirdperson.js';

// ── Tunables: the hold, described in body/weapon landmarks ─────────────────

/** World-model scale. The glb is a *viewmodel* — ~1.5x oversized on purpose so
 *  it reads at first-person FOV. At 1.0 the foregrip is out of arm's reach. */
const GUN_SCALE = 0.66;

/** Direction the trigger hand's fingers curl: down and back around the grip. */
const GRIP_AXIS = new Vector3(0, -1, 0.35);
/** Support hand's fingers wrap across the handguard, left side → right. */
const FORE_AXIS = new Vector3(0.9, 0.4, 0);

/**
 * The torso, bladed. Per-bone deltas in ROOT space (x = pitch, y = yaw,
 * z = roll, radians), applied down the chain before the arms are solved.
 *
 * This is the load-bearing tunable. The rig's shoulders are wide (±0.27) and
 * its arms short (0.52 shoulder-to-wrist), so with the chest square-on the
 * handguard sits ~0.63 from the left shoulder joint — out of reach. Turning the
 * chest right brings the support shoulder forward and across, which is what a
 * shooter actually does and what CS players look like. The previous fix rolled
 * the shoulder BONES instead, which tore the rigid-skinned shoulder pads off
 * the torso; the spine carries its boxes with it.
 *
 * The neck and head counter-yaw so the actor still looks down the barrel.
 */
const deg = (d: number) => (d * Math.PI) / 180;
const TORSO: [RegExp, Vector3][] = [
  [/Spine1$/i, new Vector3(deg(2), deg(-16), 0)],
  [/Spine2$/i, new Vector3(deg(3), deg(-20), 0)],
  [/Neck$/i, new Vector3(0, deg(16), 0)],
  [/Head$/i, new Vector3(deg(6), deg(20), 0)],
];

/** Butt pad offset from the POSED right shoulder joint — inboard and up, i.e.
 *  the pocket. Relative to the joint so it follows the torso instead of
 *  drifting off the chest when TORSO changes. */
const POCKET_OFF = new Vector3(-0.05, 0.11, 0.0);

/** Yaw of the weapon about +Y. ZERO: viewed from behind, the barrel points
 *  dead down −Z, which is the whole point of a shooting stance — the gun is
 *  aimed where the actor is aimed. The torso blades, the gun doesn't. */
const GUN_YAW = 0;

/** Wrist-to-palm: the IK targets the wrist, the landmarks are palm contacts. */
const PALM = 0.045;

/** Elbow direction hints (character-root space). The trigger elbow rides out
 *  and back (the classic flared firing elbow); the support elbow tucks down and
 *  slightly forward, under the handguard. Straight-down poles read as limp. */
const POLE_R = new Vector3(0.6, -0.75, 0.3);
const POLE_L = new Vector3(-0.25, -0.94, -0.15);

// ── Rig plumbing ───────────────────────────────────────────────────────────

function loadGlb(path: string): Promise<Object3D> {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) =>
    new GLTFLoader().parse(ab as ArrayBuffer, '', (g) => res(g.scene), rej),
  );
}

function bone(root: Object3D, re: RegExp): Object3D {
  let found: Object3D | undefined;
  root.traverse((o) => { if (!found && re.test(o.name)) found = o; });
  if (!found) throw new Error(`no bone matching ${re}`);
  return found;
}

const wPos = (o: Object3D) => o.getWorldPosition(new Vector3());
const wQuat = (o: Object3D) => o.getWorldQuaternion(new Quaternion());

/** Rotation whose local +Y maps to `fingers` and local +Z toward `forward`. */
function basisQuat(fingers: Vector3, forward: Vector3): Quaternion {
  const y = fingers.clone().normalize();
  const z = forward.clone().addScaledVector(y, -forward.dot(y)).normalize();
  const x = new Vector3().crossVectors(y, z);
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, y, z),
  );
}

/** Turn a bone by `e` (root-space euler) on top of where it already is. */
function turn(b: Object3D, e: Vector3): Quaternion {
  const d = new Quaternion().setFromEuler(new Euler(e.x, e.y, e.z, 'YXZ'));
  const local = wQuat(b.parent!).invert().multiply(d).multiply(wQuat(b));
  b.quaternion.copy(local);
  b.updateMatrixWorld(true);
  return local;
}

/**
 * Two-bone IK. Returns the new local rotations for the upper and lower bone so
 * the chain's tip reaches `target`, with the joint pushed toward `pole`.
 */
function solveArm(
  upper: Object3D, lower: Object3D, tip: Object3D,
  target: Vector3, pole: Vector3,
): { upper: Quaternion; lower: Quaternion; lowerWorld: Quaternion } {
  const S = wPos(upper), E = wPos(lower), W = wPos(tip);
  const l1 = E.distanceTo(S), l2 = W.distanceTo(E);

  const toTarget = target.clone().sub(S);
  const d = Math.min(Math.max(toTarget.length(), 1e-4), (l1 + l2) * 0.999);
  const u = toTarget.clone().normalize();

  // Elbow lies on the cone around `u`; the pole picks which way it bends.
  const cosA = Math.min(Math.max((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1), 1);
  const a = Math.acos(cosA);
  const p = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
  const elbow = S.clone()
    .addScaledVector(u, l1 * Math.cos(a))
    .addScaledVector(p, l1 * Math.sin(a));

  const d1 = new Quaternion().setFromUnitVectors(
    E.clone().sub(S).normalize(), elbow.clone().sub(S).normalize(),
  );
  const upperWorld = d1.clone().multiply(wQuat(upper));

  const bindLower = W.clone().sub(E).normalize().applyQuaternion(d1);
  const d2 = new Quaternion().setFromUnitVectors(
    bindLower, target.clone().sub(elbow).normalize(),
  );
  const lowerWorld = d2.clone().multiply(d1).multiply(wQuat(lower));

  const parentWorld = wQuat(upper.parent!);
  return {
    upper: parentWorld.clone().invert().multiply(upperWorld),
    lower: upperWorld.clone().invert().multiply(lowerWorld),
    lowerWorld,
  };
}

const fmt = (q: Quaternion) =>
  `[${[q.x, q.y, q.z, q.w].map((n) => (Math.abs(n) < 1e-4 ? 0 : +n.toFixed(4))).join(', ')}]`;

/** The solved hold: page-transferable plain data plus a paste-ready block. */
export interface Hold {
  bones: { re: string; quat: [number, number, number, number] }[];
  pos: [number, number, number];
  quat: [number, number, number, number];
  scale: number;
  /** Source text for src/ai/thirdperson.ts. */
  text: string;
  /** Human notes — reach vs. arm length, so an unreachable target is obvious. */
  notes: string[];
}

export async function solveHold(): Promise<Hold> {
  const char = await loadGlb('assets/characters/ct_player.glb');
  char.updateMatrixWorld(true);

  const out: string[] = [];
  const bones: Hold['bones'] = [];

  // Blade the torso first — the arms are solved against the posed shoulders.
  for (const [re, e] of TORSO) {
    const b = bone(char, re);
    const q = turn(b, e);
    const name = b.name.replace(/^mixamorig:?/i, '').toLowerCase();
    out.push(`  { re: /${name}$/i,${' '.repeat(Math.max(0, 9 - name.length))} quat: ${fmt(q)} },`);
    bones.push({ re: `${name}$`, quat: [q.x, q.y, q.z, q.w] });
  }

  // Weapon placement in character-root space, hung off the posed shoulder.
  const G = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), GUN_YAW);
  const at = (local: Vector3) =>
    local.clone().multiplyScalar(GUN_SCALE).applyQuaternion(G);
  const pocket = wPos(bone(char, /RightArm$/i)).add(POCKET_OFF);
  const gunPos = pocket.clone().sub(at(BUTT));
  const gripW = gunPos.clone().add(at(GRIP));
  const foreW = gunPos.clone().add(at(FORE));
  const barrel = new Vector3(0, 0, -1).applyQuaternion(G);

  const notes: string[] = [];
  let attach = '';
  let pos: [number, number, number] = [0, 0, 0];
  let quat: [number, number, number, number] = [0, 0, 0, 1];

  for (const side of ['Right', 'Left'] as const) {
    const isRight = side === 'Right';
    const fingers = (isRight ? GRIP_AXIS : FORE_AXIS).clone()
      .normalize().applyQuaternion(G);
    const palm = isRight ? gripW : foreW;
    const wrist = palm.clone().addScaledVector(fingers, -PALM);

    const arm = bone(char, new RegExp(`${side}Arm$`, 'i'));
    const forearm = bone(char, new RegExp(`${side}ForeArm`, 'i'));
    const hand = bone(char, new RegExp(`${side}Hand`, 'i'));

    const ik = solveArm(arm, forearm, hand, wrist, isRight ? POLE_R : POLE_L);
    const handWorld = basisQuat(fingers, barrel);
    const handLocal = ik.lowerWorld.clone().invert().multiply(handWorld);

    const lower = side.toLowerCase();
    out.push(
      `  { re: /${lower}arm$/i,     quat: ${fmt(ik.upper)} },`,
      `  { re: /${lower}forearm/i,  quat: ${fmt(ik.lower)} },`,
      `  { re: /${lower}hand/i,     quat: ${fmt(handLocal)} },`,
    );
    const asArray = (q: Quaternion) => [q.x, q.y, q.z, q.w] as [number, number, number, number];
    bones.push(
      { re: `${lower}arm$`, quat: asArray(ik.upper) },
      { re: `${lower}forearm`, quat: asArray(ik.lower) },
      { re: `${lower}hand`, quat: asArray(handLocal) },
    );

    const reach = wrist.distanceTo(wPos(arm));
    const armLen =
      wPos(forearm).distanceTo(wPos(arm)) + wPos(hand).distanceTo(wPos(forearm));
    notes.push(
      `${lower} wrist reach ${reach.toFixed(3)} m of ${armLen.toFixed(3)} m` +
      (reach > armLen ? '  ← OUT OF REACH, arm will be straight and short' : ''),
    );

    if (isRight) {
      // Weapon rides the right hand: express its root-space transform in the
      // posed hand bone's space.
      const inv = handWorld.clone().invert();
      const p = gunPos.clone().sub(wrist).applyQuaternion(inv);
      const q = inv.clone().multiply(G);
      pos = [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)];
      quat = asArray(q);
      attach =
        `export const WEAPON_POS = new Vector3(${pos.join(', ')});\n` +
        `export const WEAPON_QUAT = new Quaternion(${fmt(q).slice(1, -1)});\n` +
        `export const WEAPON_SCALE = ${GUN_SCALE};`;
    }
  }

  return {
    bones,
    pos,
    quat,
    scale: GUN_SCALE,
    notes,
    text: 'const POSE_RIFLE: BonePose[] = [\n' + out.join('\n') + '\n];\n\n' + attach,
  };
}

// Run directly (`npx tsx tools/modelview/solvepose.ts`) → print the constants.
if (process.argv[1]?.endsWith('solvepose.ts')) {
  solveHold().then((hold) => {
    for (const n of hold.notes) console.log('# ' + n);
    console.log('\n' + hold.text);
  });
}
