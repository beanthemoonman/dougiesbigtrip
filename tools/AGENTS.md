# AGENTS.md — tools/

Supplements the root [`AGENTS.md`](../AGENTS.md). Read that first (asset/licensing rules, units,
Y-up, lightmaps-not-lights); this file covers only the offline tooling in `tools/`.

## What this is

Offline generators and dev utilities. Nothing here ships to the client. Outputs are committed
artifacts under `assets/` (or pasted constants in `src/`), so after running a tool, commit what
it produced and run `pnpm test`.

## Layout

| Path | What it does | Input → Output |
|---|---|---|
| `maps/build_douglas.mjs` | Parametric de_douglas greybox layout (D-shape, mirrored across z=0). | constants in the script → `assets/maps/de_douglas.json` (rewritten in place) |
| `blender/build_map.py` | Builds map geometry + bakes the lightmap in Blender. | `de_douglas.json` → `assets/maps/de_douglas.glb`, `assets/maps/de_douglas/lightmap.exr` |
| `blender/build_weapons.py` | Procedural viewmodel weapons. | `blender/curves/*.curve.json` → `assets/weapons/*.glb` |
| `blender/build_characters.py` | T/CT world-models, 23-bone Mixamo-named rig, idle/walk/death clips. | → `assets/characters/*.glb` |
| `blender/curves/` | `ak_grip`, `ak_mag` outline curves consumed by `build_weapons.py`. | — |
| `refextract/outline.py` | Traces a part silhouette from a flat-background side photo into a normalized curve. Python + numpy + Pillow. | image + `--bbox` → `*.curve.json` |
| `navbake/bake.ts` | Offline recast bake of the same triangles the player collides with (`collisionTriangles()`). | `src/game/map_douglas.ts` → `assets/maps/de_douglas.navmesh.bin` (Detour) + `de_douglas.navmesh.tris.bin` (portable "NVMT" v1 soup) |
| `modelview/view.ts` | Headless puppeteer render of a `.glb` from fixed angles to PNG. Optional weapon attach + third-person hold pose. | `.glb` → `.modelview/*.png` (gitignored) |
| `modelview/solvepose.ts` | IK solver for the third-person weapon hold; prints constants to paste into `src/ai/thirdperson.ts`. | — |
| `modelview/view.test.ts` | "Not blank" render check of `assets/props/crate_wood.glb` — runs in `pnpm test`. | — |
| `build_wasm.sh` | `wasm-pack build sim --target bundler --features wasm` → `sim/pkg/`. | — |

## Commands

```bash
node tools/maps/build_douglas.mjs                 # regenerate de_douglas.json
pnpm nav:bake                                     # tsx tools/navbake/bake.ts
pnpm modelview <file.glb> [--angles iso,hero] [--size 1024] [--out dir] [--bg 808080] \
               [--weapon <glb>] [--pose rifle|pistol] [--solve]
npx tsx tools/modelview/solvepose.ts              # print hold-pose constants
blender -b -P tools/blender/build_weapons.py      # also build_characters.py
python3 tools/refextract/outline.py <img> --bbox x0 y0 x1 y1 --axis vertical --samples 24 --out <json>
pnpm assets:lightmap                              # lightmap.exr -> lightmap.ktx2 (needs oiiotool + toktx)
```

## Invariants & gotchas

- **Edit `build_douglas.mjs`, never `de_douglas.json` by hand.** `src/game/map_douglas.test.ts`
  asserts the z-mirror symmetry. A layout change cascades: JSON → `build_map.py` (glb + lightmap)
  → `pnpm assets:lightmap` → `pnpm nav:bake` → rebuild sim WASM + server.
- `de_douglas.navmesh.tris.bin` is `include_bytes!`'d by `sim/src/nav.rs`, so a re-bake only takes
  effect after rebuilding `sim/pkg` (root AGENTS.md ritual) and the Rust server. The Detour
  `.navmesh.bin` currently has no runtime consumer (the bake.ts comment still names the deleted
  `src/ai/nav.ts`).
- `de_douglas.navnodes.json` (search-goal graph read by server + sim) is **hand-authored**; no tool
  here generates it.
- Recast `walkable*` params are in voxel cells, not metres — divide by `CS`/`CH` (see bake.ts).
- `build_map.py` hard-codes `REPO = "/home/upmoon/Development/dougysbigtrip"` and has no
  `__main__`; run it inside Blender via `exec(...)` then `build_all()`, fixing `REPO` for your
  machine. The other Blender scripts resolve paths relative to the script.
- Build in three.js space and convert to Blender Z-up per vertex; never hand-rotate exports.
  Don't drive Base Color through a node graph — the glTF exporter drops it (see `mat()` comment).
- `build_wasm.sh` uses a `zsh` shebang; on Windows run the `wasm-pack` line directly.
- `modelview --help` text says `pnpm view`; the real script is `pnpm modelview`.
- `refextract` examples reference `assets/reference/`, which isn't in the repo — reference photos
  are local inputs, never committed assets.
- `docs/asset-pipeline.md` mentions `pnpm assets:opt` and `tools/optimize/`; neither exists yet.
  Use the raw `gltf-transform` commands in that doc directly.
- Any new asset a tool produces needs an `assets/CREDITS.md` row in the same change.

## Related docs

- `docs/blender-pipeline.md`, `docs/asset-pipeline.md`, `docs/navmesh-pipeline.md`
- `docs/plan-modelview-cli.md` — modelview design; `docs/art-direction.md` — palette used by maps
