import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CT_SPAWN, T_SPAWN } from '../game/map_douglas';
import { findPath, navFromBytes } from './nav';

// T1: the baked navmesh must actually span the map. If the bake produced a
// mesh full of holes (wrong walkable* units, no walkable surface), pathing
// spawn-to-spawn fails — the classic recast misconfiguration. Bake first:
// `pnpm nav:bake`.
const bytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../assets/maps/de_douglas.navmesh.bin', import.meta.url))),
);

describe('nav: baked de_douglas navmesh', () => {
  it('paths from T spawn to CT spawn', async () => {
    const nav = await navFromBytes(bytes);
    const from = new Vector3(T_SPAWN[0], T_SPAWN[1], T_SPAWN[2]);
    const to = new Vector3(CT_SPAWN[0], CT_SPAWN[1], CT_SPAWN[2]);

    const path = findPath(nav, from, to);

    expect(path.length).toBeGreaterThan(1); // a real corridor, not a single point
    const first = path[0];
    const last = path[path.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (!first || !last) return;
    // Endpoints land near the requested spawns (snapped onto the mesh, so allow
    // a small offset for floor height / navmesh edge).
    expect(first.distanceTo(from)).toBeLessThan(2);
    expect(last.distanceTo(to)).toBeLessThan(2);
    // The corridor actually crosses the map (spawns are far apart on Z).
    expect(Math.abs(last.z - first.z)).toBeGreaterThan(Math.abs(to.z - from.z) * 0.7);
  });
});
