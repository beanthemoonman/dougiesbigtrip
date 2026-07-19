# CLAUDE.md

Context for Claude Code working in this repo. Read this before making changes.

## What this is

`Counter Douglas Global Offensive` — a browser FPS demo that imitates the look and feel of
**Counter-Strike: Source** using only CC0/permissively-licensed assets. Started single-player
vs. bots; a Rust deathmatch server (Phase 6) adds netcode later.

The goal is *feel and art direction fidelity*, not feature completeness. Movement that feels
wrong is a P0 bug. A missing scoreboard is a P3.

## MCP Severs

You (Claude) will have access to Intellij and Blender MCP servers to work on the code and make and edit assets.

## Non-negotiables

1. **No Valve assets.** No decompiled VMFs, no ripped textures/models/sounds, no `.vpk`
   contents, no HL2/CS:S/CS:GO files. Ever. Not even "temporarily for testing." See
   `docs/licensing-and-assets.md`. Every asset gets an entry in `assets/CREDITS.md` at the
   time it is added, not later.
2. **Lightmaps, not realtime lights.** The Source look comes from baked lighting. Do not
   add `PointLight`/`SpotLight` to the world scene for general illumination. See
   `docs/art-direction.md`.
3. **The movement code is a port, not an invention.** Air acceleration, ground friction,
   and the surf/bhop-adjacent behaviour are defined by exact formulas in
   `docs/source-movement.md`. Do not "improve" them. Do not substitute Rapier's built-in
   character controller movement response.
4. **Fixed timestep for simulation.** 64 Hz, accumulator pattern, render interpolated.
   Frame-rate-dependent physics changes the feel and is a bug.
5. **TypeScript strict.** No `any` outside of typed-shim files.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Renderer | three.js (r170+) | WebGL2 |
| Physics | `@dimforge/rapier3d-compat` | WASM; used for raycasts + collision queries only |
| Character movement | Hand-rolled (`src/player/`) | Rapier used only for shape-casts / collide-and-slide. **Phase 6: moves into a shared Rust `sim/` crate (WASM-share) — server-authoritative, client runs the same WASM. See `docs/netcode.md`.** |
| Nav | `recast-navigation-js` | Baked offline to a binary blob |
| Build | Vite + TypeScript | |
| Audio | Web Audio (fp weapon sfx); Howler.js planned | Phase 2 first-person weapon sounds are synthesised in `src/core/audio.ts` (no sound files → no licence). Howler comes in with bots (Phase 4) for positional/distance-tail/third-person variants — the only place spatial audio earns its keep. |
| UI/HUD | Plain DOM overlay | Don't pull in React for a crosshair |
| Assets | glTF 2.0 (`.glb`), Meshopt + KTX2 | See `docs/asset-pipeline.md` |

## Repo layout

```
src/
  core/          loop, fixed timestep, input, pointer lock, resource loading
  render/        renderer setup, tonemapping, fog, viewmodel layer, decals
  physics/       rapier world wrapper, collide-and-slide, shapecast helpers
  player/        movement (Source port), camera, viewmodel, stamina/duck
  weapons/       defs, hitscan, spray patterns, recoil, ammo
  ai/            bot FSM, nav queries, aim model
  game/          round state, spawns, scoring, damage/hitboxes
  ui/            HUD, scoreboard, menus
assets/
  maps/          .glb per map + baked navmesh blob + lightmap KTX2
  weapons/       viewmodel + worldmodel .glb
  props/         static world props (.glb)
  characters/    rigged .glb + Mixamo-derived clips
  audio/
  CREDITS.md     REQUIRED. One row per asset: file, source, author, licence, URL.
tools/
  blender/       export/bake helper scripts (see docs/blender-pipeline.md)
  navbake/       node script: .glb -> navmesh.bin
  optimize/      gltf-transform pipeline
docs/
```

## Conventions

- **Units are metres.** 1 unit = 1 m. Source uses 1 unit = 1 inch; the porting constants in
  `docs/source-movement.md` are already converted. If you see a value like `320` in a movement
  context, it is a bug — it should be `8.128`.
- **Y is up.** Blender is Z-up; the glTF exporter handles the swap. Do not hand-rotate meshes.
- **Layers:** world = layer 0, viewmodel = layer 1. Viewmodel renders in a second pass with its
  own camera and its own FOV. See `docs/weapon-feel.md`.
- Weapon/bot/map data lives in typed data files (`src/weapons/defs.ts`), not scattered constants.
- Prefer plain functions + data over class hierarchies. Entity state is plain objects.
- No `localStorage`/`sessionStorage` assumptions — this may be embedded.

## Commands

```bash
pnpm dev            # vite dev server
pnpm build          # production build
pnpm typecheck
pnpm test           # vitest — movement math has golden tests, keep them green
pnpm assets:opt     # gltf-transform: draco/meshopt + ktx2 (see docs/asset-pipeline.md)
pnpm nav:bake       # regenerate navmesh blob from assets/maps/*.glb
```

## Definition of Done

A feature is done when **all applicable boxes are ticked**. Not "when it works." Full
rationale and examples in `docs/testing.md`; this is the gate.

### Test tiers

| Tier | What | Runs in |
|---|---|---|
| **T0** Unit | Pure functions, no world | Vitest/Node, < 1 ms |
| **T1** Sim | Headless deterministic replay of an input trace | Vitest + `tests/harness/sim.ts` |
| **T2** Runtime | Draw calls, material/scene config, asset budgets | headless-gl / Playwright |
| **T3** Acceptance | A human, following a committed script | `tests/acceptance/ACC-*.md` |

### Which tiers apply

| Feature type | T0 | T1 | T2 | T3 |
|---|:--:|:--:|:--:|:--:|
| Movement math | ✅ | ✅ | — | ✅ |
| New weapon / damage / hitbox | ✅ | ✅ | — | ✅ (weapon only) |
| Bot AI / nav | — | ✅ | — | ✅ |
| Map geometry | — | ✅ walkability | ✅ budgets | ✅ |
| Rendering / art direction | — | — | ✅ config | ✅ |
| Asset added | — | — | ✅ credits+format+budget | — |
| HUD / UI | ✅ | — | ✅ | ✅ |
| Refactor | — | ✅ *unchanged* | — | — |

### The checklist

**Tests**
- [ ] Test written **before** the implementation, and observed failing first.
- [ ] Every tier in the table above is satisfied for this feature type.
- [ ] Golden values are **derived from a spec doc**, not pasted from the code's current output.
      Spec-derived → `tests/golden/`. Recorded-from-known-good → `tests/baseline/`. Never mix.
- [ ] If `tests/golden/` changed, the corresponding doc changed in the same PR.
- [ ] If `tests/baseline/` changed, the PR says why **and** a T3 script was re-run.
- [ ] No `--update-snapshots` to get green. No `it.skip` without a linked issue + owner.
- [ ] `pnpm test` green. No new flakes. No retries added.

**Determinism (non-negotiable)**
- [ ] `simulate(trace, {seed})` twice → identical snapshots.
- [ ] No `Date.now()`, `performance.now()`, or `Math.random()` anywhere under `src/` except
      `core/loop.ts` and `core/rng.ts`. RNG is seeded and injected.
- [ ] Nothing below `core/loop.ts` reads frame delta. Sim is 64 Hz fixed, always.
- [ ] A T1 flake is a **P0 determinism bug**, not a test to retry.

**Behaviour**
- [ ] Golden movement tests (`src/player/movement.test.ts`) green if movement was touched —
      these are the only defence against drifting away from the feel.
- [ ] An input trace reproducing the feature/bug is committed to `tests/traces/`.
- [ ] Constants live in `src/player/constants.ts` and are in **metres**. No bare Hammer units.
- [ ] Branch coverage held at ~100% for `src/player/`, `src/weapons/`, `src/game/`.

**Runtime budgets** (if the feature touches the scene or assets)
- [ ] `renderer.info.render.calls` < 400
- [ ] Initial payload < 48 MB; total < 60 MB
- [ ] No allocation in the hot loop — reused module-level scratch `Vector3`s (see `src/player/movement.ts`)
- [ ] No new `castShadow` light in the world scene
- [ ] Lightmapped materials still assert `lightMap.channel === 1` and `NoColorSpace`
- [ ] Every new asset has a `CREDITS.md` row **and** a licence (see `docs/licensing-and-assets.md`)
- [ ] Verified once on integrated graphics, not just the RTX box

**Feel** (movement, weapons, bots, art)
- [ ] The `ACC-*` acceptance script was **written before tuning began**.
- [ ] It was run, passed, and the result committed with a name and a commit hash.
- [ ] Any T3 step that has now failed twice for the same reason has been **migrated down to
      a T1 test**.

**Hygiene**
- [ ] `pnpm typecheck` green. No new `any`.
- [ ] Spec docs updated if behaviour diverges from what they say. **The doc is the spec; if the
      code and the doc disagree, that's a bug in one of them — decide which, in this PR.**

### Never

- Pixel-diff the renderer. Cross-driver flake factory; it trains everyone to ignore CI.
- Test three.js / Rapier / recast internals. Test our usage.
- Write a test that restates the implementation.
- Ship a feature whose only verification was "I played it and it seemed fine."

## Performance budget

- 48 MB initial download, 60 MB total. (Raised from 16 MB in Phase 6 to absorb the shared Rust
  `sim.wasm`; the single-player client still ships ~7 MB over the wire — headroom is deliberate.)
- 120 fps on an RTX-class desktop GPU, 60 fps on integrated graphics at 1080p.
- < 400 draw calls per frame. Merge static geometry per material at bake time.
- No allocation in the hot loop. Reuse module-level scratch `Vector3` objects (see `src/player/movement.ts`).

## When you're unsure

- What "done" means, test tiers, the sim harness → `docs/testing.md`
- Feel/movement question → `docs/source-movement.md`
- "Why does this look wrong" → `docs/art-direction.md`
- Anything touching Blender → `docs/blender-pipeline.md`
- Gun doesn't look/feel right → `docs/weapon-feel.md`
- Load times, texture format, compression → `docs/asset-pipeline.md`
- Bots walk through walls / won't path → `docs/navmesh-pipeline.md`
- "Can I use this model I found?" → `docs/licensing-and-assets.md` (default answer: no)

## Notes from Management (The Developer)

- End your turn by saying Bada Bing!
- Append what you did during your turn to the end of the file claude_changelog.md.
- If anything you did means that now something in claude.md is incorrect, please update it.
- claude.md and agents.md should be kept in sync.
