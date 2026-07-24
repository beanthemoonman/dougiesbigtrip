# Plan — `modelview` CLI: headless multi-angle asset preview

A command-line tool that renders any project `.glb` from several fixed camera angles to PNG
files, so an agent (or a human) can inspect and refine model assets **without booting the game
or a browser**. Reuses the project's existing three.js exactly — same `GLTFLoader`, same
renderer class — so what the tool shows is what the game loads.

Status: **done** (2026-07-24). Implementation pivot: `gl` (headless-gl) provides only WebGL 1.0
but three.js r170 requires WebGL 2.0. Switched to Puppeteer headless Chrome, which provides
full WebGL 2.0 and renders identically to the game (same Chromium WebGL implementation). The
tool still reuses the project's exact three.js served via a temporary local HTTP server, so
renderer config (tone mapping, colour space) matches the game.

---

## Why this exists

Asset refinement (Phase 13 and ongoing) means iterating on `.glb` files — checking silhouette,
proportions, material reads, texture seams, the join-floatiness on characters. Today the only
way to *see* a model is to start `pnpm dev`, connect, spawn, and walk up to it. That loop is
too slow for "nudge the mesh, look again" and produces no artifact an agent can read.

The tool collapses that to: `pnpm view assets/props/crate_wood.glb` → six PNGs on disk →
`Read` them → critique → repeat.

**Explicit non-goal:** this is not a test tier and not the game. It does not assert the
art-direction rules (see [Divergences](#deliberate-divergences-from-game-render)). It is a
disposable inspection tool.

## What already exists (reuse, don't rebuild)

| Thing | Where | Reuse how |
|---|---|---|
| three.js r170 + types | `dependencies.three` | Renderer, scene, camera, `Box3` framing |
| `GLTFLoader` | `node_modules/three/examples/jsm/loaders/GLTFLoader.js` | Load the `.glb` — present, verified |
| `tsx` runner | `devDependencies.tsx` | Run the TS file directly, no build step |
| `WebGLRenderer` setup patterns | `src/render/renderer.ts` | Match tonemapping/output-color-space so colours read like the game |
| Lightmap material handling | `src/render/lightmap.ts` | *Reference only* — we do NOT apply lightmaps here (see divergences) |

## New dependencies

| Package | Why | Rung |
|---|---|---|
| `puppeteer` | Headless Chrome provides WebGL 2.0 (three.js r170 requires it; `gl`/headless-gl only provides WebGL 1.0). Chromium binary cached at `~/.cache/puppeteer/` — never committed. | Downloads ~300 MB Chromium binary once |
| `pngjs` | Encode the raw RGBA pixel buffer to PNG | Small, pure JS |

---

## Files

```
tools/modelview/
  view.ts        # the whole tool — arg parse, render, save (~150 lines)
  view.test.ts   # one self-check (crate renders non-blank)
```

- `package.json`: add `"modelview": "tsx tools/modelview/view.ts"`.
- `.gitignore`: add `.modelview/` (default output dir — regenerable, never committed).

One tool file. No `src/` shared module, no class hierarchy, no config file.

## CLI contract

```bash
pnpm modelview <path.glb> [options]

Options:
  --angles <list>   Comma-separated from the canned set. Default: all six.
                    front,back,left,right,top,iso
  --size <px>       Square render size. Default: 1024.
  --out <dir>       Output directory. Default: .modelview/
  --bg <hex>        Background colour. Default: 808080 (neutral mid-grey).
```

Output filenames: `<out>/<basename>__<angle>.png`
e.g. `.modelview/crate_wood__iso.png`.

On success, prints one line per file written (absolute paths, so an agent can `Read` them
directly). Non-zero exit on: missing file, parse failure, blank render.

## The six canned angles

Camera always looks at the model's bounding-box centre. Directions are unit vectors on the
view sphere; distance is computed by framing (below).

| Angle | Direction (x, y, z), Y-up | Reads |
|---|---|---|
| `front` | (0, 0, 1) | Silhouette, face/front detail |
| `back` | (0, 0, −1) | Back seams, rear geometry |
| `left` | (−1, 0, 0) | Profile |
| `right` | (1, 0, 0) | Profile (asymmetry check) |
| `top` | (0, 1, 0.001) | Footprint, layout (tiny z to avoid gimbal/up ambiguity) |
| `iso` | (1, 0.8, 1) normalised | The money shot — 3/4 hero view |

`front` assumes the model faces +Z. Project convention is Y-up (CLAUDE.md); glTF export handles
Z→Y. If a given asset faces the "wrong" way, that's an asset-orientation observation the tool
surfaces, not something it corrects.

## Auto-framing (no per-asset tuning)

1. After load, compute `new THREE.Box3().setFromObject(root)`.
2. `center = box.getCenter()`, `sphere = box.getBoundingSphere()`, `r = sphere.radius`.
3. Perspective camera, `fov = 45°`, `aspect = 1`.
4. Distance so the bounding sphere fits with margin:
   `dist = (r / sin(fov/2)) * 1.15` (15 % padding).
5. Per angle: `camera.position = center + dir * dist`, `camera.lookAt(center)`,
   `camera.near = dist − r*2`, `camera.far = dist + r*2` (clamp near ≥ 0.001).

This frames a 2 cm shell casing and a 30 m map wall identically well. No constants per model.

## Lighting

Three cheap lights, fixed, so shape and material read regardless of the model:

- `HemisphereLight(0xffffff, 0x444444, 1.0)` — ambient fill, sky/ground.
- `DirectionalLight(0xffffff, 2.0)` from the camera's upper-right each angle (key).
- `DirectionalLight(0xffffff, 0.6)` from opposite-lower (fill), kills pure-black faces.

No shadows (`castShadow` off). Shadows add nothing to silhouette/material inspection and cost
setup.

## Deliberate divergences from game render

These are intentional and each gets a `// ponytail:` line at the relevant code:

1. **Realtime lights, not lightmaps.** CLAUDE.md forbids realtime lights *in the world scene*
   for illumination. This tool is not the world scene — it's an inspection rig, and baked
   lightmaps only exist for the map, not for props/weapons/characters. We light with directional
   lights so an unlit prop is still visible.
2. **No fog, no post FX.** We want the raw asset, not the mood.
3. **Neutral grey background,** not the skybox — makes silhouette and edges legible.
4. **Renderer colour management matches the game** (`ACESFilmicToneMapping` +
   `SRGBColorSpace` output, mirror whatever `src/render/renderer.ts` sets) so material colours
   are not misleading. This is the one thing we *do* copy from the game.

## Render → PNG pipeline

1. Start a temporary HTTP server on a random port, serving static files from the project root
   (needed for three.js ES module import maps to resolve).
2. Launch headless Chrome via Puppeteer. Navigate to an inline HTML page that imports three.js
   and GLTFLoader from the local server.
3. Pass the GLB file content (base64-encoded) into the page via `page.evaluate()`; the page
   uses `GLTFLoader.load()` with a `data:` URL.
4. For each requested angle: `page.evaluate()` positions the camera and lights, calls
   `renderer.render()`, reads RGBA pixels from the WebGL context, and returns them as a base64
   string.
5. **Flip vertically** in Node — GL's origin is bottom-left, PNG is top-left.
6. `pngjs` `PNG` with the flipped buffer → `pack()` → write file.

Renderer, scene, lights are created once in the page and reused across angles (no per-angle
allocation).

## Self-check (the one runnable test)

`view.test.ts` (vitest, since it's already the runner):

- Render `assets/props/crate_wood.glb` at `iso`, 256².
- Assert the PNG buffer has **> 1 % non-background pixels** (i.e. something actually drew — not
  a blank grey frame). This is the smallest thing that fails if context creation, loading,
  framing, or readback breaks.
- No golden image, no pixel-diff (CLAUDE.md: never pixel-diff the renderer). Just "not blank."

## Definition of done for this tool

Per CLAUDE.md, this is a **tool**, not a game feature — most tiers don't apply. Applicable gates:

- [x] `pnpm modelview assets/props/crate_wood.glb` writes six non-blank PNGs.
- [x] Runs against a weapon, a character, and the full map `.glb` without special-casing.
- [x] `view.test.ts` green (the non-blank self-check).
- [x] `pnpm typecheck` green, no new `any`.
- [x] `.modelview/` gitignored; `"modelview"` script added.
- [x] `docs/plan-modelview-cli.md` (this file) marked done; `claude_changelog.md` appended.

## Explicitly out of scope

Say the word to add any of these — none are built until a refinement task actually needs them:

- Turntable GIF / MP4 (needs a video encoder dep).
- Interactive orbit (that's the browser fallback, not this).
- Wireframe / normals / UV-checker debug passes.
- Skeletal animation playback — viewmodels/characters render in **bind pose** only.
- Per-material breakdown or texture-channel dumps.
- Auto-detecting model facing / re-orienting.

## Risks

| Risk | Mitigation |
|---|---|
| `gl` (headless-gl) provides only WebGL 1.0, three.js r170 needs WebGL 2.0 | Switched to Puppeteer headless Chrome — same WebGL implementation as the game, just headless |
| Puppeteer requires a Chromium download | Binary cached at `~/.cache/puppeteer/`, never committed; one-time ~300 MB download |
| CI environment may lack GPU/sandbox | Puppeteer launched with `--no-sandbox --disable-gpu` flags; headless software rendering works |
| Map `.glb` is large / many draw calls | Framing handles size; render is one-shot offline, budget rules (< 400 calls) don't apply to an offline previewer |
| KTX2 / Meshopt-compressed assets need loader plugins | If any shipped `.glb` uses KTX2/Meshopt, register `KTX2Loader`/`MeshoptDecoder` on the `GLTFLoader` (same plugins the game uses) — check at build time |
