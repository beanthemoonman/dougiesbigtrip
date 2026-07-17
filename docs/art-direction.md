# Art Direction — the CS:Source Look

The look is **not** in the assets. You cannot download it. It's a set of constraints, most of
which are things you *don't* do. A modern renderer's defaults will actively fight you.

---

## The thesis

CS:Source is a 2004 game built for a GeForce 4. Its look comes from:

1. **Baked lighting doing all the work** — soft indirect bounce, hard sun shadows, and a
   pronounced contrast between lit and unlit that a realtime-lit scene never has for free.
2. **Low texture resolution used well** — ~512² textures, tiled, high contrast, hand-authored
   detail rather than photoscanned mush.
3. **Low polygon counts with clean silhouettes** — props read from 40 m away because they're
   simple shapes, not because they have 2M triangles.
4. **A tight, desaturated palette** — sand, concrete, faded paint. One or two saturated
   accents (blue doors, red barrels) that draw the eye to gameplay-relevant places.
5. **No post-processing except a little fog.** No SSAO, no motion blur, no chromatic
   aberration, no lens dirt.

The counter-intuitive part for a programmer: **you make it look more like Source by turning
things off**, not by adding features.

---

## Palette

Pin these in a swatch file and don't drift.

| Role | Hex | Use |
|---|---|---|
| Sandstone light | `#C9AE7C` | Primary wall mass |
| Sandstone shadow | `#8B7550` | Trim, recesses |
| Concrete | `#A5A29B` | Floors, structural |
| Concrete dark | `#5E5C58` | Bases, wear |
| Faded blue | `#4A6B7C` | Doors, accents — **gameplay landmarks only** |
| Rust/red | `#8C4A38` | Barrels, sparse accent |
| Wood | `#7A5B3C` | Crates |
| Sky | `#8FA9C4` | Horizon |
| Sun | `#FFF2D9` | Warm, not white |

Rule: **saturation is a gameplay signal.** If everything is colourful, nothing stands out and
enemies vanish. Keep world saturation low so player models read instantly.

---

## Renderer settings

```ts
renderer.outputColorSpace   = THREE.SRGBColorSpace;
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;   // tune once, against the Blender reference render
renderer.shadowMap.enabled  = false;  // <-- yes, off. See below.

scene.fog = new THREE.Fog(0x8FA9C4, 20, 140);  // linear, matches sky colour
```

### Shadows off?

Yes, for the world. The lightmap already contains every static shadow, at a quality a realtime
shadow map cannot touch, for free. Turning on a directional light + cascaded shadow maps would
*double-darken* everything the lightmap already shadowed and cost you 30% of your frame.

Dynamic characters need *something* so they don't look pasted on. Options, in order of
preference:

1. **A blob shadow** — a dark radial sprite projected on the ground under each character.
   This is what the era actually did and it is nearly free.
2. A single low-res shadow map covering only the characters, only within ~20 m. If you do
   this, exclude world geometry from casting.

Do not enable full CSM for a 4-bot demo. It's not worth it and it doesn't look period-correct.

### Lights in the world scene

Allowed:
- **One** `AmbientLight` at very low intensity (`0.05–0.1`) so pure-shadow areas aren't
  literally black.
- **One** `HemisphereLight` (low) to give dynamic characters some directional grounding — the
  lightmap can't light them, so they need *something*. Match its colours to the sky and ground.
- Muzzle flash `PointLight`, lifetime ~50 ms, distance ~8 m. This is the one dramatic
  exception and it's a big part of the feel.

Not allowed: anything else. If you're adding a light to "fix" a dark spot, fix the bake.

### Fog

Linear fog, near 20 m / far 140 m, coloured to match the horizon. This does three things:
1. Hides your draw distance.
2. Gives depth cues in an otherwise flat-lit scene.
3. Is period-correct — Source maps are full of it.

Don't use exponential fog with a low density "for realism". Linear, tuned to your map's
longest sightline, is the era-appropriate choice and it's more controllable.

### Post-processing

| Effect | Verdict |
|---|---|
| Bloom | **Very slight.** Threshold high (0.9), strength ~0.15. Only the sky and muzzle flashes should bloom. |
| SSAO | **No.** The lightmap has real AO in it. SSAO on top is muddy and wrong. |
| Motion blur | **No.** |
| Chromatic aberration / lens dirt / vignette | **No.** Nothing in 2004 had these and they hurt readability. |
| FXAA/SMAA | Yes, or MSAA 4× if you can afford it. Aliasing is not a period feature worth preserving. |
| Film grain | **No.** |

---

## Geometry budget

| Thing | Triangles |
|---|---|
| Whole map | < 80k |
| Crate | < 100 |
| Wall segment | < 50 |
| Character | 5–8k |
| Viewmodel weapon | 8–15k (it's 30 cm from the camera; spend it here) |
| Worldmodel weapon | 1–2k |

If you're above these you're not making a Source-era game, you're making a slow modern one.

---

## FOV

- **World FOV: 90°** horizontal. This is the CS default and it's non-negotiable for feel —
  74° (three's default vertical 50° at 16:9) feels like looking through a paper towel tube.
  Three's `PerspectiveCamera` takes **vertical** FOV, so convert:
  ```ts
  const vFov = 2 * Math.atan(Math.tan((90 * Math.PI / 180) / 2) / camera.aspect) * 180 / Math.PI;
  ```
  Recompute on resize. Getting this wrong means ultrawide users see less, not more.
- **Viewmodel FOV: 54–68°**, separate camera. See `docs/weapon-feel.md`.

## Map design conventions

- **Sightlines are the level design.** Long angles, cover at regular intervals, no fully open
  spaces.
- **Landmark with colour and silhouette**, not signage. A blue door is a callout.
- Cover heights matter and should be deliberate: 0.5 m (crouch behind), 1.0 m (stand behind,
  jumpable), 1.5 m+ (full cover). Use exactly these three. Mixed random heights make the map
  unreadable.
- Corridor width ≥ 1.0 m (see `docs/blender-pipeline.md` §3 for the capsule-derived minimums).
- **Ceiling height ≥ 3 m** everywhere the player can jump, or bunnyhopping bonks and feels bad.

## The single fastest way to check you're on track

Screenshot your build. Screenshot a real CS:S map. Both greyscale, side by side.

If yours is flatter — less contrast between lit and shadow — your lighting is wrong, and no
amount of texture work will fix it. That contrast is the look.
