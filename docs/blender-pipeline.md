# Blender Pipeline

Everything needed to produce map geometry, lightmaps, and `.glb` exports for this project.

If you are a programmer who has never used Blender: **do the "10-minute cube" walkthrough at
the end of this document first.** It takes 10 minutes and it teaches the one non-obvious
concept (lightmap UVs) in isolation, where mistakes are cheap. Do not learn it on the real map.

Blender 4.2 LTS or newer. All shortcuts assume default keymap.

---

## 0. The concept you need before touching anything

**Lightmapping** = pre-computing lighting into a texture, offline, at high quality, so the
runtime just multiplies it against the albedo and does nothing.

This is why Source-era games look the way they do: soft bounce light, contact shadows, and
a solid 300 fps on a GPU from 2004. There is no realtime GI in this project. There is no
realtime sun. There is a texture that already knows what the lighting looks like.

To do this, every surface needs **two sets of UV coordinates**:

| UV set | Name | Purpose | Rule |
|---|---|---|---|
| 0 | `UVMap` | Albedo / normal / roughness | **Tiles.** Islands may overlap. A 4 m wall repeats a 1 m brick texture 4×. |
| 1 | `UVMap_Lightmap` | Lightmap | **Never overlaps.** Every triangle in the entire map gets its own unique, non-overlapping patch of the lightmap texture, with padding between islands. |

If a programmer's intuition says "why two?" — because tiling is what makes textures cheap,
and tiling is exactly what you can't do for lighting, because two walls that share the same
brick texture do not share the same shadows.

**Getting UV set 1 wrong is the single most common way this pipeline fails**, and the failure
mode is subtle: shadows appear in the wrong place, or bleed across edges, or flicker. Take it
seriously.

---

## 1. One-time Blender setup

### Units

`Scene Properties (printer icon) → Units`

- Unit System: **Metric**
- Unit Scale: **1.0**
- Length: **Meters**

Do not change Unit Scale from 1.0. It silently breaks glTF export scale and physics import.

### Grid

`View3D → N-panel → View tab`

- Clip Start: `0.01`, Clip End: `1000`

`Overlays dropdown (top right of viewport) → Guides`

- Scale: `1.0`, Subdivisions: `10` → gives you a 10 cm subgrid on a 1 m grid.

**Snapping:** magnet icon in the header → set to **Increment**, enable **Absolute Grid Snap**.
Then `Ctrl` while moving snaps to the grid. Set `Scene → Units → Separate Units` off.

Our module grid is **0.5 m**. Everything's bounding box aligns to it. No exceptions — the
moment one wall is at 0.517 m you get a lighting seam you'll spend an hour debugging.

### Render engine

`Render Properties → Render Engine: Cycles`

- Device: **GPU Compute** (Preferences → System → Cycles Render Devices → CUDA/OptiX for
  your RTX 5070 Ti; pick **OptiX**, it's substantially faster for baking)
- Sampling → Render → Max Samples: `512` for tests, `2048` for the final bake
- Sampling → Render → Denoise: **on**, Denoiser: **OptiX**, Passes: `Albedo + Normal`

Note: **Eevee cannot do this.** It has no proper bake. Cycles only.

### Addons to enable

`Edit → Preferences → Add-ons`

| Addon | Built-in? | Why |
|---|---|---|
| **Node Wrangler** | yes | `Ctrl+Shift+T` to auto-wire a whole PBR texture set. Saves hours. |
| **Import-Export: glTF 2.0** | yes (usually on) | Export |
| **Texel Density Checker** | no — [GitHub, free](https://github.com/mrven/Blender-Texel-Density-Checker) | Measures px/m so your textures aren't visibly different resolutions between props |
| **UVPackmaster** (optional, paid) | no | Much better lightmap UV packing than the built-in. Not required; built-in works. |

---

## 2. Texel density

**Texel density** = texture pixels per metre of surface. If two adjacent walls have different
densities, one looks blurry next to the other, and your eye picks it up instantly even if you
can't name what's wrong.

Project standard:

| Map type | Target | Reasoning |
|---|---|---|
| Albedo/normal/roughness | **128 px/m** | A 512² texture covers a 4 m × 4 m wall. This is approximately what CS:S shipped (512² over 128 Hammer units ≈ 157 px/m). |
| Lightmap | **8 px/m** (12.5 cm per luxel) | Source's default is 16 units/luxel ≈ 2.5 px/m. 8 px/m is 3× finer and still cheap. Use 16 px/m only on hero surfaces. |
| Hero props (weapons in hand) | 512 px/m | Viewmodel is 30 cm from the camera |

With Texel Density Checker: it reports in **px/cm**. 128 px/m = **1.28 px/cm**.

**Lightmap atlas sizing math.** Add up your map's total surface area (Texel Density Checker
has a "Total Area" readout). Then:

```
pixels_needed = surface_area_m2 × (8 px/m)²  ×  1.4   (packing waste factor)
atlas_side    = sqrt(pixels_needed), rounded up to a power of two
```

Example: a small map with ~3,500 m² of lit surface →
`3500 × 64 × 1.4 = 313,600 px` → `sqrt ≈ 560` → **1024²**. Comfortable.

If you land above 4096², **split the map into 2–4 lightmap chunks** (e.g. by area: `A_site`,
`mid`, `T_spawn`), each with its own atlas and its own set of objects. Do not ship an 8K
lightmap.

---

## 3. Modular kit

Build the map from a small set of reusable pieces. This is how Source maps were made and it's
why they're consistent.

### Kit contents (v1)

| Piece | Dimensions | Notes |
|---|---|---|
| `SM_Wall_2m` | 2 × 3 × 0.2 m | |
| `SM_Wall_4m` | 4 × 3 × 0.2 m | |
| `SM_Wall_4m_Door` | 4 × 3 × 0.2 m | doorway cut, 1 × 2.1 m |
| `SM_Floor_4m` | 4 × 4 × 0.2 m | |
| `SM_Stair_1m` | 1 × 1 × 0.5 m | riser ≤ **0.4572 m** — see below |
| `SM_Crate_1m` | 1 × 1 × 1 m | |
| `SM_Crate_Half` | 1 × 1 × 0.5 m | jumpable |
| `SM_Pillar` | 0.5 × 0.5 × 3 m | |
| `SM_Ramp_45` | 4 × 4 × 2 m | 45° — see slope limit below |

### Hard constraints from the movement code

These come from `docs/source-movement.md` and are not negotiable, because geometry that
violates them is unwalkable:

- **Max step height: 0.4572 m** (18 Hammer units). A stair riser of 0.5 m *cannot be walked
  up* — the player will have to jump it. If you build 0.5 m stairs you will get a bug report
  and the bug is the stairs.
- **Max walkable slope: 45.57°** (surface normal · up ≥ 0.7). Steeper and the player slides.
- **Player capsule: 0.4064 m radius, 1.8288 m standing / 0.9144 m ducked.** So:
  - Minimum corridor width: **1.0 m** (0.813 m capsule + clearance). Below 1.0 m it feels awful.
  - Doorway height: **2.1 m** min.
  - Crouch gaps: **1.0 m** high, not 0.92 m — leave margin.
- **Jump clears 1.143 m.** So a 1 m crate is jumpable, a 1.5 m one is not. Pick deliberately.

### Rules for every kit piece

1. **Origin at a grid corner**, not the centre. `Object → Set Origin → Origin to 3D Cursor`
   after snapping the cursor to the corner (`Shift+S → Cursor to Selected` on a corner vertex).
   This makes snapping pieces together trivial.
2. **Apply all transforms before export.** `Ctrl+A → All Transforms`. Non-applied scale
   corrupts normals and breaks physics import. Do this every single time.
3. **No n-gons on anything that gets a lightmap.** Quads and tris only. N-gons produce
   garbage UV unwraps.
4. Face normals outward. `Shift+N` to recalculate; enable Overlays → Face Orientation and
   look for red.
5. Name meshes `SM_` (static mesh). Name materials by surface type — this is load-bearing,
   see §7.

---

## 4. Materials

Max **4 materials for the whole map.** More materials = more draw calls, and the merge step
in the engine merges *per material*.

Suggested set for a Dust2-adjacent palette:

| Material | Palette | Source |
|---|---|---|
| `M_Sandstone` | tan, warm | Poly Haven `sandstone_blocks_*` |
| `M_Concrete` | desaturated grey | Poly Haven `concrete_wall_*` |
| `M_Metal_Painted` | faded blue/green | Poly Haven `painted_metal_*` |
| `M_Wood_Crate` | mid brown | Poly Haven `wood_planks_*` / Kenney |

### Setting one up

1. Download the Poly Haven set at **2K**, not 4K. At 128 px/m a 2K texture covers 16 m of
   wall. You will never see the difference and you'll halve your download.
2. Select the object, `Material Properties → New`, rename to `M_Sandstone`.
3. Open the Shader Editor. Select the Principled BSDF node. With **Node Wrangler** enabled,
   press `Ctrl+Shift+T`, multi-select all the texture files (diff, nor_gl, rough, ao), hit
   Open. It wires everything, including the Normal Map node and colour spaces.
4. **Delete the displacement/height wiring.** We have no tessellation at runtime; it'll only
   make the bake disagree with the game.
5. Check colour spaces manually — this bites people:
   - Diffuse/albedo → **sRGB**
   - Normal / roughness / metal / AO → **Non-Color**

   If the normal map is set to sRGB, lighting is subtly wrong everywhere and it's very hard
   to spot.
6. Set the Mapping node scale so the tiling gives you 128 px/m. Verify with Texel Density
   Checker, don't eyeball it.

### Prototype/greybox phase

Use Kenney's **Prototype Textures** pack (the orange/grey dev grid). One material,
`M_Proto`, tiled at exactly 1 m per grid square. This is the classic Source dev-texture look
and it doubles as a live texel-density ruler while you block out.

---

## 5. UV set 0 — albedo (tiling)

For a modular kit, don't hand-unwrap. Use box projection:

1. Select the object, `Tab` into Edit Mode, `A` to select all.
2. `U → Smart UV Project`
   - Angle Limit: `66°`
   - Island Margin: `0.002`
   - Correct Aspect: on
3. Or, better for architecture: `U → Cube Projection` after `Object → Apply → Rotation`,
   then scale the UVs in the UV editor to hit 128 px/m.

Overlapping is **fine and desirable** here — four identical wall segments can share the same
UV space. That's the whole point of tiling.

Confirm the UV layer is named exactly `UVMap` in `Object Data Properties (green triangle) →
UV Maps`.

---

## 6. UV set 1 — lightmap (the part that matters)

This must be done for **every object that will be lit**, and the islands of *the entire map*
must fit in one atlas without overlapping.

### Per-object

1. `Object Data Properties → UV Maps → +` — a new layer appears. Rename it exactly
   **`UVMap_Lightmap`**. Confirm it's the **second** entry in the list; order defines
   TEXCOORD_0 vs TEXCOORD_1 on export.
2. Make sure the new layer is **selected** (highlighted) in the list. Everything you do in
   Edit Mode's UV editor now applies to it. **Forgetting this and destroying your albedo UVs
   is the classic mistake.** If your walls suddenly have stretched brick, this is why.
3. `Tab` → `A` → `U → Smart UV Project`:
   - Angle Limit: `66°`
   - **Island Margin: `0.02`** ← critical. Zero margin = shadow bleed between unrelated
     surfaces. This is padding so the bake's edge-dilation doesn't smear one island onto
     its neighbour.
   - Area Weight: `0`
   - Correct Aspect: on
   - Scale to Bounds: **off**

### Packing the whole map into one atlas

Every lit object shares one lightmap image, so their UVs must be packed *together*, not
per-object.

1. Select **all** lit objects. `Ctrl+J` is **not** what you want — do not join them.
2. Instead: enter Edit Mode with all of them selected (`Tab` with multiple objects selected
   edits them all — enable `Preferences → Editing → Multi-Object Editing`, on by default).
3. `A` to select all geometry across all objects.
4. In the UV Editor: `UV → Pack Islands`
   - Rotate: on
   - Margin: `0.01`
   - Shape Method: `Concave`
   - **Scale: on**, **Merge Overlapping: off**
5. Look at the result. If it's a sea of tiny islands with huge gaps, your packing efficiency
   is bad and you're wasting atlas — this is where UVPackmaster earns its money.

### Verify before you bake

In the UV Editor with everything selected: **nothing may overlap.** Turn on `Overlay →
Display Stretch → Area` to spot distortion, and visually scan for stacked islands. Ten
seconds here saves an hour later.

---

## 7. Naming conventions (load-bearing)

The engine reads material names to pick impact sounds, decals, and footsteps. Format:

```
M_<SurfaceType>[_<Variant>]
```

`SurfaceType` must be one of: `Sandstone`, `Concrete`, `Metal`, `Wood`, `Dirt`, `Glass`.
`src/game/surfaces.ts` maps these to audio/decal sets. A material named `M_wall_final_v2`
gets the default surface and will sound like concrete forever.

Collision meshes go in a Blender collection named `Collision`, with meshes named
`UCX_<name>`. They're exported into the same `.glb`; the loader finds them by prefix, builds
Rapier colliders from them, and hides them from the render scene. Keep them brutally simple —
a box is a box. Never let the render mesh be the collision mesh; a 20k-tri map trimesh will
tank your raycasts.

---

## 8. Lighting the scene

Set up the lights that will be baked. These exist in Blender only — none of them ship.

- **Sun:** `Add → Light → Sun`. Strength `3–5`, Angle `2–4°` (this controls shadow softness;
  Source shadows are sharp, keep it low). Rotate it to a low-ish angle for long shadows.
- **Sky:** `World Properties → Color → Sky Texture` (Nishita). This provides the blue ambient
  fill in shadow that reads as "outdoor". Strength `0.3–0.6`.
- **Interiors:** a few area lights, low strength, warm (`~3000K`).
- **Do not** add a huge ambient/emission fill to "brighten things up". Flat lighting is what
  makes a demo look like a demo. Contrast between lit and shadowed is the entire look.

**Whatever sun direction you bake with, the skybox in-game must match it.** Note the sun's
rotation somewhere. If they disagree, the map looks fake and nobody can tell you why.

---

## 9. Baking

### Create the target image

1. Image Editor → `New`
   - Name: `LM_MapName`
   - Width/Height: from the §2 math (e.g. `1024`)
   - Color: black, Alpha off
   - **32-bit Float: ON** ← a Diffuse-no-Color bake produces values above 1.0. 8-bit clips
     them and you lose all your highlights.
   - Generated Type: Blank

### Wire it into every material

Cycles bakes into "the active Image Texture node of the active material". So **every material
on every baked object** needs:

1. Shader Editor → `Add → Texture → Image Texture`
2. Set its image to `LM_MapName`
3. **Leave it unconnected.** It does not plug into anything.
4. Click it so it is the **active node** (white outline). This is what makes it the bake target.
5. Add a `UV Map` node → set it to `UVMap_Lightmap` → connect to the Image Texture's `Vector`
   input. **Without this, Cycles bakes to UV set 0 and you get nonsense.**

Yes, you must do this for every material. Script it:

```python
# tools/blender/setup_bake_targets.py  — run in Blender's Scripting tab
import bpy

LM = bpy.data.images["LM_MapName"]

for obj in bpy.context.selected_objects:
    if obj.type != 'MESH':
        continue
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree

        node = nt.nodes.get("BAKE_TARGET")
        if node is None:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.name = node.label = "BAKE_TARGET"
            node.location = (-900, 600)

            uv = nt.nodes.new("ShaderNodeUVMap")
            uv.name = "BAKE_UV"
            uv.uv_map = "UVMap_Lightmap"
            uv.location = (-1100, 600)
            nt.links.new(uv.outputs["UV"], node.inputs["Vector"])

        node.image = LM
        nt.nodes.active = node          # <-- makes it the bake target
        node.select = True

print("bake targets set")
```

### Bake settings

`Render Properties → Bake`

| Setting | Value | Why |
|---|---|---|
| Bake Type | **Diffuse** | |
| Contributions | Direct ✓ Indirect ✓ **Color ✗** | Unchecking **Color** is the whole trick: it bakes *lighting only*, with no albedo mixed in. The result multiplies against the albedo at runtime. If you leave Color on, the brick texture gets burned into the lightmap and tiling stops working. |
| Selected to Active | **off** | |
| Margin → Type | **Adjacent Faces** | |
| Margin → Size | **16 px** | Dilates island edges outward so bilinear filtering at island borders doesn't sample black. Too small = dark seams on every edge. |
| Clear Image | on (first bake only) | |

Select all lit objects, then `Bake`. Go get coffee — at 2048 samples on a real map this is
minutes to tens of minutes.

### Save it

`Image Editor → Image → Save As`
- Format: **OpenEXR**
- Color Depth: **Float (Half)** — half is plenty and halves the file
- Codec: **ZIP**
- Save to `assets/maps/<mapname>/lightmap.exr`

Then convert to KTX2 — see `docs/asset-pipeline.md`.

### Iterating

Baking is slow, so: bake at 128 samples with denoising while you're iterating on light
placement. Bake at 2048 once, at the end. Don't do a 20-minute bake to check whether a light
is too bright.

---

## 10. Export

`File → Export → glTF 2.0 (.glb)`

| Section | Setting | Value |
|---|---|---|
| Format | | **glTF Binary (.glb)** |
| Include | Limit to | **Selected Objects** (or use Collections) |
| Include | Data → Custom Properties | on |
| Transform | +Y Up | **on** ← Blender is Z-up, three is Y-up. The exporter handles it. Never hand-rotate. |
| Data → Mesh | **UVs** | **on** ← this is what exports TEXCOORD_1 |
| Data → Mesh | Normals | on |
| Data → Mesh | Tangents | on (only if you ship normal maps) |
| Data → Mesh | Apply Modifiers | on |
| Data → Material | Materials | Export |
| Data → Material | Images | **None** — we pack textures separately via gltf-transform, not embedded |
| Animation | | off for maps, on for characters |
| Compression | Draco | **off** — we do Meshopt in the asset pipeline instead |

### Verify the export — do not skip this

The Blender glTF exporter has historically stripped UV layers that no material node
references. Your `UVMap_Lightmap` is referenced only by an *unconnected* node, which is
exactly the sort of thing that can get pruned.

```bash
npx @gltf-transform/cli inspect assets/maps/mymap.glb
```

Look at the meshes table for **`TEXCOORD_1`**. If it's not there, your lightmap will silently
fall back to UV0 and look like static. Fallback if it's missing: temporarily connect the
lightmap Image Texture node's Color output into an unused input (e.g. a Mix node feeding
Emission at strength 0) so the exporter sees the UV as used, re-export, and verify again.

### Lightmaps and glTF

**glTF has no standard lightmap slot.** `KHR_materials_*` doesn't cover it and `EXT_lightmap`
isn't meaningfully supported. So:

- The `.glb` carries geometry + TEXCOORD_1 + albedo materials.
- The lightmap ships as a **separate KTX2 file**.
- `src/render/lightmap.ts` loads it and assigns it to materials by name after `GLTFLoader`
  resolves. Convention: `assets/maps/<name>/lightmap.ktx2` applies to every material in
  `<name>.glb`.

Three.js side:

```ts
const lm = await ktx2Loader.loadAsync('assets/maps/mymap/lightmap.ktx2');
lm.flipY = false;               // glTF convention; must match the geometry
lm.channel = 1;                 // <-- use TEXCOORD_1 / the `uv1` attribute
lm.colorSpace = THREE.NoColorSpace;  // it's linear light data, not colour

scene.traverse((o) => {
  if (!(o as THREE.Mesh).isMesh) return;
  const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
  m.lightMap = lm;
  m.lightMapIntensity = 1.0;    // expect to tune — see below
  m.needsUpdate = true;
});
```

**Expect to tune `lightMapIntensity`.** Three's internal handling of lightmap irradiance has
included a factor of π at various points in its history, so a "correct" Blender bake often
lands somewhere between `1.0` and `3.14` in three. Bake a grey test scene, compare a Blender
render side-by-side with the three render, and pick the number that matches. Write the number
down. It is not a magic number, it's a units mismatch, and it's normal to have to find it.

---

## 11. Characters and animation (Mixamo)

1. Model: Quaternius or Kenney rigged character, or Mixamo's own.
2. Upload the FBX to [mixamo.com](https://mixamo.com), auto-rig, then download clips:
   `Idle`, `Walk`, `Run`, `Crouch Walk`, `Reload`, `Death`, `Hit Reaction`.
3. Download as **FBX Binary, 30 fps, "Without Skin"** for every clip after the first (the
   first one gets "With Skin" — that's your mesh + skeleton).
4. Import all into one Blender file. Each clip lands as an Action.
5. **Mixamo exports at 100× scale.** Scale the armature by `0.01` and `Ctrl+A → Apply Scale`.
   If your character is 180 m tall, this is why.
6. Rename actions to match `src/ai/anim.ts`'s expected names exactly.
7. In `Object Data Properties → Animation`, use the NLA / Action stashing so **all** actions
   get exported (the glTF exporter only exports actions that are stashed or pushed down).
   `Dope Sheet → Action Editor → Stash` each one.
8. Export `.glb` with Animation → on, and check "Group by NLA Track".

**Hitboxes:** do not derive them from the render mesh. Add empties/bones named
`HB_Head`, `HB_Chest`, `HB_Stomach`, `HB_ArmL`, etc. parented to the corresponding bones.
`src/game/hitboxes.ts` builds capsules from these at load time.

---

## 12. Troubleshooting

| Symptom | Cause |
|---|---|
| Lightmap looks like noise/static | Bake used UV0. You forgot the UV Map node into the Image Texture, or TEXCOORD_1 didn't export. |
| Shadows appear on the wrong wall | Overlapping lightmap UVs. Re-pack with Merge Overlapping **off**. |
| Dark seams along every polygon edge | Bake margin too small. Raise to 16 px, and raise Island Margin to 0.02. |
| Everything blown out white | Bake had **Color** contribution enabled, or the image isn't 32-bit float, or `lightMapIntensity` is ~π off. |
| Whole map is black in-game | `lm.channel` not set to 1; or `flipY` mismatch; or colorSpace set to sRGB. |
| Model is 100× too big/small | Mixamo scale, or you didn't `Ctrl+A → Apply Transforms`. |
| Model is lying on its face | You hand-rotated instead of using +Y Up on export. Undo, apply rotation, re-export. |
| Normals look inverted / lighting inside-out | Flipped faces (`Shift+N`), or unapplied negative scale. |
| Player can't walk up your stairs | Riser > 0.4572 m. See §3. |
| Player slides down your ramp | Slope > 45.57°. See §3. |
| Blender crashes on bake | 32-bit float 4K+ atlas + GPU OOM. Split the map into lightmap chunks (§2). |

---

## 13. The 10-minute cube (do this first)

Proves the whole pipeline end to end with one object. If this works, the map will work.

1. New scene, delete the default cube's material, keep the cube. Scale to 2 m (`S`, `2`,
   `Ctrl+A → Apply Scale`).
2. Add a plane under it, 10 m. Add a Sun, strength 4, tilted ~40°.
3. Give both objects one material, `M_Test`. Principled BSDF, base colour mid-grey.
4. On both: add UV layer 2 named `UVMap_Lightmap`. Select it. Edit Mode → `A` →
   `U → Smart UV Project`, Island Margin `0.02`.
5. Select both, Edit Mode, `A`, UV Editor → `UV → Pack Islands`, margin `0.01`.
6. New image `LM_Test`, 512², **32-bit float**.
7. In `M_Test`: add Image Texture → `LM_Test`, add UV Map node → `UVMap_Lightmap` → into its
   Vector. Click the Image Texture node so it's active. Leave it unconnected.
8. Cycles, GPU, 256 samples, denoise on. Bake type **Diffuse**, Direct ✓ Indirect ✓
   **Color ✗**, margin 16 px, Selected to Active off. Select both objects. **Bake.**
9. Look at `LM_Test` in the Image Editor. You should see: a bright plane, a dark rectangular
   cube shadow, and a soft gradient. **If you see grey texture detail, Color was on.**
   **If you see noise, your UVs are wrong.**
10. Save as EXR. Export the two objects as `.glb` with UVs on, +Y Up on.
11. `npx @gltf-transform/cli inspect test.glb` → confirm `TEXCOORD_1` exists.
12. Load in three, assign the lightmap with `channel = 1`, no lights in the scene at all.
    You should see a shadowed cube on a lit plane.

If step 12 renders correctly with **zero lights in the three.js scene**, you understand the
pipeline and can go build the map.
