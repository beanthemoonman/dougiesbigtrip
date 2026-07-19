/**
 * Offline recast bake: de_douglas collision triangles -> navmesh.bin.
 *
 * Run: `pnpm nav:bake`. Bake OFFLINE, ship the binary, query with Detour at
 * runtime (docs/navmesh-pipeline.md) — never bake at load time.
 *
 * The doc's example collects `UCX_` collision meshes out of the glb, but this
 * map's collision is authored as cuboid data (src/game/map_douglas.ts), not a
 * collision mesh in the glb. So we bake the SAME triangles the player collides
 * with (collisionTriangles()) — nav and physics can't diverge.
 *
 * Recast's walkable* params are in VOXEL CELLS, not metres — the single most
 * common recast mistake (see the doc). Divide the metre constants by cs/ch.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getNavMeshPositionsAndIndices, init } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { collisionTriangles } from '../../src/game/map_douglas';
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

  // (1) Detour blob — the JS runtime (src/ai/nav.ts) imports this today. Format is
  // recast-navigation's own NavMeshSet+Detour serialization: standard, but its byte
  // layout is coupled to Detour's compile-time config (polyref width, wasm pointer
  // sizes), so a Rust Detour crate won't read it without matching that config.
  // Retires in Phase 6 when the WASM sim owns nav (docs/netcode.md).
  const { exportNavMesh } = await import('recast-navigation');
  const bin = exportNavMesh(navMesh);
  const detourOut = fileURLToPath(new URL('../../assets/maps/de_douglas.navmesh.bin', import.meta.url));
  writeFileSync(detourOut, bin);
  console.log(`baked ${bin.byteLength} bytes (detour) -> ${detourOut}`);

  // (2) Portable walkable-triangle soup — the Rust-readable artifact. No ABI
  // coupling: just Y-up metre floats + u32 indices. The Rust AI (Phase 6) reads
  // these directly and builds its own point-in-tri + shared-edge A*, or feeds them
  // to a Rust recast bake at server startup. Format documented in docs/navmesh-pipeline.md.
  const [posArr, idxArr] = getNavMeshPositionsAndIndices(navMesh);
  const verts = Float32Array.from(posArr);
  const triIndices = Uint32Array.from(idxArr);
  const vertCount = verts.length / 3;
  const triCount = triIndices.length / 3;

  const header = new Uint32Array([0x544d564e, 1, vertCount, triCount]); // "NVMT", version 1
  const portable = Buffer.concat([
    Buffer.from(header.buffer),
    Buffer.from(verts.buffer),
    Buffer.from(triIndices.buffer),
  ]);

  // Read-back self-check: re-parse our own bytes and assert the geometry survives.
  const dv = new DataView(portable.buffer, portable.byteOffset, portable.byteLength);
  if (dv.getUint32(0, true) !== 0x544d564e) throw new Error('portable: bad magic');
  const rbVerts = dv.getUint32(8, true);
  const rbTris = dv.getUint32(12, true);
  const expected = 16 + rbVerts * 12 + rbTris * 12;
  if (rbVerts !== vertCount || rbTris !== triCount || portable.byteLength !== expected) {
    throw new Error('portable: round-trip size mismatch');
  }

  const portableOut = fileURLToPath(new URL('../../assets/maps/de_douglas.navmesh.tris.bin', import.meta.url));
  writeFileSync(portableOut, portable);
  console.log(`baked ${portable.byteLength} bytes (portable: ${vertCount} verts, ${triCount} tris) -> ${portableOut}`);
}

main();
