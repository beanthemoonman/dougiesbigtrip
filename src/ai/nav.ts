/**
 * Detour runtime navigation. Loads the offline-baked navmesh blob
 * (tools/navbake/bake.ts) and answers path queries. Do NOT bake here — that's a
 * seconds-long frozen main thread on a real map (docs/navmesh-pipeline.md).
 */
import { init, importNavMesh, NavMeshQuery, type NavMesh } from 'recast-navigation';
import { Vector3 } from 'three';

export interface Nav {
  readonly navMesh: NavMesh;
  readonly query: NavMeshQuery;
}

/** Fetch + import the navmesh blob. Browser path — pass a URL. */
export async function loadNav(url: string): Promise<Nav> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return navFromBytes(bytes);
}

/** Import a navmesh from raw bytes (Node tests read the file; browser fetches). */
export async function navFromBytes(bytes: Uint8Array): Promise<Nav> {
  await init();
  const { navMesh } = importNavMesh(bytes);
  return { navMesh, query: new NavMeshQuery(navMesh) };
}

const HALF_EXTENTS = { x: 2, y: 4, z: 2 }; // search box for snapping onto the mesh

/**
 * Smoothed waypoints from `from` to `to`, snapped onto the navmesh first (a bot
 * standing a few cm off the mesh otherwise gets no path — docs/navmesh-pipeline.md).
 * Empty array = no path.
 */
export function findPath(nav: Nav, from: Vector3, to: Vector3): Vector3[] {
  const start = nav.query.findClosestPoint(from, { halfExtents: HALF_EXTENTS });
  const end = nav.query.findClosestPoint(to, { halfExtents: HALF_EXTENTS });
  if (!start.success || !end.success) return [];
  const { success, path } = nav.query.computePath(start.point, end.point);
  if (!success) return [];
  return path.map((p) => new Vector3(p.x, p.y, p.z));
}
