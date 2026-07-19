# Asset Pipeline

How raw exports become shippable files. Budget: **48 MB initial, 60 MB total.** (Initial was
16 MB through Phase 5; raised in Phase 6 to absorb the shared Rust `sim.wasm`.)

Raw Blender output will be roughly 10× over budget. That's expected — the whole job of this
pipeline is that last 10×.

---

## Why not just ship the PNGs?

Two separate problems that people conflate:

| Problem | Solution | What it does |
|---|---|---|
| **Download size** | PNG/JPEG, gzip, Draco | Small on disk. **Decompressed to raw RGBA on the GPU.** |
| **VRAM + upload time** | KTX2 / Basis | Stays compressed *in VRAM*. 4–8× less memory, faster sampling. |

A 2048² PNG might be 3 MB on disk, but it's **16 MB in VRAM**, always, forever, and it costs a
main-thread stall to decode and upload. Twenty of those and you've eaten 320 MB of VRAM on an
integrated GPU with 1 GB. That's the actual failure mode, and it doesn't show up as a big
download — it shows up as a hitchy, crashy experience on the exact laptops your players have.

**KTX2/Basis stays compressed on the GPU.** That 2048² becomes ~1 MB on disk and ~5.6 MB in
VRAM. This is not an optimisation, it's the correct format.

---

## Tools

```bash
pnpm add -D @gltf-transform/cli sharp
```

`gltf-transform` needs `toktx` (from KTX-Software) for KTX2 encoding — install it from
[KhronosGroup/KTX-Software releases](https://github.com/KhronosGroup/KTX-Software/releases)
and make sure it's on `PATH`.

---

## The pipeline

`tools/optimize/run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

IN="$1"; OUT="$2"

npx gltf-transform optimize "$IN" "$OUT" \
  --compress meshopt \
  --texture-compress ktx2 \
  --texture-size 2048 \
  --simplify false \
  --prune true \
  --weld true \
  --instance true \
  --join false

npx gltf-transform inspect "$OUT"
```

Why these flags:

- `--compress meshopt` — not Draco. Meshopt decodes an order of magnitude faster (Draco can
  cost hundreds of ms of main-thread time on a big map, which is a visible hitch on load), and
  it also reduces *VRAM* by quantising attributes, which Draco doesn't. Draco compresses
  slightly smaller. Take the speed.
- `--simplify false` — **never auto-decimate.** Our meshes are already low-poly and hand-made;
  decimation destroys the UV2 layout and your lightmap with it.
- `--join false` — joining meshes destroys the ability to hide/find `UCX_` collision meshes by
  name, and kills frustum culling granularity. We merge deliberately at runtime instead.
- `--instance true` — modular kit means 40 copies of `SM_Wall_4m`. Instancing turns 40 draw
  calls into 1.

### Texture compression modes

KTX2/Basis has two modes and picking wrong costs you quality:

| Mode | Use for | Why |
|---|---|---|
| **ETC1S** | Albedo, AO, roughness | Tiny (~0.5 bpp), some quality loss. Fine for tiling detail. |
| **UASTC** | **Normal maps, lightmaps** | Larger (~8 bpp) but far higher quality. ETC1S mangles normal maps into blotchy garbage and banding on lightmap gradients is very visible. |

Explicit per-texture control:

```bash
# Albedo etc. — small
npx gltf-transform etc1s map.glb map.glb --slots "!normalTexture" --quality 200

# Normals — quality
npx gltf-transform uastc map.glb map.glb --slots "normalTexture" --level 4 --rdo 4 --zstd 18
```

### The lightmap

Remember: **the lightmap is not in the `.glb`** (glTF has no lightmap slot — see
`docs/blender-pipeline.md` §10). It's a separate file.

```bash
# EXR -> KTX2, UASTC, no colour transform, no mipmap gamma trickery
toktx --t2 --encode uastc --uastc_quality 3 --zcmp 18 \
      --assign_oetf linear --assign_primaries none \
      --genmipmap \
      assets/maps/mymap/lightmap.ktx2 assets/maps/mymap/lightmap.exr
```

`--assign_oetf linear` matters. The lightmap is linear light data. Tag it sRGB and everything
is subtly, uniformly wrong in a way that looks like "the bake is bad."

### Runtime loader setup

```ts
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ktx2 = new KTX2Loader()
  .setTranscoderPath('/basis/')     // copy from three/examples/jsm/libs/basis/
  .detectSupport(renderer);          // <-- MUST run after renderer creation

const gltf = new GLTFLoader()
  .setKTX2Loader(ktx2)
  .setMeshoptDecoder(MeshoptDecoder);
```

`detectSupport(renderer)` picks the GPU's native format (BC7 on desktop, ASTC on mobile,
ETC2 on older Android). Forget it and every texture silently falls back to uncompressed RGBA —
i.e. you did all this work and got none of the benefit, with no error message.

---

## Audio

| Use | Format | Settings |
|---|---|---|
| Gunshots, impacts, footsteps | **OGG Vorbis** | 96 kbps mono. Mono is mandatory for positional audio — Howler/WebAudio panning needs a mono source, and a stereo file just gets flattened after you've paid double. |
| Music / ambience | OGG Vorbis | 128 kbps stereo |

Pack short SFX into **Howler audio sprites** — one file, one decode, offset-based playback.
Thirty separate `.ogg` requests is thirty round trips and thirty decodes.

```bash
ffmpeg -i in.wav -ac 1 -c:a libvorbis -b:a 96k out.ogg
```

Provide an `.m4a` fallback only if you care about ancient Safari. Modern Safari does Vorbis.

---

## Budget accounting

| Bucket | Budget | Notes |
|---|---|---|
| Map geometry `.glb` | 3 MB | meshopt + instanced |
| Map textures (KTX2) | 5 MB | 4 materials × 3 maps @ 2K |
| Lightmap (KTX2, UASTC) | 2 MB | 1024–2048² |
| Weapons (2× viewmodel + world) | 2 MB | |
| Characters + anims | 3 MB | one mesh, retargeted |
| Audio sprite | 1.5 MB | |
| JS bundle + WASM | 1.5 MB | three ~600 KB gz, rapier ~500 KB, recast ~200 KB |
| **Initial total** | **≈16 MB today; < 48 MB budget** | Headroom reserved for `sim.wasm` (Phase 6) |

Verify every build:

```bash
pnpm build && du -sh dist/ && npx vite-bundle-visualizer
```

---

## Loading strategy

1. **Critical path:** JS + WASM + map `.glb` + lightmap. Show a loading bar with *real*
   progress from `LoadingManager.onProgress`, not a fake animation.
2. **Before spawn:** weapons + audio sprite. Block the spawn on these — a gun that appears
   three seconds after you can move is worse than a three-second-longer load.
3. **Lazy:** character death anims, decal variants, ambience.
4. Serve with `Cache-Control: immutable` + content-hashed filenames. Vite does this by default.
5. Enable Brotli at the CDN. `.glb` with meshopt still gains ~10–15% from Brotli; KTX2 does not
   (already compressed) — don't waste CPU re-compressing it.

## Verification checklist

- [ ] `gltf-transform inspect` shows `TEXCOORD_1` on map meshes
- [ ] All textures report as KTX2, not PNG
- [ ] `renderer.info.memory.textures` and `.geometries` are sane after load
- [ ] `renderer.info.render.calls` < 400
- [ ] Chrome DevTools → Network, disable cache, throttle to Fast 3G: time to interactive
- [ ] Test on an **integrated GPU**. Your 5070 Ti will hide every VRAM mistake you make.
