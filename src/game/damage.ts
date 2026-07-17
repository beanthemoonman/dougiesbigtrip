/**
 * Damage model — doc/weapon-feel.md §6. Pure functions, no world state.
 *
 * Final damage = base × range-falloff × hitbox-multiplier, then split across
 * armour and health by the weapon's armour penetration.
 */
import type { WeaponDef } from '../weapons/defs';

export type Hitbox = 'head' | 'chest' | 'stomach' | 'arm' | 'leg';

// doc §6 multipliers.
export const HITBOX_MULT: Record<Hitbox, number> = {
  head: 4,
  chest: 1,
  stomach: 1.25,
  arm: 1,
  leg: 0.75,
};

export interface DamageResult {
  health: number; // HP to subtract
  armor: number; // armour points to subtract
}

/** doc §6: damage × pow(falloffCoef, dist_m / 5). */
export function rangeFalloff(weapon: WeaponDef, distanceM: number): number {
  return Math.pow(weapon.falloffCoef, distanceM / 5);
}

/**
 * @param targetArmor current armour points of the victim (0 if none)
 *
 * Armour model (simplified CS): while the victim has armour, `armorPen` of the
 * incoming damage bleeds through to health and the rest is absorbed by armour,
 * point-for-point. When armour runs out mid-hit, the unabsorbed remainder falls
 * through to health at full value.
 */
export function computeDamage(
  weapon: WeaponDef,
  distanceM: number,
  hitbox: Hitbox,
  targetArmor: number,
): DamageResult {
  const incoming = weapon.damage * rangeFalloff(weapon, distanceM) * HITBOX_MULT[hitbox];

  if (targetArmor <= 0) return { health: incoming, armor: 0 };

  const throughArmor = incoming * weapon.armorPen; // straight to health
  const wantAbsorb = incoming - throughArmor; // armour tries to eat this
  const absorbed = Math.min(wantAbsorb, targetArmor);
  const overflow = wantAbsorb - absorbed; // armour ran out → falls to health

  return { health: throughArmor + overflow, armor: absorbed };
}
