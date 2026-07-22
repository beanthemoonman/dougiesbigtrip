# Phase 13 — Asset Refinement II: Textures & Liveliness

The look pass Phase 4.5 deferred. Real CC0 textures on every surface, characters that read as
solid bodies at range, more destructible scenery that respects the round loop, and a map that
feels inhabited. Every asset gets a `CREDITS.md` row at add-time; budgets hold (< 400 draw
calls, < 60 MB total).

## What already exists (reuse, don't rebuild)

| Thing | Where | Note |
|---|---|---|
| Map build pipeline | `tools/blender/build_map.py` | Procedural box geometry, 3 materials (M_Concrete/M_Sandstone/M_Wood), UV0+UV1, lightmap bake |
| Procedural detail textures | `src/render/surfacetex.ts` | CanvasTexture generation at load — to be replaced with real textures |
| Lightmap loader | `src/render/lightmap.ts` | Sets `lm.channel=1, NoColorSpace` on GLTFLoader materials |
| Character build | `tools/blender/build_characters.py` | 23-bone armature, box body parts, flat colors |
| Weapon build | `tools/blender/build_weapons.py` | 5 material types, flat colors |
| Props | `assets/props/*.glb` | Already shipping Poly Haven textures (embedded) |
| Breakables | `src/game/breakables.ts` + `main.ts` | HP tracking, cascade, mesh/collider removal — but no round respawn |
| Round reset | `src/game/round.ts` `resetRound()` | Resets players, bots, scores — does NOT restore breakables |
| VFX | `src/render/vfx.ts` | Impact puffs, muzzle flash, tracers |
| Decals | `src/render/decals.ts` | 128-instance ring buffer for bullet holes only |

## Decisions to lock

| Decision | Choice | Why |
|---|---|---|
| **Texture delivery for map** | Load the diffuse JPGs at runtime in `applySurfaceTextures()`, imported via Vite `?url` (content-hashed into dist), keeping the procedural noise as a fallback | *(As built — diverged from the original "embed in `.glb`" plan.)* Runtime load keeps `de_douglas.glb` and its lightmap bake untouched (no Blender re-export), preserves the Phase 4.5 procedural fallback for offline/pre-deploy, and still ships one hashed request per texture. `applySurfaceTextures()` sets `mat.map` on the glb's MeshStandardMaterials by material name; three `assets/tex/*_diff.jpg` are the only new files. |
| **Texture delivery for weapons** | Same as map — embed in `.glb` | Weapons are loaded via GLTFLoader; the viewmodel path already uses the raw material. The world-model path flattens to MeshBasicMaterial — we preserve `map` there so the texture tints by color (unlit, no light contribution). |
| **Character textures** | Flat-color base with subtle procedural detail (noise-based wear/variation) at export time, **not** photographic textures | Photographic faces/cloth on box-built characters read worse than clean flat colors — they highlight the boxiness. A subtle per-material noise overlay baked into the exported material map gives the "solid unit" read without calling out the geometry. |
| **De-floaty — joint geometry** | Add small cylinders/spheres at shoulder, elbow, hip, knee joints in `build_characters.py` | Simple connective geometry bridges the gaps between rigidly-rotated body-part boxes, making the character read as one connected unit. Skinned to the parent bone of the joint so they move with the upper segment. |
| **De-floaty — mesh join** | Keep multi-piece box build; add joint geometry **separately** as child mesh objects | A fully welded single mesh with proper vertex blends is a `ponytail` upgrade of the entire character pipeline. Joint cylinders are the 80/20 fix. |
| **Breakable respawn** | On `resetRound()`, iterate breakables and restore any that are `broken: true` — re-create the mesh + collider from the cached template | The round reset path already exists. Breakables carry their index in `PROP_PLACEMENTS`; restoring is a clone + re-register of the original template data. |
| **Map life — signage** | Planar decal quads (like bullet holes, but larger) with a simple sign material, placed as part of `placeProps()` | A separate InstancedMesh or just a few placed quads. Minimal draw calls, reuses the existing decal placement pattern. |
| **Map life — set-dressing** | Add more `PROP_PLACEMENTS` entries using existing props + one new sign/signage prop | Reuses the existing prop loading/cloning/collider path. No new code. |
| **Colour variation on props** | Tint the existing `MeshBasicMaterial.color` per-placement in `placeProps()` | Prop glbs carry flat color; a `color` override per placement gives variety without new textures or draw calls. |

## Poly Haven texture selections

Per the palette in `docs/art-direction.md` and the suggested sets in `docs/blender-pipeline.md` §4:

| Map Material | Poly Haven Set | ID | Format | Resolution | Rationale |
|---|---|---|---|---|---|
| `M_Concrete` | Concrete Wall 003 | `concrete_wall_003` | JPG | 2K | Worn grey concrete, desaturated, tiles well. The "wall" variant has the right vertical read for CS:S architecture. |
| `M_Sandstone` | Large Sandstone Blocks | `large_sandstone_blocks` | JPG | 2K | Big block masonry, tan/warm. Reads as de_dust perimeter walls. |
| `M_Wood` | Brown Planks 05 | `brown_planks_05` | JPG | 2K | Mid-brown horizontal planks, distinct from the `brown_planks_03` already used on crates/pallets. |

All three are CC0-1.0. Downloaded at 2K (not 4K) per the texel-density constraint — at 128 px/m,
2K covers 16 m of wall. The map's longest single wall segment is ~8 m.

## Per-weapon/character texture approach

| Model | Current | Phase 13 |
|---|---|---|
| AK viewmodel | Flat M_Gunmetal/M_Steel/M_Wood_Grip/M_Bakelite | Embed a subtle scratch/noise detail map on M_Gunmetal + M_Steel (procedural at export time) to break the perfect-flat look; wood-grip gets a grain detail map |
| Pistol viewmodel | Flat M_Polymer/M_Gunmetal/M_Steel | Same metal treatment; M_Polymer gets a subtle matte noise |
| CT player | Flat navy/black/pale colors | Per-material noise detail (low-frequency, low-contrast) to give the flat boxes some surface variation |
| T player | Flat tan/olive/dark colors | Same treatment |

These are generated **at Blender export time** (not runtime) so they ship as part of the `.glb`
with zero runtime cost. They're subtle 128² noise fields, not photographic — they add surface
breakup without calling out the box geometry.

## Increment plan (each ends demoable)

### 13.0 — Map textures from Poly Haven (the big one)

*(As built: runtime load, not glb-embed — see the amended "Texture delivery for map" decision.)*

- Download `concrete_wall_003`, `large_sandstone_blocks`, `brown_planks_05` from Poly Haven via Blender MCP
- Save the diffuse maps to `assets/tex/` as `*_diff.jpg` (2K). No roughness/normal maps — the lightmap carries the lighting; a diffuse `map` on unlit-flattened world materials is all that reads.
- In `src/render/surfacetex.ts`: import the three JPGs via Vite `?url`, load them in `applySurfaceTextures()` with `TextureLoader`, set `mat.map` by material name with `RepeatWrapping` + per-surface repeat for texel density. Fall back to the procedural noise map if a load fails.
- `de_douglas.glb` and the lightmap bake are untouched — same boxes, same UV0/UV1.
- Update `CREDITS.md` with each texture set entry
- **T2:** Draw call count stays < 400 (same 3 map materials, still merged)
- **T2:** Payload budget check — embedded 2K textures are ~2-3 MB each before glTF compression; verify total < 48 MB wire
- **Check (ACC-021 step 1):** Map loads and surfaces read as real materials — sandstone has block lines, concrete has grain/wear, wood has plank detail. Side-by-side screenshot vs. Phase 4.5 build — the difference is immediately visible.

### 13.1 — Weapon textures (viewmodel polish)

- Modify `tools/blender/build_weapons.py`:
  - Generate subtle noise-based detail textures for each material and bake them as Image Textures
  - M_Gunmetal: dark grey base + low-contrast perlin noise (scratchy metal)
  - M_Steel: lighter grey base + subtle anisotropic grain
  - M_Wood_Grip: brown base + vertical grain noise
  - M_Bakelite: reddish-brown + subtle mottling
  - M_Polymer: near-black + subtle matte noise
- Re-export `ak_viewmodel.glb` and `pistol_viewmodel.glb`
- Verify viewmodel renders correctly (the viewmodel path uses MeshStandardMaterial from the glb directly)
- **T2:** Viewmodel still renders in its own pass, FOV correct, no edge distortion
- **Check (ACC-021 step 2):** Viewmodel gun reads as a real object, not a flat-shaded toy. Metal has subtle surface breakup.

### 13.2 — De-floaty characters

- Modify `tools/blender/build_characters.py`:
  - After building all body-part boxes and before skinning, add joint geometry:
    - **Shoulders:** cylinder bridging upper-arm top to shoulder point (radius ~0.06 m)
    - **Elbows:** sphere at elbow pivot (radius ~0.05 m)
    - **Hips:** cylinder bridging thigh top to hip socket
    - **Knees:** sphere at knee pivot (radius ~0.05 m)
  - Skin each joint piece to the **parent** bone (e.g., elbow sphere → upper arm bone)
  - Apply the same team material colors
- Re-export `ct_player.glb` and `t_player.glb`
- Then apply per-material noise detail (from 13.1 approach) to break flat colors
- **T2:** Triangle count remains under the 8K budget per character
- **Check (ACC-021 step 3):** Bot walks — no visible gaps at the elbows/knees/shoulders. The character reads as one connected unit at 10 m range.

### 13.3 — More breakables + round-scoped respawn

- Add 6–10 more breakable prop placements (additional crates/barrels at chokepoints)
- Add a few **non-breakable** set-dressing props (cones, pallets, jerry cans in new spots)
- Implement `restoreBreakables()` in `src/game/breakables.ts`:
  - For each breakable marked `broken: true`, re-create mesh + collider from the cached prop template
  - Call it from `resetRound()` in `main.ts`
  - Cascade-aware: restore a stack bottom-up so `restsOn` links remain valid
- **T0:** Unit test `restoreBreakables` — mark items broken, restore, assert all `broken: false` and meshes/colliders re-registered
- **Check (ACC-021 step 4):** Destroy a crate stack mid-round; end the round; next round the crates are back. Destroy only the top crate; it stays gone but doesn't float (cascade handled in Phase 4.5).

### 13.4 — Map life: set-dressing & signage

- Create a simple sign/signage prop: a flat quad with text/icon baked to a texture (128²), using a CC0 font
- Add 4–6 sign placements in the map (spawn-area labels, direction markers)
- Add more traffic cones, pallets, jerry cans in sensible spots (spawn areas, chokepoints) — non-breakable scenery
- Add colour variation to existing props: tint `MeshBasicMaterial.color` per placement for broken-up visual
- Add 2–3 wall decals (posters, stains) as InstancedMesh quads placed on walls at load time — reuse the existing bullet-hole placing pattern but with a different texture
- **T2:** Total draw calls still < 400 (new signage/decals are InstancedMesh quads = 1 draw call each pool, signage quads are 1 extra mesh)
- **Check (ACC-021 step 5):** Map feels inhabited — spawn areas have direction signs, chokepoints have varied cover props, walls have a few posters/stains.

## Exit test (ACC-021)

Side-by-side against the Phase 4.5 build:

1. **Map surfaces** read as real materials (sandstone block lines, concrete grain, wood plank gaps)
2. **Weapon viewmodel** reads as a real gun, not a flat-shaded toy
3. **Bot characters** have no visible gaps at joints — they read as connected solid bodies at 10 m
4. **Breakables respawn** after round reset — broken crates/barrels are back
5. **Map life** — signage visible at spawns, props have colour variation, walls have a few posters
6. **Budgets still pass** — `< 400 draw calls, < 60 MB total` (re-verify on integrated graphics)
7. **All textures are CC0**, with CREDITS.md entries

## Wire-size estimate

| Addition | Est. size |
|---|---|
| 3 map textures (2K JPG, embedded glb) | ~6–8 MB (before glTF compression/Meshopt) |
| Weapon detail maps (5× 128², embedded) | ~0.1 MB |
| Character noise maps (8× 128², embedded) | ~0.2 MB |
| Signage textures (4× 128²) | < 0.1 MB |
| Joint geometry (per character) | ~0.1 MB triangles |
| **Subtotal additions** | **~8–9 MB** |
| Existing wire | ~7 MB |
| **Projected total** | **~15–16 MB** — well under the 48 MB cap |

## Test tiers

Per the Definition of Done matrix:

| Feature type | T0 | T1 | T2 | T3 |
|---|---|---|---|---|
| Map textures | — | — | ✅ budgets+format | ✅ |
| Weapon textures | — | — | ✅ | ✅ |
| Character geometry + textures | — | — | ✅ budgets | ✅ |
| Breakable respawn | ✅ restore fn | — | — | ✅ |
| Map life / signage | — | — | ✅ budgets | ✅ |

- **T0:** `breakables.test.ts` — `restoreBreakables()` pure function test
- **T2:** Draw call count check, payload budget check, material config check (lightMap.channel === 1, NoColorSpace)
- **T3:** ACC-021 acceptance script
- No T1 needed — no sim behaviour change (textures/geometry are render-side; breakable respawn is a round-flow state change, verified via T3)

## Never

- Pixel-diff the renderer
- Download textures from non-CC0 sources
- Add realtime lights in the world scene to "fix" dark textured areas
- Exceed 4 map materials
- Ship textures wider than 2K
- Skip the CREDITS.md row for any new texture

## When you're done

- [ ] `pnpm typecheck` green
- [ ] `pnpm test` green (breakable respawn T0)
- [ ] Draw calls < 400
- [ ] Wire payload < 48 MB
- [ ] ACC-021 written **before tuning**, run, and PASS recorded with commit hash
- [ ] `CREDITS.md` updated for every new texture
- [ ] `plan_to_implement.md` Phase 13 boxes ticked
