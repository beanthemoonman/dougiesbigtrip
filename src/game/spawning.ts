import { Vector3 } from 'three';
import { CT_SPAWN, T_SPAWN } from './map_douglas';

export type TeamSide = 'T' | 'CT';

/**
 * Generate N spawn positions per team, spread around the team's anchor point
 * from the map data. Deterministic for a given count — same seed, same positions.
 *
 * For the default 3-per-side, produces the exact same 6 positions the game
 * shipped with before MatchConfig was configurable (regression constraint).
 */
export function spawnRing(team: TeamSide, count: number): Vector3[] {
  const anchor = team === 'CT' ? CT_SPAWN : T_SPAWN;
  const y = anchor[1];
  const zSign = team === 'CT' ? 1 : -1;

  // Preset offsets that reproduce the original 3v3 layout at count=3.
  const presetX = [-3, 2, 5];
  const presetZ = [0, 1, -1];

  const positions: Vector3[] = [];
  for (let i = 0; i < count; i++) {
    let xOff: number;
    let zOff: number;
    if (i < presetX.length) {
      xOff = presetX[i]!;
      zOff = presetZ[i]!;
    } else {
      // Extend beyond the presets: keep spreading rightward, zig-zag z.
      xOff = 5 + (i - 2) * 3;
      zOff = (i % 3) - 1;
    }
    positions.push(new Vector3(anchor[0] + xOff, y, anchor[2] + zOff * zSign));
  }
  return positions;
}
