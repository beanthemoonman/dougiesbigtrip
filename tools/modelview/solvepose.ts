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
import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
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

/** Where the butt pad lands: right shoulder pocket, in character-root space. */
const SHOULDER_POCKET = new Vector3(0.10, 1.36, 0.03);
/** Yaw of the weapon about +Y. ZERO: viewed from behind, the barrel points
 *  dead down −Z, which is the whole point of a shooting stance — the gun is
 *  aimed where the actor is aimed. Reach is bought back by the shoulder swing
 *  below, not by cheating the weapon sideways. */
const GUN_YAW = 0;

/** Wrist-to-palm: the IK targets the wrist, the landmarks are palm contacts. */
const PALM = 0.045;

/** How far each shoulder blade rolls toward its hand target, 0..1.
 *  The rig's shoulders are wide (±0.27) and its arms short (0.52
 *  shoulder-to-wrist), so with the gun square to the body the handguard is
 *  ~0.65 from the left shoulder joint — out of reach. A real shooter fixes
 *  this by protracting the support shoulder across the chest; so does this.
 *  The right shoulder barely moves (the stock is already at it). */
const SWING_R = 0.12;
const SWING_L = 0.40;

/** Elbow direction hints (character-root space): out, down and back. */
const POLE_R = new Vector3(0.25, -0.96, 0.1);
const POLE_L = new Vector3(-0.2, -0.97, 0.05);

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

/**
 * Roll a shoulder bone `w` of the way from its bind direction toward `target`,
 * writing the result onto the bone. Moves the arm's root, which is the only
 * thing that makes a square-on rifle hold reachable on this rig.
 */
function swingShoulder(sh: Object3D, arm: Object3D, target: Vector3, w: number): Quaternion {
  const S = wPos(sh);
  const full = new Quaternion().setFromUnitVectors(
    wPos(arm).sub(S).normalize(), target.clone().sub(S).normalize(),
  );
  const d = new Quaternion().slerp(full, w);
  const local = wQuat(sh.parent!).invert().multiply(d).multiply(wQuat(sh));
  sh.quaternion.copy(local);
  sh.updateMatrixWorld(true);
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

  // Weapon placement in character-root space.
  const G = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), GUN_YAW);
  const at = (local: Vector3) =>
    local.clone().multiplyScalar(GUN_SCALE).applyQuaternion(G);
  const gunPos = SHOULDER_POCKET.clone().sub(at(BUTT));
  const gripW = gunPos.clone().add(at(GRIP));
  const foreW = gunPos.clone().add(at(FORE));
  const barrel = new Vector3(0, 0, -1).applyQuaternion(G);

  const out: string[] = [];
  const notes: string[] = [];
  const bones: Hold['bones'] = [];
  let attach = '';
  let pos: [number, number, number] = [0, 0, 0];
  let quat: [number, number, number, number] = [0, 0, 0, 1];

  for (const side of ['Right', 'Left'] as const) {
    const isRight = side === 'Right';
    const fingers = (isRight ? GRIP_AXIS : FORE_AXIS).clone()
      .normalize().applyQuaternion(G);
    const palm = isRight ? gripW : foreW;
    const wrist = palm.clone().addScaledVector(fingers, -PALM);

    const shoulder = bone(char, new RegExp(`${side}Shoulder`, 'i'));
    const arm = bone(char, new RegExp(`${side}Arm$`, 'i'));
    const forearm = bone(char, new RegExp(`${side}ForeArm`, 'i'));
    const hand = bone(char, new RegExp(`${side}Hand`, 'i'));

    const shQuat = swingShoulder(shoulder, arm, wrist, isRight ? SWING_R : SWING_L);
    const ik = solveArm(arm, forearm, hand, wrist, isRight ? POLE_R : POLE_L);
    const handWorld = basisQuat(fingers, barrel);
    const handLocal = ik.lowerWorld.clone().invert().multiply(handWorld);

    const lower = side.toLowerCase();
    out.push(
      `  { re: /${lower}shoulder/i, quat: ${fmt(shQuat)} },`,
      `  { re: /${lower}arm$/i,     quat: ${fmt(ik.upper)} },`,
      `  { re: /${lower}forearm/i,  quat: ${fmt(ik.lower)} },`,
      `  { re: /${lower}hand/i,     quat: ${fmt(handLocal)} },`,
    );
    const asArray = (q: Quaternion) => [q.x, q.y, q.z, q.w] as [number, number, number, number];
    bones.push(
      { re: `${lower}shoulder`, quat: asArray(shQuat) },
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
