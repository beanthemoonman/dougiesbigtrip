# AGENTS.md — assets/

Supplements the root [`AGENTS.md`](../AGENTS.md) (no Valve assets, lightmaps not lights, budgets) — read that first.

## What this is

Every shipped binary/data asset. All current content is original (procedural Blender scripts)
or CC0 Poly Haven textures. The client imports files directly via Vite (`?url` / `?raw` / JSON
import); the Rust crates `include_bytes!`/`include_str!` some of them at compile time.

## Layout

| Path | What | Produced by | Consumed by |
|---|---|---|---|
| `CREDITS.md` | One row per asset: `File \| Source \| Author \| Licence \| URL \| Added` | hand | humans |
| `characters/{ct,t}_player.glb` | Rigged world-models, Mixamo-named bones, clips `idle`/`walk`/`death` | `tools/blender/build_characters.py` | `src/game/characters.ts` |
| `weapons/{ak,pistol}_viewmodel.glb` | Viewmodels (also reused as third-person world guns) | `tools/blender/build_weapons.py` (+ `tools/blender/curves/*.curve.json`) | `src/game/session.ts`, `src/game/characters.ts` |
| `props/*.glb` | Static props with embedded JPEG/PNG textures | modeled in Blender | `src/game/props.ts` |
| `tex/*_diff.jpg` | Tiling surface albedo (concrete/sandstone/wood) | Poly Haven | `src/render/surfacetex.ts` |
| `maps/de_douglas.json` | Map layout, **single source of truth** for colliders, nav tris and render mesh | `node tools/maps/build_douglas.mjs` — **edit that, not the JSON** | `src/game/map_douglas.ts`, `tools/blender/build_map.py` |
| `maps/de_douglas.glb` | Render geometry with `UVMap` + `UVMap_Lightmap` (uv1) | `tools/blender/build_map.py` | `src/render/lightmap.ts` via `session.ts` |
| `maps/de_douglas/lightmap.ktx2` | Baked diffuse lighting, UASTC, linear | `build_map.py` → `lightmap.exr` → `pnpm assets:lightmap` | `src/render/lightmap.ts` |
| `maps/de_douglas.navmesh.tris.bin` | Portable walkable-tri soup (`NVMT` magic, v1, verts f32, indices u32) | `pnpm nav:bake` | `sim/src/nav.rs` via `include_bytes!` |
| `maps/de_douglas.navmesh.bin` | Detour blob (recast-navigation serialization) | `pnpm nav:bake` | nothing in `src/` any more — legacy output |
| `maps/de_douglas.navnodes.json` | Hand-authored bot waypoint graph | hand | `src/ai/navnodes.ts`, `session.ts`, `server/src/main.rs` (`include_str!`) |

## Commands / local repro

```bash
node tools/maps/build_douglas.mjs     # regenerate de_douglas.json from the parametric layout
pnpm nav:bake                         # tools/navbake/bake.ts -> both navmesh .bin files
pnpm assets:lightmap                  # lightmap.exr -> lightmap_ldr.png -> lightmap.ktx2 (needs oiiotool + toktx on PATH)
blender -b -P tools/blender/build_weapons.py
pnpm modelview assets/characters/ct_player.glb   # render a glb to PNG for inspection
```

`build_map.py` runs inside Blender (`exec(...); build_all()`) and hardcodes
`REPO = "/home/upmoon/Development/dougysbigtrip"` — fix the path locally before running.

## Invariants & gotchas

- **Add the `CREDITS.md` row in the same change as the asset.** Embedded third-party textures get
  their own row (see the Poly Haven rows "embedded in crate_wood.glb"). Code-embedded assets
  (e.g. inline SVG in `src/`) and `public/` files are credited here too.
- Nav is baked from `collisionTriangles()` in `src/game/map_douglas.ts`, **not** from the glb. Any
  layout change → rerun `build_douglas.mjs`, `nav:bake`, and the Blender map + lightmap bake, or
  physics, nav and visuals diverge. Changing `navmesh.tris.bin` changes the compiled `sim.wasm`
  and server — rebuild per the root WASM ritual.
- Changing `navnodes.json` affects both client and server (server embeds it at compile time).
- Lightmap texture must stay `channel = 1`, `NoColorSpace`, `flipY = false` (`src/render/lightmap.ts`).
  KTX2 transcoder is served from `public/basis/`.
- `lightmap.exr` and `lightmap_ldr.png` are gitignored intermediates; only `.ktx2` is committed.
- **Docs vs reality:** `docs/asset-pipeline.md` describes `pnpm assets:opt` / `tools/optimize/`
  (meshopt + KTX2). Neither exists in `package.json`/`tools/`, and every
  committed `.glb` has empty `extensionsUsed` (no meshopt, no KTX2 textures). The client's
  `GLTFLoader`s have no Meshopt decoder or KTX2 loader attached — wire those up before shipping
  a compressed glb.
- No audio files: all sound is synthesised in `src/core/audio.ts`, so there is no `audio/` dir.

## Related docs

`docs/licensing-and-assets.md` (licence tiers, CREDITS format) · `docs/asset-pipeline.md` ·
`docs/blender-pipeline.md` (§10 lightmaps) · `docs/art-direction.md` · `docs/navmesh-pipeline.md`
(NVMT format) · `tools/navbake/bake.ts`
