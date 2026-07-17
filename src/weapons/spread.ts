/**
 * Accuracy model — doc/weapon-feel.md §4. Pure. Returns the radius (rad) of the
 * random spread disc applied on top of the deterministic recoil, which is also
 * exactly what drives the crosshair gap (§5).
 *
 * inaccuracy = baseSpread × stanceMult × sprayGrowth(sprayIndex), capped.
 */
import type { WeaponDef } from './defs';

export type Stance = 'crouchStill' | 'still' | 'walking' | 'running' | 'air';

// doc §4. Air is load-bearing: jumping should be near-useless for shooting.
export const STANCE_MULT: Record<Stance, number> = {
  crouchStill: 1,
  still: 1.3,
  walking: 2,
  running: 5,
  air: 20,
};

// ponytail: linear growth per shot; the doc says "grows with sprayIndex" but gives
// no curve. Bump/curve this once spray decals are on a wall to look at.
const SPRAY_GROWTH_PER_SHOT = 0.15;

// Hard cap so air + late-spray can't stack into a comically huge disc (doc §4:
// "Cap air inaccuracy hard").
const MAX_SPREAD = 0.2; // rad (~11.5°)

/** @param sprayIndex current shot index (-1 or 0 = first shot, no growth yet). */
export function computeSpread(weapon: WeaponDef, stance: Stance, sprayIndex: number): number {
  const shots = Math.max(0, sprayIndex);
  const raw = weapon.baseSpread * STANCE_MULT[stance] * (1 + shots * SPRAY_GROWTH_PER_SHOT);
  return Math.min(raw, MAX_SPREAD);
}
