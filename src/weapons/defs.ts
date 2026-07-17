/**
 * Weapon data. All gameplay tuning lives here as data, not scattered constants
 * (per CLAUDE.md). Two guns to start: an AK-analogue rifle and a USP-analogue
 * pistol — spray vs. tap. See docs/weapon-feel.md for the field rationale.
 *
 * Ported-from-doc values are noted; everything else is a gameplay tuning number
 * (the doc gives no exact figure — same status as the view-punch constants in
 * player/constants.ts).
 *
 * Angles in this file are authored in DEGREES for readability and converted to
 * radians once at load. Distances/speeds are SI (metres, seconds).
 */
const deg = (d: number) => (d * Math.PI) / 180;

/** A single spray-pattern step: view-angle punch applied before the shot's trace. */
export interface RecoilStep {
  yaw: number; // rad, +right
  pitch: number; // rad, +up
}

export interface WeaponDef {
  name: string;
  fireInterval: number; // s between shots (rate of fire)
  damage: number; // base, at point blank, chest (×1)
  armorPen: number; // 0..1 fraction of damage that carries through armour
  falloffCoef: number; // damage × pow(coef, dist_m / 5) — doc §6
  baseSpread: number; // rad, random spread-disc radius when standing still + crouched
  mag: number;
  reloadTime: number; // s
  speedMult: number; // movement-speed multiplier while equipped (1.0 = full 6.35 m/s)
  recoil: {
    pattern: RecoilStep[]; // deterministic per-shot view punch; index advances per shot
    resetTime: number; // s of no-fire before sprayIndex resets to 0
    recoverTime: number; // s over which accumulated punch decays back to 0
  };
}

// AK-shape pattern (doc §3): up hard 1–7, left 8–12, right 13–20, loose scatter 21–30.
// Authored as [yaw°, pitch°], converted below.
const AK_PATTERN_DEG: [number, number][] = [
  [0.0, 1.2], [0.1, 1.6], [-0.1, 1.9], [0.2, 2.1], [-0.2, 2.2],
  [0.1, 2.2], [0.0, 2.1], // 1–7: climb
  [-0.6, 1.6], [-1.1, 1.2], [-1.5, 0.9], [-1.7, 0.7], [-1.6, 0.5], // 8–12: pull left
  [-1.0, 0.5], [0.2, 0.6], [1.2, 0.7], [1.9, 0.6], [2.3, 0.5],
  [2.2, 0.4], [1.7, 0.4], [1.1, 0.3], // 13–20: swing right
  [-0.8, 0.5], [0.9, 0.3], [-1.3, 0.4], [1.5, 0.2], [-0.6, 0.4],
  [1.1, 0.2], [-1.4, 0.3], [0.7, 0.3], [-0.9, 0.2], [1.2, 0.3], // 21–30: scatter
];

// USP: gentle, near-vertical, short — tapping is the intended mode.
const USP_PATTERN_DEG: [number, number][] = [
  [0.0, 0.6], [0.1, 0.9], [-0.1, 1.1], [0.2, 1.2], [-0.2, 1.2],
  [0.1, 1.1], [-0.1, 1.0], [0.2, 0.9], [-0.2, 0.9], [0.1, 0.8],
  [-0.1, 0.8], [0.0, 0.7],
];

const toPattern = (p: [number, number][]): RecoilStep[] =>
  p.map(([y, pi]) => ({ yaw: deg(y), pitch: deg(pi) }));

export const WEAPONS = {
  rifle: {
    name: 'AK-analogue',
    fireInterval: 0.1, // 600 rpm
    damage: 36,
    armorPen: 0.775,
    falloffCoef: 0.98, // doc §6
    baseSpread: deg(0.3),
    mag: 30,
    reloadTime: 2.5,
    speedMult: 0.884, // 221/250, CS ratio
    recoil: {
      pattern: toPattern(AK_PATTERN_DEG),
      resetTime: 1.0, // doc §3
      recoverTime: 0.35, // doc §3
    },
  },
  pistol: {
    name: 'USP-analogue',
    fireInterval: 0.15, // ~400 rpm semi cap
    damage: 35,
    armorPen: 0.5,
    falloffCoef: 0.75, // doc §6
    baseSpread: deg(0.5),
    mag: 12,
    reloadTime: 2.2,
    speedMult: 1.0, // full speed, 250 u/s
    recoil: {
      pattern: toPattern(USP_PATTERN_DEG),
      resetTime: 0.4,
      recoverTime: 0.3,
    },
  },
} as const satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;
