# Navmesh Pipeline

For `tools/navbake/` and `src/ai/nav.ts`. Uses `recast-navigation-js` (WASM port of Mikko
Mononen's Recast & Detour — the same library behind Unity's and Unreal's navigation).

---

## The two-library split (this confuses everyone once)

- **Recast** = the *builder*. Takes raw triangles, voxelises them, works out what's walkable,
  and produces a navmesh. Slow. Offline.
- **Detour** = the *runtime*. Takes a finished navmesh, answers `findPath`, `raycast`,
  `findNearestPoly`. Fast. In-game.

**Bake with Recast offline, ship the binary, query with Detour at runtime.** Do not bake at
load time. On a real map it's seconds of frozen main thread, it's identical every time, and
it's the sort of thing that works fine on your desktop and times out on someone's laptop.

---

## Agent parameters — derive them, don't guess

These **must** match the movement constants in `docs/source-movement.md`, or bots will path
through gaps they can't fit and up steps they can't climb.

| Recast param | Value | Derived from |
|---|---|---|
| `cs` (cell size) | `0.15` | ≈ agentRadius / 2.7. Smaller = more accurate, much slower bake, bigger mesh. |
| `ch` (cell height) | `0.10` | ≈ cs × 0.66 |
| `walkableRadius` | `0.4064 m` | Player capsule radius |
| `walkableHeight` | `1.8288 m` | Player standing hull height |
| `walkableClimb` | `0.4572 m` | Step height. **Not** jump height — bots walk, they don't bhop. |
| `walkableSlopeAngle` | `45.57°` | `acos(0.7)` — the ground normal threshold |
| `minRegionArea` | `8` | Discards specks |
| `mergeRegionArea` | `20` | |
| `maxEdgeLen` | `12` | in cells |
| `maxSimplificationError` | `1.3` | |
| `detailSampleDist` | `6` | |
| `detailSampleMaxError` | `1` | |

Import them from `src/player/constants.ts` in the bake script rather than retyping. A silently
diverged copy is a fun three-hour bug.

---

## Bake script

`tools/navbake/bake.ts`:

```ts
import { init, generateSoloNavMesh } from 'recast-navigation';
import { NodeIO } from '@gltf-transform/core';
import { writeFileSync } from 'node:fs';
import { PLAYER } from '../../src/player/constants';

await init();

// 1. Load the map .glb and collect the triangles bots should walk on.
//    Use ONLY the UCX_ collision meshes — never the render mesh.
//    The render mesh has 80k tris of decorative detail that will produce a
//    slow bake and a navmesh full of holes around trim and bevels.
const doc = await new NodeIO().read('assets/maps/mymap.glb');
const { positions, indices } = collectCollisionTris(doc, /^UCX_/);

// 2. Bake
const { success, navMesh } = generateSoloNavMesh(positions, indices, {
  cs: 0.15,
  ch: 0.10,
  walkableRadius:     Math.ceil(PLAYER.RADIUS      / 0.15),  // in CELLS
  walkableHeight:     Math.ceil(PLAYER.HEIGHT      / 0.10),  // in CELLS
  walkableClimb:      Math.floor(PLAYER.STEP_HEIGHT / 0.10), // in CELLS
  walkableSlopeAngle: 45.57,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxEdgeLen: 12,
  maxSimplificationError: 1.3,
  detailSampleDist: 6,
  detailSampleMaxError: 1,
});

if (!success) throw new Error('navmesh bake failed');

// 3. Ship the binary
writeFileSync('assets/maps/mymap.navmesh.bin', Buffer.from(navMesh.getNavMeshData()));
```

**Gotcha:** `walkableRadius`/`walkableHeight`/`walkableClimb` are in **voxel cells**, not
metres. Passing metres gives you a navmesh built for a 0.4-cell-wide agent — i.e. 6 cm — which
happily paths through doorframes the bots then get stuck in. Divide by `cs`/`ch`. This is the
single most common recast mistake.

---

## Runtime

```ts
import { init, importNavMesh, NavMeshQuery } from 'recast-navigation';

await init();
const bytes = new Uint8Array(await (await fetch('/assets/maps/mymap.navmesh.bin')).arrayBuffer());
const { navMesh } = importNavMesh(bytes);
const query = new NavMeshQuery(navMesh);

const { path } = query.computePath(from, to);
```

Rules:

- **`findNearestPoly` before pathing.** A bot standing 3 cm off the navmesh gets no path and
  stands there looking broken. Snap the start and end onto the mesh first, always.
- **Cache paths.** Repath on: reaching a waypoint, target moving > 2 m, or blocked. Not every
  tick.
- **Budget repaths.** Cap at ~2 per frame across all bots, round-robin. A path query on a real
  map is ~0.1–1 ms; 8 bots × every tick will show up in your frame time.
- **Path smoothing.** Raw Detour paths are polygon-corridor waypoints and following them
  literally produces a bot that walks along invisible triangle edges — very recognisable, very
  bad. Use string-pulling (`computePath` gives you smoothed points) plus a per-tick
  `query.raycast()` from the bot to waypoint N+2: if it's clear, skip N+1. Cheap, huge
  improvement.

---

## Bots use the player's movement code

Non-negotiable, and easy to get wrong:

```ts
// GOOD — bot synthesises input, the shared movement code does the rest
bot.wishdir = directionToNextWaypoint(bot);
bot.buttons = { jump: shouldJump(bot), duck: shouldDuck(bot) };
movePlayer(bot, dt);        // the same function the human player uses

// BAD — bot position driven directly
bot.position.lerp(waypoint, dt * speed);
```

The "bad" version means bots accelerate instantly, don't obey friction, don't collide the same
way, and don't feel like they inhabit the same world. Players notice within thirty seconds even
if they can't articulate it. It also means you're maintaining two movement systems, and the
second one will diverge.

---

## Off-mesh connections

Recast won't discover jumps or drops. If a route requires jumping a crate or dropping off a
ledge, add an explicit off-mesh connection:

```ts
{ start, end, radius: 0.4064, bidirectional: false, area: AREA_JUMP, flags: FLAG_JUMP }
```

Author these in Blender as empties named `NAV_JUMP_<n>_A` / `NAV_JUMP_<n>_B`, export in the
`.glb`, and have the bake script pair them up by index. Hand-editing coordinates in a JSON file
is a maintenance sinkhole.

---

## Debug view

Build it in Phase 4, not later. `?debug=nav` renders the navmesh as translucent wireframe plus
the active path of each bot as a line. Ten minutes of work; without it you're debugging bot
pathing by watching a bot bump into a wall and guessing.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Bots path through walls | Baked from render mesh, or collision meshes not exported, or agent radius passed in metres instead of cells |
| Bots won't path anywhere | Start/end not snapped with `findNearestPoly`; or navmesh has no polys (check the debug view) |
| Bots stutter at doorways | `cs` too coarse relative to the gap, or agent radius too large. Try `cs = 0.1`. |
| Bots walk in a zigzag | No string-pulling / raycast smoothing — they're following raw poly-corridor waypoints |
| Bake takes minutes | `cs` too small, or you baked the render mesh. `cs = 0.15` on a small map should take seconds. |
| Navmesh has holes under crates | Expected and correct — crates are obstacles. If the holes are on the *floor*, your slope angle or climb is wrong. |
| Bots get stuck on stairs | `walkableClimb` in metres instead of cells, or your stair risers exceed 0.4572 m (see `docs/blender-pipeline.md` §3) |
