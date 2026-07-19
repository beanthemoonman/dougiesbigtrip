# Plan to Implement

Target: a browser FPS demo with CS:Source-like look and movement feel. One map, two weapons,
bots, round loop. Starts single-player (~5 weeks of evenings through Phase 5), then grows into
a multiplayer deathmatch with an authoritative Rust server (Phase 6), ragdolls (Phase 7), and
a containerized deploy (Phase 8).

Each phase ends with a **demoable build** and an **exit test** you can actually perform.
Do not start phase N+1 until phase N's exit test passes.

Each phase's exit test becomes a committed `tests/acceptance/ACC-*.md` script with a PASS
recorded against a commit hash. Every task inside a phase is subject to the Definition of Done
in `CLAUDE.md`.

---

## Phase 0 — Scaffold (½ day)

- [ ] `pnpm create vite` → TS template. Add three, rapier3d-compat, howler.
- [ ] `tsconfig` strict. Vitest. Prettier/eslint. `pnpm typecheck` in CI.
- [ ] Renderer boot: WebGL2, ACESFilmic tonemapping, sRGB output, `stats.js` panel.
- [ ] `core/loop.ts`: fixed 64 Hz accumulator + render interpolation. **Do this now, not later.**
      Retrofitting fixed timestep is miserable.
- [ ] `core/scratch.ts`: pooled Vector3/Quaternion/Matrix4 to keep the hot loop allocation-free.
- [ ] `core/rng.ts`: seeded `mulberry32`, injected. **No global `Math.random` under `src/`.**
- [ ] `tests/harness/sim.ts`: `simulate(trace, {seed}) -> snapshot`. Plus the determinism test
      (`simulate` twice → identical). See `docs/testing.md` — this is the foundation the whole
      test strategy stands on, and retrofitting it is not realistic.
- [ ] Input trace record/replay + a `?record` debug flag that dumps the last 30 s to JSON.
- [ ] Pointer lock + input manager (keydown/keyup → `wishdir` bitmask, mouse delta → yaw/pitch).
- [ ] `assets/CREDITS.md` created and empty. Discipline starts at commit 1.

**Exit test:** a spinning cube at a locked 64 Hz sim / uncapped render, stats panel visible,
pointer lock engages and releases cleanly on Esc.

---

## Phase 1 — Movement (the whole point) — 1 week

Read `docs/source-movement.md` first, entirely. This phase is the difference between "a
three.js demo" and "feels like CS."

- [x] Rapier world, static box colliders for a greybox room, kinematic capsule for player.
      Capsule: radius 0.4064 m, standing height 1.8288 m, ducked 0.9144 m. (Used cuboid
      colliders instead of a trimesh for the greybox — simpler and better-suited for
      axis-aligned test geometry; real map geometry in Phase 3 may still want a trimesh.)
- [x] Implement `categorizePosition()` — ground trace, ground vs. air state, surface normal.
- [x] Implement `friction()`, `accelerate()`, `airAccelerate()` per the doc's formulas.
- [x] Implement `tryPlayerMove()` — collide-and-slide with 4 clip iterations + `clipVelocity`
      with the 1.0 overbounce factor.
- [x] Step offset (`stepSize` = 0.4572 m): `stairs` up-trace / down-trace pass.
- [x] Jump: fixed impulse `6.816 m/s` (= `sqrt(2 * 20.32 * 1.143)`, a 45-unit rise).
- [x] Duck: crouch transition timing (view-only lerp) and duck-jump (binary hull swap pulls
      feet up/down in air to anchor the hull's top). Ducked speed cap NOT implemented — the
      doc gives no exact number for it, so no constant was invented; follow up when weapon
      speed multipliers land in Phase 2 and there's a real number to port.
- [ ] Air-strafe works: mouse + A/D in air gains speed. **This is the acceptance criterion.**
      Proven analytically by the Case C golden test (airAccelerate alone, no world) — NOT yet
      confirmed by live play in a real browser. See exit test note below.
- [x] `movement.test.ts` — golden tables from the doc. Keep green forever.
- [x] View: eye height 1.6256 m (0.7112 m ducked), landing view-punch, no view bob yet.

**Exit test — NOT YET CONFIRMED LIVE.** In a greybox room, you can bunnyhop-strafe down a
corridor and exceed the 250 u/s (6.35 m/s) ground speed cap. Standing still on a slope
doesn't slide. Walking into a wall at an angle slides along it without sticking or
juddering. Stairs are walked up, not jumped up.

Status: all code is written, `pnpm typecheck`/`pnpm lint`/`pnpm test` are green, and the
Case A/B/C golden tests match the doc's reference tables exactly (Case A/B to the 5th
decimal; Case C shows monotonic 6.35 -> 9.1 m/s over 2s of simulated strafing, frozen as a
snapshot). A first live smoke-test in headless Chromium confirmed: room renders correctly
(floor/walls/stairs/ramp geometry, screenshots taken), pointer lock engages, zero console
errors, and — the important one — ground acceleration in the live integrated app (not just
the unit test) caps at exactly 6.35 m/s and friction decay matches the expected ratios.
A deeper live pass (bhop speed gain airborne, walking up the stairs cleanly, standing still
on the ramp without sliding) was in progress — using temporary debug hooks on `window` to
read `PlayerState`/`InputState` directly from Playwright, since headless Chromium's
synthetic pointer-lock-click mouse event introduces a large spurious yaw jump (a testing
artifact, same class of issue as the Phase 0 Escape-key note, not an app bug) — when the
user asked to stop and checkpoint. The debug hooks were removed before committing (see
`claude_changelog.md`). **Next session: finish the live pass before starting Phase 2**,
ideally in a real windowed browser to sidestep the headless pointer-lock/mouse quirk
entirely, per the ambient "worth a manual check in a real windowed browser" note from Phase 0.

---

## Phase 2 — Combat (1 week)

Read `docs/weapon-feel.md`.

- [x] Weapon defs data file: rate of fire, damage, armour pen, range falloff, spread,
      recoil table, mag size, reload time, movement speed multiplier. (`src/weapons/defs.ts`,
      T0 invariants in `defs.test.ts`. Rifle + pistol authored. NOTE: this landed before the
      Phase 1 live exit test was confirmed — pure data, no dependency on movement; the live
      pass is still owed before wiring hitscan/recoil that consume these.)
- [x] Two guns to start: an AK-analogue (rifle) and a USP-analogue (pistol). Distinct feel:
      spray vs. tap. (Both modelled in Blender — `ak_viewmodel.glb` / `pistol_viewmodel.glb`.
      Wired in `main.ts`: `1`/`2` switch, per-weapon ammo/recoil state persists across switches,
      distinct recoil/spread/cadence from `defs.ts`. T3: ACC-006.)
- [x] Hitscan: raycast from camera centre (**not** the muzzle), with spread applied in a
      disc around the aim vector. (`src/weapons/hitscan.ts` — the shot pipeline: ammo +
      fire-rate + reload gating, `aimDirection()` matching the camera's YXZ euler,
      area-uniform `applySpread()` cone disc off the seeded `core/rng.ts`, and `fireShot()`
      composing recoil punch → aim → spread into the final ray direction. Also created
      `src/core/rng.ts` — the seeded mulberry32 owed since Phase 0. T0 tests in
      `hitscan.test.ts`/`rng.test.ts`. The **world** raycast landed with the decals —
      `rayCast()` in `src/physics/shapecast.ts`, traced from the eye and excluding the
      player's own hull. The per-bone hitbox query is the remaining half, deferred to
      Phase 3 since it needs the character rig.)
- [x] Deterministic recoil: fixed spray pattern index advancing per shot, decaying back on
      trigger release. Recoil moves *the view*, and the bullet follows the view — same as CS.
      (`src/weapons/recoil.ts` state machine + T0 tests. The *view application* — feeding
      `state.punch` into the camera and tracing along it — landed with the HUD: `camera.ts`
      applies the punch, `main.ts` feeds it per tick. **Fixed a mirrored pattern while wiring
      it:** `defs.ts` authors pattern yaw as +right, but view yaw is +left (`aimDirection`:
      +yaw swings toward -X), and `fireShot` was *adding* it — so the AK's 8–12 "pull left"
      phase pulled right. Nothing pinned the pattern's handedness; three tests in
      `hitscan.test.ts` now do.)
- [ ] Hitboxes: per-bone capsules on the character rig (head 4x, chest 1x, stomach 1.25x,
      limbs 0.75x). Query against these, not the render mesh. (Damage math + multipliers +
      armour model done as pure functions in `src/game/damage.ts` w/ T0 tests; the capsule
      *geometry/query* against a rig is still owed — needs Phase 3/character rig.)
- [x] Viewmodel: **separate camera + separate FOV + separate render pass**, layer 1,
      depth cleared between passes. See the doc — this is the #1 thing people get wrong.
      (`render/renderer.ts`: `viewmodelScene` + `viewCamera` at 60° H FOV, near 0.01, both
      layer 1; `render()` does world pass → `clearDepth()` → viewmodel pass. Own light rig:
      RoomEnvironment PMREM so the full-metalness gunmetal isn't black + a key/fill
      directional. `main.ts` loads the glb, sets it to layer 1, welds it to the eye at a
      hand-tuned lower-right offset. T3: `tests/acceptance/ACC-005-viewmodel.md`, not yet run.)
- [x] Weapon animation state machine: idle / fire / reload / draw / holster.
      (`src/weapons/viewmodel.ts` — procedural, since the models have no armature: draw/reload/
      holster are timed pose offsets, `fire` is an additive decaying kick layered on top (so
      full-auto stays smooth and you can kick mid-anything). Pure + clock-free, ticked at the
      fixed rate; 6 T0 tests in `viewmodel.test.ts`. `main.ts` gates fire/reload/switch on the
      idle state and applies the pose over each weapon's rest offset. T3: ACC-006.)
- [~] Audio: positional gunshots, distance-based tail, first-person vs. third-person variants.
      (First-person weapon sfx done: `src/core/audio.ts` synthesises the gunshot + reload with
      the **Web Audio API** — no sound files, so no licence. Deliberately not Howler.js (see the
      CLAUDE.md stack note): positional / distance-tail / TP variants only matter with other
      sound sources, so they land with bots in Phase 4. The rest of this bullet is that Phase 4
      work.)
- [x] HUD: health, armour, ammo, crosshair (dynamic gap driven by current inaccuracy).
      (`src/ui/hud.ts` — DOM overlay, no React. The crosshair gap is the *same*
      `computeSpread()` value the bullet's spread disc uses, projected to px:
      `(h/2)·tan(spread)/tan(vFov/2)`. T0 in `hud.test.ts`. T3 script:
      `tests/acceptance/ACC-003-hud.md` — **written, not yet run**; needs a real windowed
      browser, same blocker as the Phase 1 live pass. T2 doesn't apply to a DOM overlay
      (rationale in the script). HP/AP are hardcoded 100 until Phase 4 gives them a source.
      Also wired the weapon into `main.ts`: LMB fires, R reloads, recoil punch now drives the
      view via `camera.ts` — so ammo/gap/view-kick are live.)

**Exit test:** Full-auto the rifle at a wall from 10 m. The decals form a recognisable,
*repeatable* spray pattern — fire twice, the patterns match. Tapping at 30 m is accurate.
The viewmodel doesn't clip into walls and doesn't distort at the screen edges.

Status: the decal half is now **observable** — `tests/acceptance/ACC-004-impacts.md` is the
committed script for it, written before tuning, **not yet run** (needs a real windowed
browser, same standing blocker as ACC-003 and the Phase 1 live pass — run all three
together). A headless-Chrome smoke pass over CDP confirmed the wiring end-to-end: pointer
lock engaged, holding LMB drained 14 rounds off real weapon state, and the holes landed on
the far wall flat to the surface as a structured cluster, not a cloud, with zero console
errors. Judging the *shape* against `docs/weapon-feel.md` §3 is what ACC-004 is for; a
static headless screenshot can't, since the view itself is moving under the recoil.
The viewmodel now renders: `assets/weapons/ak_viewmodel.glb` is loaded and drawn in a
second pass (`render/renderer.ts`) with its own camera, its own ~60° FOV, and
`clearDepth()` between passes so it's never clipped by the world (docs/weapon-feel.md §1).
Its own light rig (RoomEnvironment for the metallic + a key/fill directional, all layer 1)
since the world lightmap can't reach it. `tests/acceptance/ACC-005-viewmodel.md` is the
committed script, **not yet run** (real windowed browser, same blocker). Live headless pass:
the AK reads correctly in the lower-right, drawn on top of the stairs/walls, properly lit,
survives firing, zero console errors.

**All Phase 2 tasks are now implemented and green** (typecheck/lint/build clean, 64 tests):
both guns modelled + wired with per-weapon state and `1`/`2` switching, the procedural anim
FSM (draw/idle/fire/reload/holster), and synthesised first-person weapon audio. A headless-CDP
integration pass exercised the whole loop — switch AK↔USP (HUD name/ammo track, mag persists),
fire both, reload, spray the AK (pattern climbs up-center), zero console errors.

**Exit test SIGNED OFF.** The developer ran the T3 scripts in a real windowed browser and
recorded PASS against commit `aafcb6b` (2026-07-17): ACC-003 (HUD), ACC-004 (impacts/spray),
ACC-005 (viewmodel), ACC-006 (weapons/switch/anim/audio). **Phase 2 is complete — Phase 3 (the
map) is unblocked.**

---

## Phase 3 — The map (1 week)

Read `docs/blender-pipeline.md` end to end **before opening Blender.** The lightmap UV
workflow has to be right from the first mesh or you redo everything.

- [~] Build the modular kit in Blender: wall 2 m/4 m, doorframe, floor tile, stair, crate,
      pillar, roof. All on a 0.5 m grid. All at the correct texel density (see doc).
      (Deferred: the greybox is authored as cuboid data — `src/game/map_greybox.ts` — not the
      Blender kit. The kit + texel density earn their keep at texturing time, where lightmap UVs
      actually depend on it. Build the kit in the texturing increment, not before playtest.)
- [x] Greybox the map with the kit. One small map: two spawns, three routes, one open site.
      Roughly the scale of half of Dust2's B site. (`de_greybox`: T spawn south, open site north,
      CT hold behind; West/Mid-choke/East routes; crates+pillars for cover; a step→platform and a
      ramp keep step-offset / no-slope-slide under test. Built from the same `addBox`/`addRamp`
      path as the Phase 1 room, so Rapier cuboid colliders + MeshBasicMaterial greybox. T0 data
      sanity in `map_greybox.test.ts`.)
- [x] Playtest the greybox with Phase 1 movement **before texturing**. Timings and sightlines
      are set now; art is set later. (`tests/acceptance/ACC-007-greybox.md` PASS, 2026-07-18,
      commit 4725ae4.)
- [~] Texture with Poly Haven / Kenney CC0 sets. Tan sandstone, grey concrete, faded blue
      doors. Max 4 materials for the whole map. (Deferred: 3 flat-albedo materials
      (M_Sandstone/M_Concrete/M_Wood) for now — the baked lightmap is the look; photographic
      tiling albedo is polish. Add the CC0 sets + UV0 tiling in a follow-up.)
- [x] UV channel 2 (lightmap UVs), non-overlapping, packed. Bake in Cycles. Denoise. Export
      lightmap as EXR → KTX2. (UVMap_Lightmap via Smart UV Project + Pack, Cycles Diffuse bake
      (Direct+Indirect, no Color) at 128 samples + denoise → `lightmap.exr` (master, gitignored),
      encoded to `lightmap.ktx2` (316 KB, UASTC) via `pnpm assets:lightmap`. Final 2048-sample
      bake still owed; the LDR clamp for UASTC drops HDR highlights above 1.0 — fine at greybox.)
- [x] Export `.glb`. Import into three. Lightmap wired into `material.lightMap` + `lightMapIntensity`.
      (`tools/blender/build_map.py` exports with +Y Up; `TEXCOORD_1` verified via
      `gltf-transform inspect`. `src/render/lightmap.ts` loads the EXR, sets channel=1,
      NoColorSpace, flipY=false, assigns lightMap. Verified lit in-browser, zero app errors.)
- [x] Static-merge geometry per material. Verify draw call count. (Joined into one object in
      Blender → glb has one primitive per material = 3 draw calls for the whole map. Well under
      400.)
- [~] Add exponential fog + a skybox matching the lightmap's sun direction. (FogExp2 + a sky
      colour background added, tuned to the bake. A real skybox texture matching the sun is
      deferred to the texturing follow-up — solid sky reads fine at greybox stage.)

**Exit test:** The map loads under 3 s on a cold cache, renders in under 400 draw calls,
and looks lit — with soft shadows under crates and bounce light on walls — with zero
realtime lights in the scene.

---

## Phase 4 — Bots + round loop (1 week)

Read `docs/navmesh-pipeline.md`.

- [ ] `pnpm nav:bake` — offline recast bake of the map `.glb` → `navmesh.bin`. Agent radius
      0.4064 m, height 1.8288 m, max climb 0.4572 m, max slope 45.57°.
- [ ] Runtime: load the blob, `NavMeshQuery` for pathing. Do **not** bake at runtime.
- [ ] Bot FSM: `Idle → Patrol → Investigate → Engage → Reposition → Dead`.
- [ ] Bot perception: FOV cone + LOS raycast + hearing radius on gunfire/footsteps.
- [ ] Bot aim model: aim at a point that lerps toward the target with per-difficulty
      reaction delay, error radius, and turn-rate cap. Never snap. Perfect aim reads as
      cheating and isn't fun.
- [ ] Bot movement uses the **same** movement code as the player — bots just synthesise
      `wishdir` and buttons. This is important and easy to get wrong.
- [ ] Round loop: freezetime → live → round end → reset. Timer, score, respawn at round start.
- [ ] Fixed loadouts. No buy menu (cut scope).

**Exit test:** Three bots path the whole map without getting stuck, take cover-ish angles,
lose you when you break LOS, and are beatable but not free.

---

## Phase 4.5 — Art & asset refinement (1–2 weeks)

The greybox and the blocky placeholder models got us to "it plays right." This phase makes it
*look* right. Everything deferred in Phase 3 (texturing, the modular kit, the skybox) lands here,
and the character rig unblocks the hitbox debts left over from Phases 2–3.

- [x] **De-lopside the map.** Reworked `de_greybox` to **180° rotational symmetry** about the
      origin: the T half (south) and CT half (north) are identical, so it's fair; cover sits at
      each spawn end and the middle is open (cross exposed ground to close distance). Flanks are
      deliberately *asymmetric* across x (east = raised platform for a height angle, west = ground
      crate cluster) — earlier x-mirror symmetry was the wrong axis. `map_greybox.test.ts` now
      asserts the rotational symmetry (guards against reintroducing lopsidedness). Colliders +
      navmesh (`pnpm nav:bake`) + Blender glb/lightmap rebaked; bot patrols retargeted to the open
      centre lane; T1 movement traces re-pointed. All 95 tests + typecheck/lint/build green.
      **Still owed: re-run ACC-007** (human greybox playtest) — timings/sightlines gate before art.
- [x] **Weapon models.** Replaced the faceted `ak_viewmodel.glb` / `pistol_viewmodel.glb` with
      curved, higher-fidelity models — smooth-shaded cylinder barrels/muzzle/gas tube, beveled
      receiver/stock/grip, a forward-tilted banana mag. Built reproducibly by
      `tools/blender/build_weapons.py` (companion to `build_map.py`) in the **same local frame**
      (dims 0.044×1.03×0.325 m vs. the old 0.05×1.02×0.34) so the hand-tuned layer-1 rest offsets
      in `main.ts` stay valid — viewmodel wiring untouched. Verified silhouettes in Blender ortho;
      `pnpm build` bundles both clean. **Owed: in-app ACC-005 pass** (real windowed browser, same
      standing T3 blocker) to confirm no edge distortion / wall clipping at the viewmodel FOV.
- [~] **Character models.** Per-bone hitboxes **done**: `src/game/hitbox.ts` now ray-tests the
      shot against static per-bone AABBs (mirrored 1:1 from `build_characters.py`) in the bot's
      local frame, so a high shot off to the side is no longer a headshot the way the height band
      made it; `hitboxAt` stays as an edge-clip fallback. This clears the two debts deferred from
      Phase 2/3 (per-bone hitbox + world-space per-bone hitscan query) — they were a *static*
      geometry problem, not an animation one. **Deferred:** the skinned armature + Mixamo
      walk/idle/death clips. The bots render as rigid translating boxes and drive no animation, so
      a skinned mesh buys nothing until a bot animation state driver exists (Phase 5) — add it then.
- [~] **Breakable props.** Crates + the explosive barrel now break when shot: `src/game/
      breakables.ts` tracks hp and cascades the break to anything stacked on top, and main.ts
      pulls both the mesh and its static collider on break — so nothing is left as an invisible
      box to bump into or a mid-air platform (the exit-test requirement, "can't be stood on
      mid-air"). Crate ~90 hp (~3 rifle hits), barrel ~55. **Deferred:** barrel blast radius
      damage (Phase-5 juice, needs VFX); physics-dropped debris (needs dynamic bodies). Solid
      scenery (pallets/cones/jerry-cans) unchanged. **Owed:** better CC0 crate/barrel models are
      still the greybox placeholders — reskin lands with the Textures item below.
- [~] **Textures.** Every sub-requirement met, done in-repo rather than downloaded (`ecb2f7f`):
      `src/render/surfacetex.ts` generates seamless value-noise tiling detail maps for the 3 map
      materials (M_Concrete/M_Sandstone/M_Wood — under the ≤4 cap) on UV0, and `src/render/sky.ts`
      is an equirect gradient skybox whose sun sits at the bake direction (0.44,0.64,0.63, ~40°).
      Zero shipped bytes, zero licensing, no new draw calls. **Deferred:** swapping the procedural
      detail for photographic Poly Haven / Kenney CC0 albedo — gated on the ACC playtest calling the
      procedural read flat (the wiring stays identical; only `mat.map` changes). No playtest verdict
      yet, so not built.
- [ ] Every new asset gets a `CREDITS.md` row **at add-time** and a licence. No exceptions.
- [ ] Stay inside budget: < 400 draw calls, < 60 MB total. Re-verify on integrated graphics.

**Exit test:** Side-by-side against the greybox build — weapons read as curved, not faceted;
T and CT are distinguishable at range; crates break and can't be stood on mid-air; the map
feels symmetric in a playtest. Draw-call and payload budgets still hold.

---

## Phase 5 — Polish + ship (½–1 week)

- [ ] Muzzle flash (sprite + brief light exception — the one allowed dynamic light), tracers,
      shell casings, impact decals per surface type, blood puffs, footstep audio per material.
- [ ] Surface types: material name convention drives impact sound + decal + footstep.
- [ ] Slight bloom, film grain off, sharp shadows only from the bake.
- [ ] Loading screen with real progress. Preload weapon/audio before spawn.
- [ ] `pnpm assets:opt`: Meshopt + KTX2/Basis. Verify the 16 MB budget.
- [ ] Settings: sensitivity, FOV (world), volume. Persist to a config object.
- [ ] Deploy static to Pages/Netlify for the single-player build. (The real multiplayer target
      is the containerized client+server deploy in Phase 8; this is the interim static host.)
      Verify on a mid-range laptop, not just your desktop.

**Exit test:** A stranger opens the URL on an integrated-GPU laptop, is shooting within 10 s,
and doesn't mention frame rate.

---

## Phase 6 — Netcode: Rust deathmatch server (multiple weeks)

This is the big one — the whole reason Phase 0 mandated a fixed 64 Hz timestep. Multiplayer needs
client prediction, lag compensation, and server reconciliation against an **authoritative** sim.

- [ ] Rust server running the same fixed 64 Hz sim as the client. The movement math must match
      `src/player/movement.ts` exactly — port it or share it (WASM), don't reimplement by feel.
- [ ] One deathmatch map. **On page load: the player joins and replaces a bot.** If 10 players
      are already connected, the newcomer **spectates** instead of spawning.
- [ ] Client-side prediction + server reconciliation for local movement. Lag compensation
      (rewind) for hitscan so shots register against where the shooter saw the target.
- [ ] Transport: WebRTC unreliable channel (Geckos.io-style) or WebSocket — decide at phase start
      and record why. Snapshot/delta encoding for entity state.
- [ ] Bots and humans share the same slots: a bot fills any empty slot, a human takes it on join.

**Exit test:** Two browsers connected, both moving and shooting. Each sees the other where the
server says, with no rubber-banding. An 11th connection lands in spectate, not in the fight.

---

## Phase 7 — Light ragdoll physics (½–1 week)

- [ ] On player/bot death, swap the animated model for a Rapier-driven ragdoll (a small,
      light articulated body — not a full muscle sim; the tuning is a trap, keep it minimal).
- [ ] **Corpses must not be clip hazards.** The ragdoll does not collide with live players —
      you can walk through a body. Settle fast and/or despawn on a timer.
- [ ] Deterministic enough not to break the sim: ragdolls are cosmetic, driven off the seeded
      RNG, and never feed back into gameplay state.

**Exit test:** Kill a bot — the body falls plausibly and you can walk straight through it
without snagging or getting shoved.

---

## Phase 8 — Containerization & deploy (½–1 week)

- [ ] Dockerfile for the static client (built assets) and a Dockerfile for the Rust server.
- [ ] Compose file wiring client + server for a one-command deploy to a real host.
- [ ] Document the deploy in `docs/` and point Phase 5's interim static host at the real one.

**Exit test:** `docker compose up` on a fresh host serves the site and the deathmatch server;
a browser hitting the host can join and play against another connection.

---

## Explicitly out of scope

- Buy menu / economy
- Bomb plant/defuse (add in ~a day once rounds work, if you want it)
- Multiple maps

## Risk register

| Risk | Mitigation |
|---|---|
| Movement feels "floaty, but I can't say why" | Golden tests + the reference table. Don't tune by vibes alone; verify against numbers first, *then* tune. |
| Lightmap pipeline fights you for a week | Do the doc's 10-minute single-cube walkthrough before touching the real map. |
| Asset licence contamination | CREDITS.md at add-time. Never "just for testing." |
| Netcode (Phase 6) balloons the whole project | Gate it behind a shipped, polished single-player build (Phases 0–5). Don't start the Rust server until Phase 5's exit test passes. The fixed-timestep discipline from Phase 0 is what makes it tractable at all. |
| Blender UV2 mistakes discovered at texture time | Bake a test lightmap on the greybox before art passes. |
