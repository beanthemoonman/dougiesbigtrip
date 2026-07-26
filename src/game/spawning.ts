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
      // Beyond 3: repeat the preset row, stepped 1.5 m inward (toward mid) and
      // 2.5 m toward the spine wall per row. The spawn pocket is small and
      // fenced on every side — |z| 22.2 (spawn wall) to 28.3, x -21.8 (spine
      // wall) to -10 — so rows step in small increments, and sideways along the
      // spine wall rather than into the traffic cone at x=-18, |z|=23 (props.ts).
      const row = Math.floor(i / presetX.length);
      xOff = presetX[i % presetX.length]! - 2.5 * row;
      zOff = presetZ[i % presetZ.length]! - 1.5 * row;
    }
    positions.push(new Vector3(anchor[0] + xOff, y, anchor[2] + zOff * zSign));
  }
  return positions;
}
