/**
 * Placeholder hitbox regions for the capsule-body bots (no rig yet — Phase 5).
 * Maps a bullet's impact height above the target's feet onto a damage zone
 * (damage.ts HITBOX_MULT). Bands are fractions of the 1.8288 m standing hull;
 * a real rig replaces this with per-bone boxes.
 *
 * ponytail: height bands, not bones. Upgrade to rig hitboxes when characters
 * get skeletons; the multipliers in damage.ts stay the same.
 */
import { STANDING_HEIGHT } from '../player/constants';
import type { Hitbox } from './damage';

/** Zone of a hit `hitY` metres in world space, given the target's `feetY`. */
export function hitboxAt(feetY: number, hitY: number): Hitbox {
  const frac = (hitY - feetY) / STANDING_HEIGHT; // 0 = feet, 1 = crown
  if (frac >= 0.88) return 'head';
  if (frac >= 0.66) return 'chest';
  if (frac >= 0.45) return 'stomach';
  return 'leg';
}
