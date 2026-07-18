/**
 * Offline recast bake: de_greybox collision triangles -> navmesh.bin.
 *
 * Run: `pnpm nav:bake`. Bake OFFLINE, ship the binary, query with Detour at
 * runtime (docs/navmesh-pipeline.md) — never bake at load time.
 *
 * The doc's example collects `UCX_` collision meshes out of the glb, but this
 * map's collision is authored as cuboid data (src/game/map_greybox.ts), not a
 * collision mesh in the glb. So we bake the SAME triangles the player collides
 * with (collisionTriangles()) — nav and physics can't diverge.
 *
 * Recast's walkable* params are in VOXEL CELLS, not metres — the single most
 * common recast mistake (see the doc). Divide the metre constants by cs/ch.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { init } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { collisionTriangles } from '../../src/game/map_greybox';
import { PLAYER_RADIUS, STANDING_HEIGHT, STEP_HEIGHT } from '../../src/player/constants';

const CS = 0.15; // cell size, m (~ agentRadius / 2.7)
const CH = 0.1; // cell height, m (~ cs * 0.66)

async function main(): Promise<void> {
  await init();

  const { positions, indices } = collisionTriangles();

  const { success, navMesh } = generateSoloNavMesh(
    Float32Array.from(positions),
    Uint32Array.from(indices),
    {
      cs: CS,
      ch: CH,
      walkableRadius: Math.ceil(PLAYER_RADIUS / CS), // cells
      walkableHeight: Math.ceil(STANDING_HEIGHT / CH), // cells
      walkableClimb: Math.floor(STEP_HEIGHT / CH), // cells
      walkableSlopeAngle: 45.57, // acos(0.7) — GROUND_NORMAL_THRESHOLD
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxEdgeLen: 12,
      maxSimplificationError: 1.3,
      detailSampleDistance: 6,
      detailSampleMaxError: 1,
    },
  );

  if (!success || !navMesh) throw new Error('navmesh bake failed');

  const { exportNavMesh } = await import('recast-navigation');
  const bin = exportNavMesh(navMesh);
  const out = fileURLToPath(new URL('../../assets/maps/de_greybox.navmesh.bin', import.meta.url));
  writeFileSync(out, bin);
  console.log(`baked ${bin.byteLength} bytes -> ${out}`);
}

main();
