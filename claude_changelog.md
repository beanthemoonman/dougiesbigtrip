# Claude Changelog

A running log of what Claude Code did in this repo, appended to at the end of each turn.

---

## 2026-07-23

- **Phase 16.1 — Match config type + rounds-to-win.** Extended `src/game/round.ts`:
  - Added `MapId` type (`'de_douglas'`), `MatchConfig` interface extending `RoundConfig` with `map`, `botCount`, `roundsToWin`.
  - Added `DEFAULT_MATCH` (16 rounds to win, 6 bots), `LIMITS` bounds constant, and `validateMatchConfig()` with per-field error messages. Used by SP, server, and admin endpoint — one implementation, three callers.
  - `RoundState` gains `matchOver` (boolean) and `matchWinner` ('T'|'CT'|null). `tickRound` now takes `MatchConfig` and emits `'match-over'` event when a side's score reaches `roundsToWin`. Match-over resets scores/round to initial values after `endDelay`.
  - `RoundEvent` union adds `'match-over'`.
  - **main.ts integration:** Removed the entire manual match clock (`MATCH_TIME`, `matchClock`, `matchOver` local, `matchRestartTimer`, `startNewMatch()`). `tickRound` now called unconditionally (no `matchOver` guard) with `DEFAULT_MATCH`. All remaining `matchOver` references point to `round.matchOver`. Banner text reads `round.timer` for match-over countdown (was `matchRestartTimer`).
  - **Tests (T0):** 9 new tests in `round.test.ts` — match-over emission, single-fire, score/round reset, validator accept/reject paths (botCount bounds, roundsToWin bounds, unknown map, non-integer).
  - `pnpm test` 218 tests green. `pnpm typecheck` / `pnpm build` green.
  - Updated `plan_to_implement.md`: Phase 16 first checkbox ticked (16.1).

- **Phase 16.2 — SP reads config at match start.** 
  - Created `src/game/spawning.ts`: `spawnRing(team, count)` generates N spread positions from CT_SPAWN/T_SPAWN anchors. Preset offsets reproduce exact original 6 positions at count=3 (regression). Scale-out positions for count > 3 extend linearly. T0 tests in `spawning.test.ts` (6 tests: count, regression, Y-consistency, distinctness, z-mirror, determinism).
  - **main.ts:** `botDefs` literal array replaced with `spawnRing('CT', ctCount)` + `spawnRing('T', tCount)` where counts are split from `currentMatchConfig.botCount`. `tickRound` uses `currentMatchConfig` (was `DEFAULT_MATCH`). `currentMatchConfig` seeded from `?bots=N&rounds=N` URL params via `validateMatchConfig`. Hoisted before settings panel for early initialization.
  - **Settings panel:** Extended `createSettingsPanel()` with optional `MatchConfigFields` parameter. Renders "New Match" section with Bot Count (0–10) and Rounds (1–30) sliders + "New Match" button that reloads via URL params. Marked `ponytail: placeholder`.
  - **T3:** Created `tests/acceptance/ACC-022-configuration.md` (6-step script: non-default bot count, max bots, defaults, settings panel UI, match-over at low rounds, invalid config rejection).
  - **Budget T0:** `spawning_budget.test.ts` — max bot count produces correct number of distinct positions.
  - `pnpm test` 227 tests green. `pnpm typecheck` / `pnpm build` green.
  - Updated `plan_to_implement.md`: Phase 16 second checkbox ticked (16.2).

## 2026-07-22

- **Fixed reconnection affecting server game state** (client-side bug). Root cause: the client ran its own independent match clock and round FSM even in networked mode. When a player reconnected, the local `matchClock` (180s) had expired, `startNewMatch()` fired, resetting local `round` to freezetime, which gated movement/live state and showed "FREEZE" banner — while the server was mid-round. Fixed with 7 changes in `src/main.ts`:
  1. Added `F_ALIVE` to import and `serverPhase` variable (mirrors `serverRoundTimeSec`/`serverScore`).
  2. `onSnapshot`: sync `serverPhase` from `s.round.phase`; derive `playerAlive` from own slot's `F_ALIVE` flag in snapshot entities instead of relying on local state.
  3. `onClose`: reset `serverPhase = -1` on disconnect.
  4. Match clock (lines 1248-1256) gated on `!predictor` — only runs in single-player mode.
  5. `tickRound()` gated on `!predictor || matchOver` — skipped in networked mode; `live` derived from `serverPhase === 1 && playerAlive` in networked mode, from local round state in single-player.
  6. `bannerText()`: in networked mode, reads server phase (`serverPhase`) and `serverRoundTimeSec` instead of local `round.phase`/`round.timer`.
  7. Removed `playerAlive = false` from network team-join path — now set authoritatively from snapshot flags.
  - `pnpm typecheck` and `pnpm test` (210 tests) green.

- **Implemented Phase 13 — Asset refinement II: textures & liveliness** (see `docs/plan-phase13-asset-refinement.md`):
  - **13.0 Map textures from Poly Haven.** Downloaded 3 CC0 texture sets via Blender MCP: `concrete_wall_003`, `large_sandstone_blocks`, `brown_planks_05` (2K JPG). Saved to `assets/tex/` and `public/tex/`. Rewrote `src/render/surfacetex.ts`: `applySurfaceTextures()` now loads real textures with procedural fallback; changed to `async`. Updated `main.ts` call site to `await applySurfaceTextures(mapRoot)`. Budget: +3.1 MB, total dist ~14 MB (under 48 MB cap).
  - **13.1 Weapon textures.** Modified `tools/blender/build_weapons.py`: added `_make_noise_image()` (128×128 2-octave value noise) and `_add_detail_texture()` (Image Texture → Mix node → Principled BSDF Base Color at ~8% strength). Each of 5 materials gets a unique-seeded noise map. Rebuilt `ak_viewmodel.glb` (449 KB) and `pistol_viewmodel.glb` (500 KB) with embedded textures. Verified via `@gltf-transform inspect`: `baseColorTexture` present on all materials.
  - **13.2 De-floaty characters.** Modified `tools/blender/build_characters.py`: added `_joint_sphere()` helper and 9 joint spheres (shoulders, elbows, hips, knees, neck) at skeletal pivot positions, skinned to parent bones. Updated `_find_bone()` for joint name mapping. Rebuilt `ct_player.glb` and `t_player.glb` (1566 tris, 405 KB each — up from ~700 tris, under 8K budget).
  - **13.3 More breakables + round-scoped respawn.** Added `resetBrokenBreakables()` pure function to `src/game/breakables.ts` with T0 tests (3 new). Added `restoreBreakables()` to `main.ts`: re-clones broken props from cached `PropTemplate` map, recreates colliders, restores hp/broken flags. Called from `respawn()`. Added 6 more breakable placements (4 barrels, 2 crates). Updated `placeProps` return type to include `templates` map.
  - **13.4 Map life: set-dressing.** Added `makeSign()`: canvas-textured quads with orange-bordered metal-plate signage. Placed "SPAWN" signs at T and CT spawn areas. Extended `PROP_PLACEMENTS` tuples with optional `tintHex` for per-placement colour variation (barrels get different rust shades, crates get wood tone variation). Added 5 extra scenery props (cones, jerry can). Updated `placeProps` and `restoreBreakables` to apply tints.
  - **Docs & tests.** Created `docs/plan-phase13-asset-refinement.md` (decisions, increment plan, Poly Haven selections). Wrote ACC-021 acceptance script (`tests/acceptance/ACC-021-phase13-assets.md`). Updated `CREDITS.md` with 3 new Poly Haven texture entries. Updated `plan_to_implement.md`: all Phase 13 boxes ticked, status recorded.
  - **Build.** `pnpm typecheck` / `pnpm build` / `pnpm test` all green (210 tests). Dist: 14 MB (under 48 MB cap).

- **Implemented Phase 10 — Movement & interaction tuning** (see `docs/plan-phase10-movement-tuning.md`):
  - **10.0 Residual creep → dead stop.** The friction dead zone (`speed < 0.1` → return without zeroing) left a perpetual residual velocity anywhere in (0, 0.1) m/s after friction dropped below the floor. Added a dead-stop check in `tickMovement` (TS `movement.ts`, Rust `movement.rs`) that zeroes horizontal velocity when on ground, no wishdir input, and speed < 0.1 m/s. The pure friction function is untouched (golden tests still match Source behaviour); creep is eliminated at the movement level only when the player has released all keys. `source-movement.md` §Friction updated to document the friction floor and the dead-stop addition. T0 tests in `movement.test.ts` + `movement_wasm.test.ts`; T1 dead-stop world test in `movement_map.test.ts`; Rust creep tests in `movement.rs`.
  - **10.1 Walk (Shift) + crouch-walk speed cap.** Added `Buttons.WALK` (bit 8) to both `input.ts` and `input.rs`. ShiftLeft/ShiftRight map to WALK in `KEY_TO_BUTTON`. Added `WALK_SPEED_SCALE` (0.52) and `DUCK_SPEED_SCALE` (0.34) constants. In `tickMovement`, `wishspeed` is scaled by 0.52 if WALK held & on ground, and by 0.34 if DUCK held & on ground (both stack multiplicatively). Shift/duck keys are swallowed via the existing preventDefault logic (keys in KEY_TO_BUTTON are catch-all blocked while pointer-locked). `source-movement.md` updated with duck scale line. T0 convergence tests in TS + WASM + Rust for walk-only, duck-only, and walk+duck (combined walk+duck ~1.12 m/s oscillates with the stopspeed floor — capped, not smoothly converged). ACC-018 covers Shift/Ctrl non-triggering browser shortcuts.
  - **10.2 Breakable collision verify.** Added T1 world test in `movement_map.test.ts`: player blocked by a static box, collider disabled → player passes through. Confirmed existing `main.ts` codepath (`collider.setEnabled(false)` on prop break) is correct.
  - **10.3 Crouch-jump onto crates.** Added T1 world test: duck-jump reaches crate-top height (0.7m); standard jump lifts but without duck-clearance. ACC-018 covers the in-game scenario.
  - **WASM rebuild.** `wasm-pack build sim --target bundler --features wasm` → `rm -rf node_modules/.vite`. Cleared cache for Vite to pick up the updated Rust sim.
  - **Docs.** `source-movement.md`: friction floor note updated (dead zone + dead-stop check), duck scale line added. ACC-018 written at `tests/acceptance/ACC-018-movement-tuning.md`. `plan_to_implement.md` Phase 10 marked complete.
  - **Tests.** 204 TS tests, 39 Rust tests — all green. `pnpm typecheck` / `pnpm lint` / `pnpm test` / `cargo test` all pass.



## 2026-07-16

- Implemented Phase 0 (Scaffold) from `plan_to_implement.md`:
  - Scaffolded a Vite + TypeScript-strict project at the repo root (moved the loose doc files
    at root into `docs/` to match the paths `CLAUDE.md` already referenced).
  - Installed `three`, `@dimforge/rapier3d-compat`, `howler`, `stats.js`; added `eslint`,
    `typescript-eslint`, `prettier`, `vitest`. Pinned TypeScript to `~6.0.2` — TS 7 broke
    `typescript-eslint`'s parser (`typescript-estree` requires `typescript@>=4.8.4 <6.1.0`).
  - `tsconfig.json`: `strict: true` plus `noImplicitOverride`/`noUncheckedIndexedAccess`, kept
    the scaffold's `erasableSyntaxOnly`.
  - `src/core/loop.ts`: fixed 64 Hz accumulator with render interpolation (`alpha`), frame-dt
    clamp + step cap to avoid a spiral of death on tab-backgrounding.
  - `src/core/scratch.ts`: pooled `Vector3`/`Quaternion`/`Matrix4` for the hot loop.
  - `src/core/input.ts`: pointer lock lifecycle, keyboard bitmask (`Buttons`), mouse-delta
    yaw/pitch, and `wishDirFromButtons()`.
  - `src/render/renderer.ts`: WebGL2 renderer, ACES Filmic tonemapping, sRGB output,
    `stats.js` panel.
  - `src/main.ts`: wired the above into a spinning-cube demo satisfying the Phase 0 exit test.
  - `assets/CREDITS.md`: created, header only, no rows yet.
  - Verified the exit test live: started `pnpm dev`, drove it with a scratch Playwright script
    (headless Chromium) — stats panel visible at 59 fps, cube visibly rotating between
    captured frames (proves interpolation, not just ticking), pointer lock engages on canvas
    click, zero console errors. Note: headless Chromium's synthetic `Escape` keypress (via CDP)
    does not trigger the native pointer-lock-exit shortcut — confirmed this is a headless/CDP
    limitation and not an app bug by calling `document.exitPointerLock()` directly and
    confirming our `pointerlockchange` listener reacts correctly. Worth a manual check in a
    real windowed browser.
  - Checked whether any of the above made `CLAUDE.md` inaccurate: no — repo layout, stack
    table, and non-negotiables all still hold. Did not add the new `lint`/`format` npm scripts
    to `CLAUDE.md`'s Commands table since they're additive conveniences, not something the doc
    claimed didn't exist.
- Added IntelliJ run configurations (`.idea/runConfigurations/*.xml`) for the pnpm scripts in
  `package.json`: `dev`, `build`, `typecheck`, `test`, `test:watch`, `lint`. Left
  `.idea/workspace.xml` untouched (per-user IDE state, already in `.idea/.gitignore`) — the
  Node interpreter path is a one-time per-machine setting in the IDE itself.
- Added this "Notes from Management" section to `CLAUDE.md` and created this changelog file,
  per instruction.

---

## 2026-07-16 (cont.)

- Implemented Phase 1 (Movement) from `plan_to_implement.md`:
  - `src/player/constants.ts`: every ported constant from `docs/source-movement.md`
    (gravity, `sv_accelerate`/`airaccelerate`/`friction`/`stopspeed`/`maxspeed`, air wishspeed
    cap, overbounce, clip plane limits, jump impulse, step height, capsule dims, eye heights,
    duck transition time), plus derived standing/ducked capsule half-heights and a small
    clearly-separated block of non-ported implementation tolerances (ground trace distance,
    view-punch tuning) since the doc doesn't give exact numbers for those.
  - `src/physics/world.ts` + `src/physics/shapecast.ts`: thin Rapier wrapper — WASM init,
    world creation, static box colliders (+ optional rotation, for the ramp), a kinematic
    capsule factory, and a `capsuleCast`/`capsuleOverlapsAnything` query pair. This is the
    *only* place Rapier is used for anything beyond shape-cast queries, per the doc.
  - `src/player/movement.ts`: hand-rolled port, not an invention. Pure, world-free
    `friction()`/`accelerate()`/`airAccelerate()`/`clipVelocity()` transcribed verbatim from
    the doc (kept the "don't simplify the airAccelerate asymmetry" comment). World-touching
    `categorizePosition()`, `tryPlayerMove()` (4-iteration collide-and-slide with 5-plane
    crease handling), `stepMove()` (Source's 3-trace stair dance), `checkJump()` (SET not
    additive, `jumpHeld` latch, no auto-bhop), and `handleDuck()` (binary hull swap matching
    Source's actual two-discrete-hull-sizes behaviour, with a smoothly-interpolated
    `duckAmount` for the view only — mid-air duck/un-duck shifts the feet to anchor the
    hull's top, which is what makes duck-jump clear higher gaps). `tickMovement()`
    orchestrates all of it in the doc's exact per-tick order. Module-level scratch Vector3s
    (not the shared `core/scratch.ts` pool — clip-plane normals need to survive nested calls
    within one tick, which the shared pool's rotating cursor can't guarantee) keep the hot
    path allocation-free.
  - `src/player/camera.ts`: `ViewState`/`updateViewCamera()` for interpolated first-person
    eye position + landing view-punch, following the prev/curr pattern from `core/loop.ts`.
  - `src/render/renderer.ts`: fixed a real bug this surfaced — the Phase-0 camera was
    constructed with `new PerspectiveCamera(90, aspect, ...)`, but three's FOV parameter is
    *vertical*, and `docs/art-direction.md` is explicit that 90° must be *horizontal* (the
    CS default) or ultrawide users see less, not more. Added the conversion and applied it
    on construction and on resize.
  - `src/player/movement.test.ts`: golden tests. Case A (ground accel from rest) and Case B
    (friction decel) match the doc's reference tables to the 5th decimal. Case C (air
    strafe) generated from the real `airAccelerate()` with wishdir sweeping at a constant
    180°/s independent of velocity's own heading (mirrors real strafejumping, not a
    velocity-chasing wishdir, which self-limits) — shows monotonic 6.35 -> 9.1 m/s over 2s,
    frozen as a snapshot regression baseline. Also covered the airAccelerate clamp asymmetry
    directly and `clipVelocity`'s in-place-safety/numerical-safety-pass behaviour.
  - `src/main.ts`: replaced the Phase-0 spinning cube with a real greybox test room (floor,
    4 walls, a 6-step staircase with each rise under `STEP_HEIGHT`, and a ~15.6° ramp well
    under the walkable normal threshold — built from Rapier cuboid colliders, not a trimesh,
    since that's simpler and better-suited to axis-aligned test geometry than an authored
    map; flat `MeshBasicMaterial` in the `docs/art-direction.md` palette since there's no
    lightmap yet and reaching for a light to make an unlit greybox visible would be exactly
    the mistake that doc warns against), spawns a movement-driven player, and drives the
    camera from interpolated view state.
  - `pnpm typecheck`, `pnpm lint`, and `pnpm test` are all green (9/9 tests).
  - Live-verified part of this in headless Chromium (temporary `window.__debugPlayer`/
    `__debugInput` hooks, removed before this entry): room renders correctly (screenshots),
    pointer lock engages, zero console errors, and — checked against the *live integrated*
    app rather than just the unit test — ground acceleration caps at exactly 6.35 m/s and
    friction decay matches the expected per-tick ratios. Noticed headless Chromium's
    synthetic pointer-lock-engage click fires a mouse-move with a large spurious delta,
    corrupting yaw for anything after the first click — same class of headless/CDP artifact
    as the Phase 0 Escape-key note, worked around mid-session by writing yaw directly via the
    debug hook instead of relying on synthetic mouse movement, but the deeper live pass
    (airborne bhop speed gain, walking the stairs cleanly, standing still on the ramp without
    sliding) was stopped mid-flight at the user's request before those specific checks ran.
  - **Left for next session, before starting Phase 2:** finish live-verifying the three
    remaining exit-test scenarios (bhop speed gain, stairs, ramp) — ideally in a real
    windowed browser to sidestep the headless pointer-lock quirk entirely. See the status
    note added to `plan_to_implement.md`'s Phase 1 section.
  - Checked `CLAUDE.md` against the above: still accurate. The repo layout table already
    listed `physics/` and `player/` with exactly this split; no changes needed.

## Docs merge: testing strategy

- Brought in the testing framework staged in `docs-updated-with-testing/`:
  - Added `docs/testing.md` verbatim — the four-tier (T0 unit / T1 sim / T2 runtime / T3
    acceptance) testing strategy, the determinism-harness rationale, golden-vs-baseline test
    split, and flake/coverage policy.
  - Replaced `CLAUDE.md`'s old "Testing the thing that matters" section with the new
    "Definition of Done" section (test tiers, per-feature-type tier table, the full
    checklist, and a "Never" list), and added a `docs/testing.md` pointer to "When you're
    unsure." Asked the user first whether to keep the existing "Notes from Management"
    section, since the staged draft had silently dropped it — user said keep it, so it's
    still there unchanged, after the new Definition of Done content.
  - Merged (not overwrote) the new testing-infra bullets into `plan_to_implement.md`'s
    Phase 0 (`core/rng.ts`, `tests/harness/sim.ts`, input trace record/replay + `?record`
    flag) and added the ACC-*.md/Definition-of-Done intro paragraph. Deliberately did *not*
    use the staged draft's Phase 0/1 wholesale, since that draft was based on an
    all-unchecked blank-slate version of the plan and would have clobbered the real tracked
    progress (checked-off Phase 0/1 boxes, the cuboid-vs-trimesh decision note, the
    duck-speed-cap-not-implemented note, and the "left for next session" live-verification
    status). Confirmed via diff that Phase 2 onward in the staged draft was identical to the
    current plan, so nothing else needed merging there.
  - Left `docs-updated-with-testing/` in place rather than deleting it — wasn't asked to
    remove it, and it's a harmless staging folder now that its contents are merged in.
  - No code changes this turn; `pnpm typecheck`/`pnpm test` untouched by this session.

## Git init + push to GitHub

- Ran `git init -b main`, staged everything, made the initial commit.
- Existing Vite `.gitignore` was already adequate (node_modules, dist, .idea, logs).
  Added rules for `.claude/settings.local.json` and its `.tmp.*` files, which were
  otherwise getting staged.
- Remote: `git@github.com:beanthemoonman/dougiesbigtrip.git`. HTTPS had no stored
  credentials, so switched to SSH (existing `id_ed25519` key authenticates as
  beanthemoonman). Pushed `main` and set upstream tracking.

## ponytail-audit — dead-code cull

Executed the ponytail-audit findings. Deleted unused scaffolding, no behaviour change
(typecheck clean, movement golden tests 9/9 green):
- Removed `src/core/scratch.ts` entirely — the pooled `scratchVec3/Quat/Mat4` factory had
  zero importers; movement.ts uses its own module-level scratch (its rotating-cursor pool
  can't serve values that must survive nested calls within one tick anyway). Updated the two
  CLAUDE.md references that pointed at `core/scratch.ts` to the module-scratch pattern.
- Dropped `howler` + `@types/howler` deps (no audio code yet; Phase 2) and refreshed the lockfile.
- Deleted unused exports: `createViewState`/`copyViewState` (camera.ts), `InputManager`'s
  `requestPointerLock`/`dispose`, `RenderContext`'s `resize`/`dispose` (internal resize
  listener kept), and `export { RAPIER }` from world.ts.
- Removed unused constants/flags: `WALK_SPEED_SCALE`, `JUMP_APEX_RISE`, `Buttons.ATTACK`.

net: ~-70 src lines, -1 runtime dep.

## Phase 2 start — weapon defs data file

Added `src/weapons/defs.ts`: typed `WeaponDef` + a `WEAPONS` table with the two starter guns
(AK-analogue rifle, USP-analogue pistol), all fields the plan lists — fireInterval, damage,
armorPen, falloffCoef, baseSpread, mag, reloadTime, speedMult, and a deterministic recoil
pattern (30-step AK shape / 12-step USP) with resetTime + recoverTime. Doc-sourced values
(falloffCoef 0.98/0.75, recoil reset/recover timings, AK pattern shape) are noted inline;
damage/spread/etc. are labelled gameplay tuning numbers. Angles authored in degrees, converted
to radians once at load.

`src/weapons/defs.test.ts`: T0 invariants (field ranges, rifle recoil climbs over first 7
shots, pistol out-falls the rifle at 40 m). `pnpm typecheck` + `pnpm test` green (13 tests).

Deliberately data-only — no hitscan/recoil/spread logic yet, and nothing consumes these defs.
That's the *next* task, and it's gated on the Phase 1 live exit test (still unconfirmed in a
real browser), so I stopped here rather than build combat on top of unverified movement.

## Phase 2 — damage model

Added `src/game/damage.ts`: pure, world-free damage math from doc §6.
- `rangeFalloff(weapon, dist)` = pow(falloffCoef, dist/5).
- `HITBOX_MULT` (head 4 / chest 1 / stomach 1.25 / arm 1 / leg 0.75).
- `computeDamage(weapon, dist, hitbox, targetArmor)` → { health, armor }. Simplified CS
  armour split: armorPen bleeds through to health, remainder absorbed by armour point-for-
  point, overflow falls to health when armour runs out. Damage is conserved (health + absorbed
  == incoming).

`src/game/damage.test.ts`: 5 T0 cases (base, 4× headshot, falloff monotonic + pistol < rifle
at 40 m, armour split conservation, armour-runs-out overflow). typecheck + test green (18).

Still pure math — no hitbox capsule geometry/query yet (needs the character rig, Phase 3), and
no shot pipeline consuming it yet (gated on the Phase 1 live movement pass).

## Phase 2 — deterministic recoil accumulator

Added `src/weapons/recoil.ts`: pure, rng-free spray state machine (doc §3).
- `RecoilState` = { sprayIndex, timeSinceShot, punch{yaw,pitch} }.
- `onShot` advances the index (clamped to last step for long sprays) and adds that pattern
  step to the accumulated view punch.
- `tickRecoil(dt)` resets the index after `resetTime` of no fire and exponentially decays the
  punch toward 0 with time constant `recoverTime` (framerate-independent at fixed dt).

`src/weapons/recoil.test.ts`: 5 T0 cases (step-0 first shot + early climb, determinism, index
clamp, decay-while-idle, index reset after resetTime). typecheck + test green (23).

View application (feeding punch into the camera + tracing along the punched direction) is
deliberately deferred — it's the hitscan wiring, gated on the Phase 1 live movement pass.

## Phase 2 — accuracy/spread model

Added `src/weapons/spread.ts`: pure inaccuracy calc (doc §4). `computeSpread(weapon, stance,
sprayIndex)` = baseSpread × STANCE_MULT × (1 + shots×growth), hard-capped at 0.2 rad. Stance
multipliers per doc: crouchStill 1 / still 1.3 / walking 2 / running 5 / air 20. Spray growth
per shot and the cap are tuning numbers (ponytail-flagged; revisit against wall decals). Same
value drives both the trace spread disc and the crosshair gap (§5).

`src/weapons/spread.test.ts`: 6 T0 cases (baseline, stance ordering, spray growth, ×20 air,
hard cap, negative index == first shot). typecheck + test green (29).

Stance *classification* from live movement state (speed/ducked/grounded → Stance) is left for
the shot-pipeline wiring, gated on the Phase 1 live pass.

## Phase 2 — the shot pipeline (ties the pieces together) + seeded RNG

Bigger step: stopped adding standalone pure modules and wired them into the actual shot
pipeline — the integration everything else was "gated on". Still fully T0-testable (no world
raycast, no rig, no dependency on the unconfirmed live movement pass).

- `src/core/rng.ts`: the seeded `mulberry32` RNG owed since Phase 0 but never created —
  confirmed it was genuinely missing (`grep` for rng/Math.random under `src/` found nothing).
  Injected `Rng { next(): number }`, the only randomness source allowed under `src/` per the
  determinism rule. `rng.test.ts`: same-seed determinism, cross-seed difference, [0,1) range.
- `src/weapons/hitscan.ts`: the shot pipeline.
  - `WeaponState` + `createWeaponState` — ammo, fire-rate timer, reload state, recoil.
  - `canFire`/`tickWeapon`/`startReload` — cadence gate (`timeSinceFire >= fireInterval`),
    per-tick recoil recovery, full-mag reload after `reloadTime` (no CS partial-mag carry —
    cut scope, noted inline).
  - `aimDirection(yaw, pitch)` — verified against the camera's YXZ euler (`camera.ts`) and
    `wishDirFromButtons` (`input.ts`): forward = (-sin(yaw)cos(pitch), sin(pitch),
    -cos(yaw)cos(pitch)), unit. Fixed a wrong first-draft comment about the yaw sign after
    deriving the composition by hand.
  - `applySpread(dir, spread, rng)` — area-uniform cone disc (ρ = spread·√u) around any aim
    vector, built on an orthonormal basis ⟂ dir. This is the plan's "spread applied in a disc
    around the aim vector."
  - `fireShot(...)` — composes it: gate → `onShot` (recoil) → aim = view + punch → spread
    perturb → returns the deterministic world ray `direction`. ponytail-noted that this shot
    fires along a view already including its own recoil step; split pre/post-punch only if a
    golden trace ever demands it.
  - `hitscan.test.ts`: 13 T0 cases — aim basis/handedness, spread never exceeds the cone +
    stays unit-length (2000 samples), spread is statistically unbiased (mean ≈ aim over 20k),
    spread determinism, fire-rate/ammo gating, reload timing + full-mag guard, spray-climbs-up
    integration, and full-pipeline determinism (same seed+inputs → identical directions).
- Lint hygiene: `pnpm lint` was actually red across the whole (uncommitted) weapons module —
  prior Phase 2 entries only ran typecheck+test, not lint, so 4 pre-existing
  `no-non-null-assertion` errors (`recoil.ts`, `recoil.test.ts`, `spread.test.ts`) had gone
  unnoticed. Fixed those + my 2 new ones by narrowing instead of `!` (a `reduce` pairwise
  compare, an `if (step === undefined) return` guard on the clamped index, a throwing test
  helper). `pnpm lint` now clean.
- `pnpm typecheck` + `pnpm lint` clean, `pnpm test` green (45 tests, up from 29).

The **world** raycast + per-bone hitbox capsule query — the other half of "hitscan" — is
still owed and genuinely needs the character rig (Phase 3), so it stays deferred. The
deterministic *direction* a bullet travels, which is the part that had to be pure and tested,
is done. Live movement pass (Phase 1) still owed before wiring any of this to a trigger in a
real browser.

## 2026-07-16 — First prop asset
- Modeled an original explosive barrel prop from scratch in Blender (24-sided cylinder,
  beveled rims, two torus rib rings). ~0.59m dia × 0.88m tall, in metres, Z-up.
- Exported `assets/props/barrel_explosive.glb` (668 tris, ~19 KB). Original CC0 work — no
  Valve/third-party assets touched.
- Added CREDITS.md row. Created `assets/props/` (new dir; not previously in the repo layout).
- Added two more original props: `crate_wood.glb` (0.7m beveled cube, 12 tris) and
  `traffic_cone.glb` (cone + square base, 104 tris). CREDITS rows added. Note: glTF export
  doesn't apply the bevel modifier (export_apply defaults False), so the crate ships with
  sharp edges — fine for a demo prop.
- Added two more original props: `jerry_can.glb` (rounded body + spout, 56 tris) and
  `pallet_wood.glb` (3 runners + 5 deck boards, 1.2x1.0m, 96 tris). CREDITS rows added.
  Now exporting with export_apply=True so bevels bake into the mesh.
- Started texturing props with CC0 Poly Haven textures (1k, jpg, embedded in the glb):
  brown_planks_03 -> crate_wood + pallet_wood; rusty_metal_02 -> barrel; green_metal_rust
  -> jerry_can. Barrel and crate read well. TODO: pallet + jerry_can need UV-scale tuning
  (small board faces sample a washed-out patch). jerry_can roughness map failed to load on
  export (diffuse+normal only). Cone left untextured (flat plastic is fine). glb sizes rose
  to ~1.1-1.3MB each with embedded textures; pnpm assets:opt -> KTX2 will shrink these.
  All three textures credited in CREDITS.md.

## 2026-07-17 — Phase 2 HUD + weapon wired into the live app

Picked the HUD as the next unblocked Phase 2 item (viewmodel needs a weapon asset; Phase 1's
live exit test still needs a real windowed browser, which I can't drive from here).

- `src/ui/hud.ts` — plain DOM overlay, no React (per CLAUDE.md). HP/AP bottom-left, ammo +
  weapon name bottom-right, four-line crosshair centred.
  - `crosshairGapPx(spreadRad, vFovRad, heightPx)` = `(h/2)·tan(spread)/tan(vFov/2)`, floored
    at 3 px. The load-bearing bit: the gap is driven by the *same* `computeSpread()` value the
    bullet's spread disc uses, so the crosshair is a readout of the accuracy model rather than
    a decoration tuned to look about right.
  - `hud.test.ts` — 5 T0 cases, written and observed failing first: the projection identity (a
    cone of half the vFOV lands the gap at exactly half-height), monotonicity in spread, height
    scaling, the min-gap floor, and that a standing rifle first-shot reads under 10 px at 1080p
    while air/deep-spray open wider.
- **Bug found while wiring: the AK spray pattern was mirrored.** `defs.ts` authors pattern yaw
  as +right, but view yaw is +left (`aimDirection`: +yaw swings toward -X) — and `fireShot` was
  adding the punch, so steps 8–12's "pull left" phase pulled *right*, i.e. the whole pattern
  was flipped versus `docs/weapon-feel.md` §3. No test pinned handedness (the existing spray
  test only checked the upward climb). Added 3 tests to `hitscan.test.ts` — climb, pull-left,
  swing-right — watched the two new ones fail, then fixed the sign in `fireShot`. `camera.ts`
  now uses the identical conversion, with a comment on both sides saying so: if those two
  drift apart the bullet stops following the view, which is the one invariant this weapon model
  is built on.
- Wiring: `Buttons.ATTACK` (LMB, gated on pointer-lock so the lock-engaging click doesn't fire
  a shot into the floor) + `Buttons.RELOAD` (R) in `input.ts`; `main.ts` ticks the weapon,
  fires, and feeds `recoil.punch` through `ViewState` (now carrying `punchYaw`/`punchPitch`,
  interpolated like the rest) into the camera. Seeded `makeRng(1)` so the sim stays replayable.
- `stanceOf()` in `main.ts` maps player motion onto the accuracy model's stance buckets.
  ponytail-noted: the doc names the buckets but gives no speeds, so the 0.1 / 3.5 m/s
  thresholds are picked against the 6.35 m/s cap, and ducked-and-moving is just 'walking'
  (CS gives crouch-walking its own better bucket — fold in when there's a real number).
- `tests/acceptance/ACC-003-hud.md` — first file in `tests/`, which didn't exist. Written
  before tuning, **not yet run**: it needs a real windowed browser, same blocker as the Phase 1
  live pass. Run them together.
- Verified live in headless Chrome (screenshot): the room renders, the HUD reads `HP 100`,
  `AP 100`, `30 / 30`, `AK-analogue` off real weapon state, crosshair centred and tight, zero
  console errors. The look-dependent and firing steps are what ACC-003 is for.
- `pnpm typecheck` / `pnpm lint` / `pnpm build` clean, `pnpm test` green (53 tests, up from 45).

Still owed in Phase 2: viewmodel pass, weapon anim FSM, audio, and the world raycast + decals
(the last is what makes the Phase 2 exit test — "fire twice, the patterns match" — observable).
HP/AP are hardcoded until Phase 4 gives them a source.

## 2026-07-17 — Phase 2 world raycast + impact decals (spray pattern now observable)

Picked the world trace + decals — the item that turns the Phase 2 exit test ("fire twice, the
patterns match") from a claim into something you can look at. It was the last piece blocking an
observable exit test; the viewmodel half still needs a weapon asset.

- `src/physics/shapecast.ts` — added `rayCast()`: a Rapier `castRayAndGetNormal` from the eye
  along the shot's unit direction, returns distance (toi, = metres since dir is unit) and writes
  the surface normal. `solid=true` so a ray starting inside a collider impacts at 0 rather than
  punching out the far side. Reuses a module-level `Ray`. Excludes the player's own hull. Lives
  in the existing query wrapper rather than a new file (it's the same "collision queries only"
  concern as the shape-casts already there).
- `src/render/decals.ts` — one `InstancedMesh` (unit `CircleGeometry`, flat dark unlit disc),
  fixed 128-slot ring buffer, oldest hole recycles. One draw call for the whole system,
  `frustumCulled = false` (scattered instances share a meaningless bounds). `decalMatrix()` is
  the load-bearing bit: places a unit quad flat on the surface facing out along the normal via
  `Matrix4.lookAt`, with the up-vector guarded against the normal-parallel-to-up degenerate
  (every floor/ceiling hit, not an edge case) and a 5 mm offset off the surface to beat
  z-fighting. No texture/asset → no licence, no CREDITS row; surface-matched real decals are
  Phase 5.
- `src/render/decals.test.ts` — 5 T0 cases, written and observed failing first: quad faces along
  the normal, offset along the normal, stays finite on a floor hit and a ceiling hit (the NaN
  trap), and scales uniformly to `DECAL_SIZE`.
- `src/main.ts` — `fireShot` now feeds `rayCast` from the eye (not the muzzle, per
  weapon-feel §2), and a hit stamps a decal at `origin + dir·distance`. ponytail-noted: bullets
  stop at the first surface (no wallbang — §6 makes it optional), and no damage is applied
  (needs the character rig). `MAX_SHOT_DISTANCE = 100 m`.
- `tests/acceptance/ACC-004-impacts.md` — the Phase 2 exit-test script, written before tuning,
  **not yet run** (needs a real windowed browser, same blocker as ACC-003/Phase 1 — run them
  together). Step 5 (tap at 30 m) can't run as written until the Phase 3 map exists; a ~20 m
  greybox-diagonal substitution is noted in the script.
- Live smoke pass in headless Chrome over CDP (throwaway scratchpad script, not repo tooling):
  pointer lock engaged, holding LMB drained 14 rounds off real weapon state, holes landed on the
  far wall flat to the surface as a structured cluster (not a cloud), zero console errors.
  Screenshot taken. Judging the pattern *shape* against weapon-feel §3 is what ACC-004 is for —
  a static headless shot can't, the view is moving under the recoil.
- `pnpm typecheck` / `pnpm lint` / `pnpm build` clean, `pnpm test` green (58 tests, up from 53).

Still owed in Phase 2: viewmodel pass (separate camera/FOV/render pass — needs a weapon asset),
weapon anim FSM, audio. Phase 2 is not done until the viewmodel clause of the exit test is met.

## 2026-07-17 — AK-analogue viewmodel asset (Blender)

Built the weapon asset that was the standing blocker for the Phase 2 viewmodel render pass.

- `assets/weapons/ak_viewmodel.glb` — original low-poly AK-analogue, box-modeled from primitives
  in Blender via the MCP server. 268 tris, 168 verts, 20 KB, two materials (`M_gun_metal` dark
  gunmetal, `M_gun_wood`). New dir `assets/weapons/` (was in the repo layout but didn't exist).
  CREDITS row added at add-time. CC0, no third-party assets touched.
- Silhouette parts: receiver + dust cover, barrel + muzzle brake + front sight + gas block,
  wood handguard, curved banana magazine (two angled segments), pistol grip, wood fixed stock.
  Verified by viewport screenshot (side ortho + 3/4 persp) — reads unmistakably as an AK.
- **Modeling bug caught mid-build:** the box helper scaled a unit cube by `s/2`, but a size-1
  cube already spans 1.0, so every box came out half-size while the full-size cylinders (barrel)
  didn't — that mismatch was the visible gaps between parts. Fixed (scale == final extent) and
  rebuilt; parts now connect.
- **Orientation:** modeled barrel down Blender +Y so the +Y-up glTF export lands it facing
  three.js -Z (camera-forward). First export faced +Z (backward, toward the player); rotated the
  asset 180° about Z and re-exported rather than bake a magic 180° into the runtime. Verified
  from the glb: mesh bbox z ∈ [-0.580, +0.438] (muzzle forward), materials intact.
- Added a named `muzzle` empty at model-space `(0, 0.018, -0.585)` (three coords) — the
  flash/tracer origin for Phase 5, findable via `getObjectByName('muzzle')`. Exports as a glTF
  node parented under the weapon.
- Skipped `pnpm assets:opt` (KTX2/meshopt): the mesh is 20 KB and color-only, no textures —
  nothing for the pipeline to shrink. Run it if a textured weapon ever lands.

Still owed for Phase 2 (the render pass that *consumes* this asset is not yet wired): a separate
viewmodel camera + its own FOV (54–68° H, default 60°) + separate render pass with `clearDepth()`
between passes on layer 1, plus a hand-placed key/fill light rig (docs/weapon-feel.md §1). Then
the weapon anim FSM and audio. The viewmodel clause of the Phase 2 exit test stays open until the
pass is in and ACC-004's viewmodel note can be closed.

- Fix: the magazine and pistol grip were raked backwards — the banana mag curved toward the
  stock and the grip raked forward. Flipped the `rx` signs (mag now negative → curves
  forward-down with its belly toward the muzzle; grip now positive → rakes back toward the
  stock) and moved the lower mag segment forward of the upper. Rebuilt/re-exported; orientation
  (-Z forward) and muzzle marker unchanged, still 268 tris, same file so the CREDITS row stands.

## 2026-07-17 — Phase 2 viewmodel render pass wired

Wired the AK viewmodel into a proper second render pass — the "#1 thing people get wrong"
(docs/weapon-feel.md §1). This was the last blocker on the viewmodel clause of the Phase 2 exit
test.

- `src/render/renderer.ts` — restructured to two passes in one frame:
  - Added `viewmodelScene` + a `viewCamera` (60° H viewmodel FOV, near 0.01 / far 10, layer 1).
    World camera stays 90° H / near 0.1. `renderer.autoClear=false`; `render()` now does
    `clear()` → world pass → `clearDepth()` → viewmodel pass, so the gun is always drawn on top
    and never clipped by world geometry or squashed by the 90° FOV.
  - Own light rig (the world lightmap can't reach layer 1): a `RoomEnvironment` PMREM as
    `viewmodelScene.environment` — **required**, because the gun's full-metalness gunmetal
    reflects surroundings, not direct light, so with no env it renders pure black — plus a
    key + fill `DirectionalLight`, all on layer 1. This is the viewmodel's own rig; the
    realtime-light ban in art-direction.md is for the *world* scene only, which stays lightmap-only.
  - `viewCamera` is left static at the origin: the weapon lives in eye-space, so the doc's
    world-camera pose-copy is a no-op for an isolated viewmodel scene. Commented, with a note to
    revisit if world-anchored effects ever join this pass.
- `src/main.ts` — first asset load in the app: `GLTFLoader.loadAsync` of the glb (imported via
  Vite `?url`), set to layer 1, welded to the eye at a hand-tuned lower-right offset
  `(0.13, -0.14, -0.36)`, slight 3° yaw. Tuned by eye over three headless screenshots (the FOV is
  a taste dial per §1, default 60°).
- `tests/acceptance/ACC-005-viewmodel.md` — T3 script for the pass (drawn-on-top / no-clip / no
  edge distortion / lit-not-black / survives recoil). Written, **not yet run** — real windowed
  browser, same standing blocker as ACC-003/004.
- Live headless-Chrome pass over CDP: viewmodel reads as an AK in the lower-right, drawn on top of
  the stairs and walls, properly lit (wood brown, metal grey — not black), pointer lock + firing
  work, mag drains, decals climb, zero console errors. Screenshots taken.
- `pnpm typecheck` / `pnpm lint` / `pnpm build` clean, `pnpm test` green (58 tests). glb bundles
  to dist at 20 KB.

Still owed in Phase 2: the pistol isn't wired (data exists, so the "spray vs. tap" contrast is
only half-there), the weapon anim FSM (idle/fire/reload/draw/holster), and audio. Phase 2's exit
test can't be fully signed off until at least the anim/feel items land and ACC-003/004/005 get a
real windowed-browser run.

## 2026-07-17 — Phase 2 finished: 2nd weapon, switching, anim FSM, audio

Implemented the remaining Phase 2 items. Everything typechecks/lints/builds clean and 64 tests
pass; the exit test is a T3 human pass still owed in a real windowed browser (see the plan).

- **Pistol viewmodel** — `assets/weapons/pistol_viewmodel.glb`, original USP-analogue box-modeled
  in Blender (120 tris, 2 materials: reused `M_gun_metal` + new dark `M_gun_polymer`). Same
  build/orient/export pipeline as the AK (barrel down -Y, flip 180° about Z → faces three -Z,
  named `muzzle` empty). Baked origin to world zero this time (the AK got lucky with its active
  object at the origin). CREDITS row added.
- **Weapon anim FSM** — `src/weapons/viewmodel.ts`. Procedural, because the models have no
  armature: draw/reload/holster are timed pose *offsets* (smoothstep raise / sine dip), `fire` is
  an additive decaying kick layered on any state (so full-auto doesn't restart a discrete state
  and stutter). Pure, clock-free, ticked at the fixed rate. 6 T0 tests in `viewmodel.test.ts`,
  written+failing first: draw settles to rest, holster reports the next weapon once, reload dips
  and returns, fire kicks toward the eye then decays, determinism, beginDraw clears pending.
- **Audio** — `src/core/audio.ts`, Web Audio synthesis: gunshot = filtered noise burst + a low
  sine thump (rifle punchier/brighter, pistol shorter/drier); reload = two clicks. No sound files
  → no licence/CREDITS. **Deliberately not Howler.js** (the CLAUDE.md stack pick): Howler earns
  its keep for positional/spatial audio, which needs other world sources (bots, Phase 4); the
  player's own gun is at the ear, so a few lines of Web Audio cover Phase 2. Updated the CLAUDE.md
  audio row to say so. Noise buffer is filled from the seeded `core/rng` so `Math.random` stays
  out of `src/` (determinism rule). Context resumes on the pointer-lock click (user gesture).
- **Wiring** (`main.ts` + `input.ts`) — both models loaded and welded to the eye on layer 1, each
  with its own rest pose (hand-tuned; pistol is smaller so held closer) and its own persistent
  ammo/recoil state. `1`/`2` select (a latched `weaponSlot` edge in input, consumed by main);
  switching holsters the current gun, and the swap happens when the holster completes, then the
  new gun draws. Fire/reload/switch are gated on the anim's idle state. Reload and each shot fire
  their sound + anim; the render pass applies the anim pose over the active weapon's rest offset.
- Live headless-CDP integration pass: switch AK↔USP (HUD name + ammo track, e.g. `12/12
  USP-analogue`; AK mag persisted across a round-trip), fire both, reload the USP (`8/12` mid,
  refills after), spray the AK (`22/30`, pattern climbs up-center), zero console errors.
  Screenshots taken. Pistol rest pose tuned over a few screenshots (it's a taste dial, and the
  polymer pistol reads dark — fine for greybox).
- `tests/acceptance/ACC-006-weapons.md` — T3 script for the two-weapon/switch/anim/audio surface,
  written before tuning, not yet run (real windowed browser).

Phase 2 code-complete. Next session: run ACC-003/004/005/006 together in a real windowed browser,
record PASS + commit hash, then start Phase 3 (the map).

## 2026-07-17 — Phase 2 exit test signed off

Developer tested the full Phase 2 build in a real windowed browser and confirmed it works.
Recorded PASS in the four T3 acceptance scripts (ACC-003 HUD, ACC-004 impacts/spray, ACC-005
viewmodel, ACC-006 weapons/switch/anim/audio) against commit aafcb6b. Phase 2 is complete;
Phase 3 (the map) is unblocked. (Committing straight to main — solo project, no feature branches.)

## 2026-07-18 — Phase 3 start: greybox map (data-authored)

Started Phase 3 (the map). The plan's own order is greybox → playtest → *then* texture/lightmap,
so this increment is the greybox only — no Blender/glb/lightmap yet.

- **`src/game/map_greybox.ts`** — the map "de_greybox" as cuboid data (`MAP_BOXES` + `MAP_RAMPS` +
  `T_SPAWN`/`CT_SPAWN`), roughly half of Dust2's B: T spawn (south) → open site (north) with a CT
  hold behind, three routes between (West "tunnels", a Mid doorway choke, East "long"), crates and
  pillars for cover, and a step→platform (0.4/0.8 m, both rises < STEP_HEIGHT) plus a shallow ramp
  so step-offset and no-slope-slide stay under test on real map geometry.
- **`src/main.ts`** — replaced the Phase 1 `buildGreyboxRoom` with `buildGreyboxMap`, which feeds
  the box/ramp data through the existing `addBox`/`addRamp` path (Rapier cuboid colliders +
  MeshBasicMaterial greybox — no realtime lights). Player now spawns at `T_SPAWN`. PALETTE moved
  into the map file.
- **`src/game/map_greybox.test.ts`** — T0 data sanity (the invariants that silently break the map
  on an edit): both spawns rest just above the floor and inside the perimeter, the mid choke gap is
  wider than the player hull, and the site step-up rises stay under STEP_HEIGHT.
- **`tests/acceptance/ACC-007-greybox.md`** — T3 playtest script written before any layout tuning
  (routes reachable, choke passable at speed, movement feel survives, step-up not hop, no slope
  slide, sightlines read). Not yet run — needs a real windowed browser.
- `pnpm typecheck` / `pnpm lint` / `pnpm test` (67) / `pnpm build` all green.

Deferred (marked in plan_to_implement.md): the authored Blender modular kit + texel density lands
with texturing/lightmap, not before playtest — that's where lightmap UVs actually depend on it.
Next: run ACC-007 in a real windowed browser, tune the layout, then start the texture/lightmap
increment (Blender kit, UV channel 2, Cycles bake → KTX2, glb loader, static-merge, fog+skybox).

## 2026-07-18 — Phase 3: baked-lightmap map pipeline (the Source look)

ACC-007 greybox playtest PASSed (recorded, commit 4725ae4). Then built the lightmap pipeline
end to end — the actual "Source look" (baked lighting, zero realtime world lights).

- **Single source of truth.** Moved the map layout to `assets/maps/de_greybox.json`; both the
  engine colliders (`src/game/map_greybox.ts`, now imports the JSON — `resolveJsonModule` on) and
  the Blender bake (`tools/blender/build_map.py`) read the same numbers, so render + collision
  can't drift.
- **`tools/blender/build_map.py`** — reproducible generator: builds all geometry in three.js
  space and converts per-vertex to Blender Z-up (one code path for boxes + the rotated ramp, no
  axis algebra), 3 flat-albedo materials by surface class (M_Sandstone/M_Concrete/M_Wood), joins
  to one object, Smart-UV-Projects UVMap_Lightmap (channel 2) + packs, adds a Sun + physical sky
  (bake-only, none ship), bakes Cycles Diffuse (Direct+Indirect, **no Color**) at 128 samples +
  denoise, exports `de_greybox.glb` (+Y Up, `TEXCOORD_1` verified via `gltf-transform inspect`)
  and `de_greybox/lightmap.exr`.
- **`src/render/lightmap.ts`** — loads the glb + EXR, wires the lightmap onto every material
  (`channel=1`, `NoColorSpace`, `flipY=false`). Loaded as **EXR not KTX2** — `toktx` isn't
  installed; EXR is HDR-correct with zero new tooling. KTX2 is the payload win (12.6 MB → ~1 MB)
  for `pnpm assets:opt` once toktx lands; the material wiring is identical (swap the loader).
- **`src/main.ts`** — map VISUALS now come from the baked glb; COLLISION stays the proven Rapier
  cuboids (`buildMapColliders`, same layout data) so nothing ships a collision mesh. Added
  FogExp2 + a sky-colour background (skybox stand-in). Removed the old flat-greybox mesh helpers.
- **Verified in a real Chrome** (claude-in-chrome): map renders lit — sandstone walls with soft
  baked gradient, not black, not blown out, not static — viewmodel + HUD intact, zero app console
  errors. Map is **3 draw calls** (one primitive per material, joined at bake).
- CREDITS rows added for the glb + lightmap (original/CC0). typecheck / lint / test (67) / build
  all green.

Deferred (marked in plan_to_implement.md): KTX2 encode (payload budget — the 12.6 MB EXR exceeds
the 16 MB initial-download budget until then), the final 2048-sample bake, `lightMapIntensity`
fine-tune, Poly Haven CC0 albedo/tiling textures, and a real skybox matching the sun. Next: a T3
run to sign off "looks lit" (soft crate shadows / wall bounce) and then the KTX2 + albedo polish.

## 2026-07-18 — Phase 3: lightmap shipped as KTX2 (payload budget cleared)

Installed `toktx` (AUR `ktx-software` 4.4.2) and encoded the lightmap, closing the payload item.

- **`pnpm assets:lightmap`** — reproducible encode: `oiiotool` clamps the HDR EXR master to 8-bit
  linear PNG, then `toktx --t2 --encode uastc --uastc_quality 3 --zcmp 18 --assign_oetf linear`
  produces `lightmap.ktx2`. **12.6 MB EXR → 316 KB KTX2**, stays compressed in VRAM. (UASTC is
  LDR, so highlights above 1.0 clip — acceptable at greybox; the ACES tonemapper compresses
  highlights anyway.)
- **`src/render/lightmap.ts`** — swapped EXRLoader → KTX2Loader (transcoder served from
  `/basis`, `detectSupport(renderer)`); the lightmap wiring (channel 1, NoColorSpace, flipY
  false) is unchanged. `loadLightmappedMap` now takes the renderer.
- **`public/basis/`** — vendored the Basis transcoder (js + wasm) from three.js so KTX2Loader can
  transcode; `eslint.config.js` ignores `public/**` (minified vendor js). CREDITS row added
  (Apache-2.0).
- **`.gitignore`** — the EXR + intermediate PNG are regenerable bake masters (build_map.py +
  assets:lightmap); ship the KTX2, not them. Untracked the 12.6 MB EXR from the previous commit.
- Verified in a real Chrome: map still renders lit via the KTX2 lightmap, consistent with the
  known-good EXR render, zero app/transcoder console errors. typecheck / lint / test (67) / build
  green; dist ships `lightmap.ktx2` at 316 KB.

Remaining Phase 3 polish: final 2048-sample bake, `lightMapIntensity` fine-tune, Poly Haven CC0
albedo/tiling textures, and a real skybox matching the sun — then the T3 "looks lit" exit test.

## First-round bug fixes (spawn facing, edge free-fall, shadow contrast)

Three playtest bugs from the first round, in priority order.

- **Edge free-fall (P0, movement).** Running-jumping into a crate could pin the player mid-air
  against its face forever: once the capsule was touching a wall, `castShape(..., stopAtPenetration=true)`
  returned TOI 0 for *every* cast direction, so collide-and-slide couldn't move the player out — the
  5-plane budget filled with the same wall normal, velocity zeroed, and gravity piled up unused
  (`vy` → -∞) while position stayed frozen. Fix: `capsuleCast` now takes a `stopAtPenetration` flag;
  the collide-and-slide sweeps (`tryPlayerMove`, `traceStraight`) pass `false` so a touching capsule
  slides down the wall and falls, while the ground/overlap probes keep `true` (so standing-on-floor
  detection is unaffected). `src/physics/shapecast.ts`, `src/player/movement.ts`.
  - **T1 regression:** `src/player/movement_map.test.ts` — first world-level movement test (runs
    `tickMovement` against the real greybox Rapier colliders). Reproduces the running-jump into the
    crate and asserts the player lands on the floor with bounded `vy` and doesn't tunnel; a second
    test asserts flat-ground walking stays grounded (guards the fix from regressing ground contact).
    Golden pure-function tests (`movement.test.ts`) untouched and green.
  - Extracted `buildMapColliders` from `main.ts` into `src/game/map_greybox.ts` so the engine and the
    sim test build colliders from one source (no drift).
- **Spawn faces a wall (disorienting).** T spawn is 3 m in front of the south perimeter wall and
  default yaw looked straight at it. `main.ts` now sets `input.state.yaw` to face the player from
  their spawn toward the enemy spawn (`atan2` of the spawn→CT vector) — you spawn looking down mid
  at the site.
- **Weak shadows (objects blend together).** Bake ratio, not engine: the sun (energy 4) vs. the
  `MULTIPLE_SCATTERING` sky fill (strength 0.5) were too close, so shaded faces stayed bright.
  Re-baked with sun energy 6 / sky strength 0.2 (and a tighter 1.5° sun angle for crisper contact
  shadows). `tools/blender/build_map.py`; re-encoded `lightmap.ktx2` (316 KB → 395 KB, still far
  under budget).

Verified in real Chrome: spawn now faces the map, cast shadows and shaded wall/crate faces read
clearly, zero console errors. typecheck / lint / test (69) green.

## 2026-07-18 — Phase 4 start: navmesh bake + Detour runtime pathing

First slice of Phase 4. Recast bake offline, Detour query at runtime — never bake at load time
(docs/navmesh-pipeline.md).

- **`recast-navigation` dep** + `tsx`/`@types/node` devDeps (a TS runner for the bake script; the
  test reads the baked blob from disk in Node).
- **Single collision source.** Refactored `src/game/map_greybox.ts`: `mapCuboids()` yields every
  collider as an oriented `{center, halfExtents, quat}`. `buildMapColliders` (Rapier) and the new
  `collisionTriangles()` (triangle soup for recast) both derive from it — nav walks *exactly* what
  the player collides with, no UCX_ mesh needed (this map's collision is cuboid data, not glb).
- **`tools/navbake/bake.ts`** (`pnpm nav:bake`): `generateSoloNavMesh` over `collisionTriangles()`,
  agent params from `src/player/constants.ts` (radius/height/step), `walkable*` divided by cs/ch
  into **voxel cells** (the #1 recast mistake). → `assets/maps/de_greybox.navmesh.bin` (24 KB,
  shipped like the lightmap).
- **`src/ai/nav.ts`**: `loadNav(url)` (browser fetch) / `navFromBytes` (Node), and `findPath` that
  snaps endpoints onto the mesh with `findClosestPoint` before `computePath` (a bot a few cm off
  the mesh otherwise gets no path).
- **T1 `src/ai/nav.test.ts`**: paths T-spawn→CT-spawn against the baked blob, asserts a real
  multi-point corridor whose endpoints snap near the spawns and that actually spans the map's Z —
  guards against a hole-filled bake from wrong walkable* units.
- typecheck / lint / test (70) green.

Next: bot entity driving the *player* movement code via synthesised wishdir/buttons, then the FSM.

## 2026-07-18 — Phase 4: bot drives the shared movement code, follows nav

The load-bearing Phase 4 property: **a bot is a second player.** It runs the exact same
`tickMovement` as the human and only differs in where input comes from — it synthesises a yaw +
FORWARD press instead of reading a keyboard. No bespoke bot mover (the plan flags this as easy to
get wrong).

- **`src/ai/bot.ts`**: `createBot` (own `MovementContext` + `PlayerState`), `setGoal` (findPath to
  a target), `tickBot` (steer toward the current nav waypoint — `yaw = atan2(-dx,-dz)` to match
  `wishDirFromButtons`'s `(-sinθ,-cosθ)` forward — press FORWARD, advance waypoints within 0.6 m,
  run shared movement). Bots walk, no jump/bhop.
- **T1 `src/ai/bot.test.ts`**: bot follows the baked navmesh T-spawn→CT-spawn across the real
  greybox colliders, stays grounded the whole way (never tunnels floor / flies off a ramp), and
  ends near CT spawn; a second test asserts no goal → stands still. Proves bots inherit the Source
  movement feel for free.
- typecheck / lint / test (72) green.

Next: bot FSM (Idle→Patrol→Investigate→Engage→Reposition→Dead) + perception (FOV/LOS/hearing).

## 2026-07-18 — Phase 4: bot perception (sight cone + LOS + hearing)

- **`src/ai/perception.ts`**: `canSee` (in SIGHT_RANGE 40 m, inside the 150° view cone via a
  forward·toTarget dot vs `cos(halfFOV)`, and a clear LOS raycast eye-to-eye excluding the bot's
  own hull) and `canHear` (within HEARING_RADIUS 25 m). Module scratch vectors, no per-tick alloc.
  These gates are what let bots lose you behind cover instead of tracking omnisciently.
- **T1 `src/ai/perception.test.ts`**: sees a clear target in front; blind to targets behind (cone),
  out of range, and through a wall (a one-box world kept LOS deterministic, independent of the map
  layout). `canHear` in/out of radius.
- typecheck / lint / test (77) green.

Next: bot FSM (Idle→Patrol→Investigate→Engage→Reposition→Dead) + a non-snapping aim model, then
the round loop.

## 2026-07-18 — Phase 4: non-snapping aim model + bot FSM

- **`src/ai/aim.ts`** (T0, pure): a turn-rate-capped view tracker. `stepAngle`/`stepAim` rotate
  toward the desired angles by at most `turnRate*dt`, shortest way round the ±π wrap — it NEVER
  snaps (an aimbot reads as cheating). `desiredYawPitch` inverts the `aimDirection` convention;
  `onTarget` gates firing to a small cone. Rng-free on purpose — reaction/error live in the FSM.
  `aim.test.ts`: shortest-signed delta across the wrap, per-tick step never exceeds the cap,
  converges on a 180° target, sign conventions.
- **`src/ai/brain.ts`** (T1): the FSM — Idle→Investigate→Engage→Reposition, Dead terminal. Engage
  *stands and aims* (Reposition moves), so bots don't run at you spraying. Per-difficulty knobs
  (`DIFFICULTIES` easy/normal/hard): reaction delay, aim turn-rate, aim error radius (resampled per
  acquisition from the injected seeded rng — steady during a burst), and lost-target memory.
  `tickBrain` returns fire *intent* only — the caller owns the shot, keeping the FSM decoupled from
  combat. Sight/LOS gates (perception.ts) make bots lose you behind cover.
  `brain.test.ts`: acquires a visible target and fires only *after* the reaction delay; never fires
  through a wall (stays Idle); a target that dies mid-engage drops the bot to Reposition then Idle
  after `loseMemory`; a heard sound → Investigate; Dead is terminal.
- typecheck / lint / test (88) green.

Remaining Phase 4: round loop (freezetime→live→end→reset, score, respawn) + fixed loadouts, then
wire bots into main.ts (spawn, tick, render placeholder bodies, fire→hitscan) and the T3 script.

## 2026-07-18 — Phase 4: round loop state machine

- **`src/game/round.ts`** (T0/T1): freezetime→live→over→(reset) with fixed-rate timers. `tickRound`
  returns a `RoundEvent` (`went-live` / `round-over` / `reset` / `none`) the engine acts on
  (unfreeze / show result / respawn). Win rules (bomb-less): eliminate a team → they lose; live
  timer expires → CT (defenders) hold. Score increments exactly once per round.
- **`src/game/round.test.ts`**: freeze→live timing, T-wins-by-elimination (+score once, no double
  count while `over`), CT-wins-on-timeout, reset→round 2 with a respawn event, default sanity.
- typecheck / lint / test (93) green.

Remaining Phase 4: wire bots into main.ts (spawn per team, drive `tickBrain`, render placeholder
bodies, fire→hitscan/damage, freeze gating on `phase`) + HUD round/score + the T3 acceptance run.

## Map symmetry pass (de_greybox)
Made the greybox layout mirror-symmetric across x=0. Perimeter walls and the mid
divider were already symmetric; mirrored the off-center props to matching pairs:
crates now at (±3,10)/(±6.5,7)/(±6,12), pillars at (0,6)/(±8,16), step+platform
at (±9,10)/(±9,12.75), and the wood ramp at both x=∓11→∓7. Dropped the stray z=9
crate that would have stacked on/overlapped the (±3,10) pair.
Rebaked: navmesh.bin, de_greybox.glb, lightmap.exr → ldr.png → lightmap.ktx2.
All 93 tests green (movement_map crate-jump trace still lands on the floor).

## 2026-07-18 — Phase 4: bots wired into the live game (main.ts)

- **`src/main.ts`**: three CT bots (`createBot`+`createBrain`, difficulty `normal`) spawn fanned
  around CT spawn as placeholder unlit `CapsuleGeometry` bodies (layer 0, no realtime light). Each
  tick: `tickRound` drives freeze/live/over/reset; freezetime freezes the player (skips
  `tickMovement`) and bots; `tickBrain` perceives the player (feet = target), and a `fire` intent
  gated by a per-bot cyclic cooldown deals `computeDamage` to the player (torso, vs armour). The
  player's hitscan now maps the hit collider → the owning bot via a handle map and applies
  `computeDamage` with a height-derived hitbox; lethal hits hide the body + `killBot`. Player shots
  also `hearSound` idle bots. HP/armour are live; death → `YOU LOSE`, wipe → `YOU WIN`, reset
  respawns everyone.
- **`src/game/hitbox.ts`** (T0) + test: placeholder height-band hitbox (`head`/`chest`/`stomach`/
  `leg`) off impact height above the target's feet — stand-in until the character rig (Phase 5).
- **`src/physics/shapecast.ts`**: `rayCast` gained an optional `outHit` out-param carrying the hit
  collider, so the player's shot can tell *which* bot it struck.
- **`src/ui/hud.ts`**: top-centre score (T:CT) + round number + a phase banner (FREEZE / WIN / LOSE
  / DEAD).
- **`tests/acceptance/ACC-008-bots.md`**: T3 script (bots react-not-snap, lose LOS, two-way damage,
  round reset, score-once) — written before tuning, awaiting a run.
- typecheck / lint / build / test (95) green.

skipped: positional bot gunfire (Howler) — CLAUDE.md flags it Phase 4 but it's the "when it earns
its keep" item; bot shots are silent for now. Add with third-person weapon audio. Player hitboxes
are the same height-band placeholder as the bots (bots hit the player's torso flat).

## 2026-07-18 — Phase 4: bots patrol the map

- **`src/main.ts`**: the three CT bots now get patrol routes (the brain already
  supported them; `createBrain` just wasn't given any), so they roam instead of
  standing at spawn — closes the Phase 4 exit-test gap "path the whole map
  without getting stuck". Three lanes: West x=-7, Mid x=0 (through the doorway),
  East x=+7, each a there-and-back down the map (z 14 → -14). Verified every leg
  against the baked navmesh with a throwaway reachability probe: the obvious
  x=±10 lanes are dead pockets (paths truncate at z≈11.8 behind the platforms);
  x=±7 and mid traverse fully. Spawns moved onto the lane heads.
- typecheck / lint / build / test (95) green.

---

## 2026-07-18 (plan/rename update)

- Renamed the project from `hl-demo` to **Counter Douglas Globally Offended**: `package.json`
  name (slugified), `index.html` title, `src/main.ts` boot log, and the `CLAUDE.md` intro line.
- Reworked `plan_to_implement.md`:
  - Inserted **Phase 4.5 — Art & asset refinement** between Phases 4 and 5 (de-lopside the map,
    curved weapon models, rigged T/CT characters, textured breakable props, land the deferred
    Phase 3 texturing). Noted the character rig unblocks the per-bone hitbox debts from Phase 2/3.
  - Added **Phase 6 — Netcode** (authoritative Rust deathmatch server: join replaces a bot,
    11th+ connection spectates, prediction + reconciliation + lag comp).
  - Added **Phase 7 — Light ragdoll physics** (Rapier ragdoll on death, corpses non-colliding
    with live players so they're never a clip hazard).
  - Added **Phase 8 — Containerization & deploy** (Docker client + Rust server, compose).
  - Updated the intro to reflect the longer multiplayer scope; removed netcode and ragdolls from
    "Explicitly out of scope" (they now have phases); pointed Phase 5's static deploy at Phase 8;
    updated the risk-register row that assumed multiplayer was out of scope.
- `pnpm typecheck` green.

## 2026-07-18 — Phase 4.5: de-lopside the map (correct axis)

- The map was mirror-symmetric across x=0 (left↔right) — the wrong axis. Reworked
  `assets/maps/de_greybox.json` to **180° rotational symmetry** about the origin: every element
  at (x,z) has a twin at (−x,−z), so the T half (south) and CT half (north) are identical → fair.
  Cover sits at each spawn end; the **middle is open** (you cross exposed ground to close
  distance). Flanks are deliberately *asymmetric* across x: **east = raised platform** (step-up,
  height angle), **west = ground crate cluster**. Floor recentred at z=0 (was z=−1); perimeter
  ±21 z / ±11.75 x; spawns unchanged at (0,±19).
- **`src/game/map_greybox.test.ts`**: replaced the stale mid-choke/floor-centre assertions with a
  **rotational-symmetry invariant** (every box has a 180° twin) — directly guards fairness — and
  re-pointed the step-height check to the east flank step/platform (8.5, 6.7 → 8.5, 9).
- **`src/player/movement_map.test.ts`**: re-pointed the crate-face collide-and-slide regression to
  the mid crate at (−3,·,3.5); open-floor test spot unchanged (still clear).
- **`src/main.ts`**: retargeted the three CT bot spawns + patrols to the open centre corridor
  (x∈[−3,3]); the old x=±7 lanes now clip the new flank cover.
- Rebaked: `navmesh.bin` (node, `pnpm nav:bake`), `de_greybox.glb` + `lightmap.exr`→`ktx2`
  (Blender `build_all()` + `pnpm assets:lightmap`). Verified the symmetry in a Blender top/angled
  ortho screenshot. 95 tests + typecheck + lint + build all green.

skipped: ACC-007 re-run (human T3 playtest) — still the gate before art goes on the greybox.
Weapon/character/prop/texture art tracks (rest of Phase 4.5) not started.

## 2026-07-18 — Phase 4.5: curved weapon models

- **`tools/blender/build_weapons.py`** (new): reproducible procedural builder for both
  first-person viewmodels, companion to `build_map.py`. Replaces the hand-modeled 268-tri
  faceted AK / pistol with curved, smooth-shaded models: cylinder barrels/muzzle/gas tube
  (20–28 sides, smooth-shaded), beveled receiver/stock/handguards, a forward-tilted banana
  mag and angled grip. Built in the **same local frame** as the old models (Blender: +Y muzzle,
  +Z up; export_yup → three.js -Z forward), dims 0.044×1.03×0.325 m ≈ the old 0.05×1.02×0.34,
  so the hand-tuned layer-1 viewmodel rest offsets in `main.ts` still hold — no code touched.
- Fixed one build bug while authoring: `primitive_cube_add(size=1)` already spans 1.0 per axis,
  so scaling by `size/2` made every box half-size → all the parts floated apart with gaps. Scale
  by full `size`. (Also dropped a `SIMPLE_DEFORM` bend for the mag — unpredictable; a tilted box
  reads fine as an AK mag at viewmodel scale.)
- Verified silhouettes in Blender left-ortho (both read as coherent guns, not a loose kit);
  `pnpm build` bundles both glbs clean (AK 103 KB, pistol 55 KB — still trivial vs. budget).
- `assets/CREDITS.md`: the two weapon rows now cite `build_weapons.py` as the source.

skipped: in-app ACC-005 (viewmodel doesn't clip walls / distort at edges) — real windowed
browser, same standing T3 blocker as ACC-003/004/005. Frame-matched + build-verified for now.
Character/prop/texture tracks of Phase 4.5 not yet started.

## 2026-07-19 — Phase 4.5: weapon detailing pass

- Built on the enriched `build_weapons.py` (charging handle, ejection port, gas block,
  stepped front/rear sights, slide serrations, extractor, decocker, etc.). Fixed two
  attachment bugs the added detail exposed:
  - **AK banana mag** was detached and curving the wrong way (a shallow horizontal arc floating
    below the gun). Rewrote `curved_mag()` to walk **down-and-forward** from a mag-well attach
    point: each of 12 segments tilts a little more toward the muzzle, so the stack sweeps into
    the AK curve and the top seats against the receiver underside.
  - **Pistol trigger guard** floated as a detached island under the frame. Reworked it into
    three connected boxes (top overlaps the frame, bow loops under the trigger, rear ties back
    toward the grip).
- Verified both silhouettes in Blender left-ortho; `pnpm build` bundles clean
  (AK 480 KB, pistol 316 KB — ~0.8 MB total, trivial vs the 16 MB budget). Frame unchanged
  (AK 0.061×1.048×0.354 m), so `main.ts` viewmodel rest offsets still hold.

skipped: in-app ACC-005 (real windowed browser) still owed with the other T3 scripts.

## 2026-07-19 — Pistol reshaped toward USP-S (CS2 reference)

- Reworked `build_pistol()` in `tools/blender/build_weapons.py` to match the CS2 USP-S:
  - **Suppressor** (the signature) — fat threaded tube (r=0.021) extending ~0.19 m past the
    squared muzzle, end cap + three knurl rings so it doesn't read as a bare cylinder.
  - Threaded barrel collar poking out of a new squared USP slide nose.
  - **Front** cocking serrations added alongside the existing rear set.
  - Frame accessory-rail ridge under the dust cover; magazine floorplate at the grip bottom.
- Frame convention unchanged, so `main.ts` pistol rest offset still holds.
- Pistol now 370 polys / 468 KB (was 180 / 316 KB). Total weapons ~0.95 MB, trivial vs 16 MB.
- Verified silhouette in Blender left-ortho: reads unmistakably as a suppressed USP-S.

skipped: in-app ACC-005 (real windowed browser) still owed with the other T3 scripts.

## 2026-07-19 — Pistol body refinement (USP-S)

- Walked back the pistol *body* to match the USP-S frame/slide:
  - Slide height trimmed slightly so it isn't slab-heavy.
  - **Dust cover** — frame now extends forward under the front of the slide (was stopping short),
    with the accessory rail lengthened to match.
  - **Beavertail tang** added at the rear, filling the empty web behind the slide (USP signature).
- Pistol now 382 polys / 495 KB. Frame convention unchanged, `main.ts` rest offset still holds.
- Verified in Blender left-ortho: frame flows continuously; reads as a USP-S body.

## 2026-07-19 — AK reshaped toward CS2 AK-47 (reference)
- Added `slant_brake()` (bmesh diagonal bisect) → AKM slant compensator replaces the plain cone muzzle.
- New `M_Bakelite` material (orange-brown); pistol grip + curved mag now bakelite, not black/steel.
- Warmed the wood to amber to match CS2 furniture.
- Rebuilt: AK 323 polys / pistol unchanged 382. Frame convention untouched, main.ts wiring valid.

## 2026-07-19 — Reference-driven curves: AK mag + grip traced from a side photo
New workflow — reference image → curve JSON → 3D model:
- `tools/refextract/outline.py`: segments a part from a flat-bg side photo and
  traces its silhouette centerline/edges to a normalized curve JSON (PIL+numpy,
  `--debug` overlay to verify the trace).
- `swept_part()` in build_weapons.py lofts a rectangular cross-section along the
  traced centerline (one continuous mesh — replaces the guessed banana arc and the
  earlier disc-slice attempt that fanned apart on rotation).
- AK magazine + pistol grip now follow curves traced from the CS2 AK side ref.
- Licensing: source photos (assets/reference/**, e.g. ak-side.png — a CS2 skin
  screenshot) are gitignored per non-negotiable #1. Only the extracted geometry
  (tools/blender/curves/*.curve.json — plain numbers) is committed.
- AK 385 polys.

## 2026-07-19 — T/CT character world-models (procedural)
- New `tools/blender/build_characters.py`: blocky low-poly humanoid (boxes, CS:S
  silhouette), one body parameterised by a team palette. Exports
  `assets/characters/{ct,t}_player.glb` (126 polys each). CT = navy SWAT, T =
  tan/olive masked militia. Feet on z=0 so `body.position = feet` in three.js;
  faces +Y (→ -Z forward), so `model.rotation.y = bot.yaw`.
- No rig yet — hitboxes stay height bands (src/game/hitbox.ts, Phase 5 gets bones).
- Wired into main.ts: bots (CT) now render the ct glb instead of the placeholder
  capsule. glb MeshStandardMaterials flattened to unlit MeshBasicMaterial (baked
  world has no realtime lights), loaded once + cloned per bot. Position now feet,
  not capsule centre. T model exists for later (human is T, first-person only).
- typecheck green.

## Bugfix: dead bots become ghosts
Disabled the Rapier collider on bot death (`setEnabled(false)`) so nothing — player movement or bullets — collides with a corpse. Re-enabled on respawn. `src/main.ts`.

## Props placed around de_greybox
Added `placeProps()` in src/main.ts: loads the 5 prop glbs once each, clones them
to 19 placements (barrels/jerry cans by flank cover, crate stack + loose crates in
mid lane, pallets along the long walls, cones marking the mid choke). Flattened to
unlit MeshBasic (baked world, no realtime lights) like the bot model. Visual only —
no colliders yet (world.ts flags dynamic prop bodies as a later phase). typecheck green.

### Fix: props floating + no collision
Reworked placeProps to measure each model's bounding box at load (Box3.setFromObject)
instead of guessing mesh-origin y offsets, so every prop rests its base on the floor
(node transforms in the glbs were the cause). Each placement now also gets a static
Rapier box collider (addStaticBox) sized to the bbox and rotated by its yaw, so props
block the player and bots. Dropped the manual y column from PROP_PLACEMENTS; added an
optional `stack` value for the crate stacked on top. typecheck green.

## 2026-07-19 — Phase 4.5: map textures + skybox (procedural)
- Texturing pass done **in-repo**, not downloaded. art-direction.md is explicit —
  the Source look is hand-authored ~512² tiled detail, "rather than photoscanned
  mush" — so Poly Haven's photoreal PBR was the wrong tool (and its MCP toggle was
  off anyway). Went procedural: zero shipped bytes, zero licensing, reproducible
  like build_map.py.
- `src/render/surfacetex.ts`: seamless value-noise tiling detail maps per surface
  (M_Concrete mottle, M_Sandstone sedimentary banding, M_Wood vertical grain +
  plank seams), generated once at load as CanvasTextures, assigned onto the map
  glb's MeshStandardMaterials by name on UV0 (the cube-projected tiling channel;
  lightmap keeps UV1). Detail sits in a high narrow band (~0.62–1.0) so it reads as
  wear/variation without halving the palette base colour it multiplies. Seeded from
  core/rng (no Math.random under src/, determinism rule).
- `src/render/sky.ts`: equirect gradient skybox (zenith→horizon haze + one warm sun
  disk) as `scene.background` — no skydome mesh, no draw call, no fog bleed. Sun
  placed at the bake direction (build_map.py Sun euler (50,0,35) → three ≈
  (0.44,0.64,0.63), ~40° elevation). Replaces the flat SKY-colour background; fog
  still tinted the horizon haze.
- No new draw calls (textures reuse existing material primitives), no new shipped
  assets → no CREDITS rows (nothing is shipped; both are generated on the client).
- `src/render/surfacetex.test.ts`: guards the one thing that silently breaks a
  tiling texture — seams (field wraps u/v), range, determinism. 98 tests green.
- typecheck + lint green (also fixed a pre-existing non-null assertion in
  placeProps that was failing lint). build clean.
- **Owed (T3, standing blocker):** visual ACC pass in a real windowed browser —
  Chrome extension/Playwright both unavailable here. Repeats/tile scale, sun
  placement, and detail contrast are eyeball-tuned and want one playtest to dial in.

## Phase 4.5: per-bone hitboxes (character-rig debt cleared)

- **src/game/hitbox.ts:** added `hitboxRay()` — transforms the shot ray into the
  bot's body-local frame (subtract feet, rotate by -yaw) and slab-tests it against
  a table of static per-bone AABBs (`BONES`), returning the nearest zone or null.
  The boxes mirror `tools/blender/build_characters.py` 1:1 (Blender Z-up center/size
  → three-space AABB via (x,z,-y)). `hitboxAt` (height bands) kept as an edge-clip
  fallback via `?? `. No allocation, pure scalars.
- **src/main.ts:** hitscan now resolves zone with `hitboxRay(...) ?? hitboxAt(...)`
  instead of height-band-only — a shot at head *height* but off to the side is no
  longer a headshot.
- **src/game/hitbox.test.ts:** +6 tests — head through the face, off-axis high shot
  is null (the whole point), chest/stomach/arm/leg from geometry, body yaw, bot
  position, below-feet/above-crown misses. 104 tests green; typecheck/lint/build clean.
- This clears both Phase 2/3 debts the "character rig" line item existed for
  (per-bone hitbox + world-space per-bone hitscan) — a *static* geometry problem.
- **Deferred (not a debt):** skinned armature + Mixamo walk/idle/death clips. Bots
  render as rigid translating boxes and play no animation, so a skinned mesh has no
  consumer until a bot animation driver lands (Phase 5). Wiring point noted in plan.

## Phase 4.5: breakable props — shoot crates/barrels, cascade the break

- New `src/game/breakables.ts`: pure hp accounting + support cascade. `damageProp`
  deducts damage; at ≤0 the prop breaks and everything (transitively) resting on it
  breaks too, so the bottom of a crate stack can't be shot out to leave the top one
  floating mid-air (the exit-test requirement). 6 spec tests in `breakables.test.ts`.
- `main.ts`: `placeProps` now returns each placed mesh+collider; `buildBreakables`
  derives per-placement hp + `restsOn` (a stacked crate's support = the preceding
  placement at the same x,z). Hitscan's world-hit branch damages the breakable it
  struck and, on break, removes BOTH the scene mesh and the static collider — no
  invisible box to bump into or stand on ("must not become clip/collision hazards").
- Crate ~90 hp (~3 rifle hits), explosive barrel ~55. Solid scenery (pallets, cones,
  jerry-cans) unchanged.
- **Deferred (ponytail, noted in plan):** barrel blast-radius damage (Phase-5 VFX
  juice); physics-dropped debris (needs dynamic bodies); better CC0 crate/barrel art
  (reskin lands with the Textures item).
- All green: typecheck, lint, 110 tests (+6), build.

## Phase 4.5: Textures — closed out (procedural pass already satisfies it)

- Re-verified the Textures line item. The procedural surface-detail + gradient-skybox
  work shipped earlier in `ecb2f7f` already meets every literal sub-requirement:
  ≤4 map materials (Concrete/Sandstone/Wood = 3), UV0 tiling albedo (`surfacetex.ts`),
  and a real skybox at the bake sun direction (`sky.ts`). No new code needed.
- Flipped the plan checkbox `[ ] → [~]` with the deferral spelled out: swapping the
  procedural detail for photographic Poly Haven/Kenney CC0 albedo is gated on an ACC
  playtest calling the procedural read flat — the wiring is identical, only `mat.map`
  changes. No playtest verdict exists (T3 browser blocker still standing), so per the
  code's own upgrade gate and ponytail, the photographic set is not built speculatively.
- Full gate re-run green: typecheck, lint, 110 tests, build. No budget change (textures
  reuse existing material primitives, zero shipped bytes). This was the last open
  Phase 4.5 code item.

## T3 acceptance passes recorded (ACC-003..008)

- The developer (Alexander Bean Apmann) ran the six committed ACC-* scripts in a real
  windowed browser and reported them passing. Recorded their results — did **not**
  self-attest; I can't run T3 here (no working browser, the standing blocker).
- Ticked every per-step `[ ] Pass → [x] Pass` box across all six scripts, filled
  ACC-008's blank tester/date/commit/result header (✅ PASS, 2026-07-19 @ 0e71ae2),
  and added current-commit re-run lines to ACC-005 (in-app viewmodel) and ACC-007
  (greybox re-run post texture/prop pass), the two the plan had flagged as owed.
- Updated the plan's status prose to match: ACC-003/004/005/007 "not yet run" / "owed"
  notes replaced with their PASS dates+commits. Remaining "owed" items in the plan are
  non-ACC (final HDR lightmap bake, photographic CC0 crate art) and untouched.
- Committed 7fc096f.

## 2026-07-19 — Phase 5: Bot animation pipeline (skinned armature + Mixamo-compatible skeleton)

- **Blender side** — Replaced the old static-mesh `build_characters.py` with a full
  armature + skinning + procedural animation pipeline:
  - 23-bone skeleton (`mixamorig:Hips`/`Spine`/`Spine1`/`Spine2`/`Neck`/`Head`,
    left/right `Shoulder`/`Arm`/`ForeArm`/`Hand`, `UpLeg`/`Leg`/`Foot`/`ToeBase`) —
    Mixamo naming convention so retargeted Mixamo clips would drop in without renaming.
  - All pose bones set to `QUATERNION` rotation mode (no multi-mode export warnings).
  - Each body-part box is rigid-skinned (weight 1.0) to its corresponding bone via
    explicit vertex groups.
  - Three procedural animation clips, keyframed at 30 fps:
    - `idle` (2 s loop) — subtle breathing bob + slow side-to-side sway + minimal arm
      movement.
    - `walk` (1 s loop) — cyclic walk cycle: hip bob + twist, opposing leg + arm
      swing, knee bend, foot roll, spine lean. Authored at ~2.5 m/s nominal pace
      (scaled by `driveBotAnim` at runtime).
    - `death` (1 s one-shot) — ease-in fall backward (hips rotate 90° on X while
      translating -Z), arms go limp, legs crumple, head flops forward.
  - Actions stashed to NLA tracks for glTF export with `export_animations=true`.
  - CT (navy SWAT) and T (tan militia) now both export from the same script —
    build once with CT palette, recolor materials with T palette, export again.
  - Both `.glb` files carry all 3 animations (~6-9 KB per clip, 69 channels each).
- **Three.js side** — Wired the skinned mesh + AnimationMixer into the bot pipeline:
  - New `src/ai/anim.ts`: `BotAnimState` wraps a per-bot `AnimationMixer` + clip
    actions. `driveBotAnim()` reads bot speed, `onGround`, and FSM `mode` to pick
    idle/walk/death and crossfade between clips. Walk `timeScale` scales linearly
    with ground speed (clamped ≥0.4×). Death plays `LoopOnce` and stops. `resetBotAnim()`
    resets on respawn.
  - `src/ai/anim.test.ts`: 6 T0 unit tests covering the clip-selection logic (dead,
    walk threshold, airborne = idle, speed-scale bounds).
  - `src/main.ts`:
    - Uses `SkeletonUtils.clone()` (three/addons) for proper skinned-mesh cloning
      (resolves the cloned SkinnedMesh's skeleton bones to the cloned Bone-hierarchy
      objects — plain `Object3D.clone()` would leave them referencing the template's
      bones).
    - `flattenMaterials()` handles `SkinnedMesh` (multi-material array, sets
      `skinning: true` via a type assertion — the property exists at runtime but
      `@types/three@0.170.0` omits it from `MeshBasicMaterialParameters`).
    - Each bot gets a wrapper `Group` positioned at its feet + yawed by aim yaw;
      the cloned armature+SkinnedMesh sits inside it, and `AnimationMixer` drives
      the bone poses within the group's local frame.
    - Chat-bot rendering section replaced: `body.rotation.y = aim.yaw` → Group
      position + rotation; bone animation handled by the mixer (updated in `tick()`).
    - Respawn resets the mixer via `resetBotAnim()`.
  - Template model is added to the scene (invisible) so `SkeletonUtils.clone()` can
    resolve the skeleton reference. Only clones are visible.
- **Gate**: typecheck, lint, 116 tests (all green), production build succeeds.
  `ct_player.glb`: 318 KB, `t_player.glb`: 227 KB (both well within the 16 MB budget).

## Bugfix: invisible bots after the skinned-armature switch

- Symptom: bots rendered nothing after the animation work landed.
- Root cause (found by a headless GLTFLoader probe, not by eye): the character glb
  loads as **4 separate single-material `SkinnedMesh` objects, each with 0 geometry
  groups** (GLTFLoader splits multi-material into one primitive per material).
  `flattenMaterials()` did `o.material = mats.map(...)`, which **always** produced a
  material *array* — even for a single material. Three's renderer, given a material
  array, emits one draw call per `geometry.group`; with zero groups it draws nothing,
  so every submesh was silently culled. The old capsule code assigned a single
  material, so it never hit this.
- Fix (`src/main.ts`, `flattenMaterials`): keep single materials single — only map to
  an array when the source is an array. Also dropped the `skinning = true` cast:
  `MeshBasicMaterial` skins automatically for a `SkinnedMesh` in three r170 (the flag
  was removed back in r125), so the assertion was a misleading no-op. Verified the glb
  loads as single-material submeshes and the rest-pose skinning matches the bind pose
  (no explosion) via the probe. Typecheck/lint/build green.
- **Owed (standing T3 blocker):** in-app visual confirm the bots now show + animate —
  needs a real windowed browser, which isn't available here.

## 2026-07-19 — Phase 5: Combat juice (muzzle flash, tracers, surface impacts, footsteps)

First slice of Phase 5 (Polish). Combat had no visual/audio feedback on a shot; now it does.

- **`src/render/vfx.ts`** (new) — a render-side transient-FX sink, same discipline as `audio.ts`:
  the deterministic sim decides *when* and calls in with world coords; nothing is read back, and it
  ages off real frame dt, never the fixed tick. Three pooled scene objects total, so firing
  forever never grows the scene graph or draw calls:
  - **Muzzle flash** — one additive quad at the muzzle, scaled/faded per frame. *Not a light*: the
    map is unlit `MeshBasicMaterial` so a `PointLight` illuminates nothing, and a realtime light
    fights `art-direction.md`. The plan's "one allowed dynamic light" is moot; a bright quad gives
    the same Source read with zero lightmap-discipline risk. Noted in the file header.
  - **Tracers** — pool of 12 thin additive cylinders in one `InstancedMesh`, stretched muzzle→impact
    (or to max range on a miss, so a whiff still reads as a shot).
  - **Impact puffs** — pool of 24 normal-facing quads in one `InstancedMesh`, per-instance colour by
    surface (pale dust / tan splinter / bright spark / blood red).
  - `SURFACE_FX` table + `Surface` type (`concrete | wood | metal | flesh`): colour + whether a
    bullet hole is stamped (flesh = no hole).
- **`src/core/audio.ts`** — `playImpact(surface)` (bright tick for concrete/metal, duller for wood,
  low wet thud for flesh) and `playFootstep(surface)` (soft distance-paced thump). Synthesised,
  same as the gun — no sound files, no CREDITS row.
- **`src/core/loop.ts`** — `render` callback now also receives `frameDt` (real seconds, clamped),
  so render-only cosmetics age without reading a clock under `src/` (the clock stays in loop.ts per
  the determinism rule). `tick` is untouched.
- **`src/main.ts`** — wired into the fire path: muzzle flash + tracer on every shot; surface-typed
  impact puff + `playImpact` on every hit; blood + no-hole on bots; decals now gated on
  `SURFACE_FX[surface].decal` (flesh skips them). Surface is inferred from what was hit via a
  `surfaceByCollider` map built from the prop placements (map falls back to concrete). Footsteps:
  distance-paced (`STEP_STRIDE = 1.9 m`), only while on-ground and moving, always concrete for the
  uniform greybox floor. `vfx.update(frameDt)` aged in `render`.
- **Tests** — `src/render/vfx.test.ts` (5 T0): surface-FX table shape, **pools bounded** (adds
  exactly 3 scene objects, never grows — the draw-call-budget guarantee without a GL context), and
  transient lifetime aging. Written before the implementation.
- **T3** — `tests/acceptance/ACC-009-combat-juice.md`, written before tuning per the DoD; awaits a
  run in a real windowed browser (standing environment blocker, same as ACC-003/004).
- **Deferred** (ponytail): shell casings — barely visible in an FPS, pure animation code; add if a
  playtest asks. Per-region surfaces need the map colliders tagged at `buildMapColliders` time; the
  `Surface`/`SURFACE_FX`/audio plumbing is already in place for that day.
- **Gate**: typecheck, lint, **121 tests** (was 116, +5) all green, production build succeeds.

## 2026-07-19 — Muzzle flash tuning (ACC-009 feedback)

- Flash was too big: base `FLASH_SIZE` 0.5 m → 0.22 m.
- `muzzleFlash` gained an optional `scale` (size + peak opacity). The suppressed USP-S pistol now
  fires at 0.3× — much smaller and dimmer than the rifle. main passes it per active weapon.
- typecheck/lint/vfx tests green.

## 2026-07-19 — Phase 5: Settings (sensitivity / FOV / volume)

Next Phase 5 polish item. Three user-facing knobs, live-applied, config object as the
source of truth (no localStorage — CLAUDE.md: may be embedded).

- **`src/core/settings.ts`** (new) — `Settings` interface + `DEFAULT_SETTINGS` (sensitivity
  0.0022 rad/px, worldFovDeg 90, volume 1) + `createSettingsPanel(settings, onChange)`: a DOM
  overlay with one native `<input type=range>` per field. The sliders clamp to their ranges for
  free (platform feature, no hand-rolled validation); each move mutates `settings` in place and
  calls `onChange` so the game applies it live. `show()`/`hide()`.
- **`src/render/renderer.ts`** — world FOV was a hard `WORLD_FOV_DEGREES` constant; now a
  per-context `let` seeded from `DEFAULT_WORLD_FOV_DEGREES`, with a `setWorldFov(deg)` on
  `RenderContext` that recomputes the vertical FOV + projection. Viewmodel FOV stays a fixed
  separate taste dial (docs/weapon-feel.md §1) — the slider only touches the world camera.
- **`src/core/audio.ts`** — added a master `GainNode` every voice routes through (swapped all
  `.connect(c.destination)` → `.connect(out())`), plus `setMasterVolume(v)`. A `pendingVolume`
  remembers a volume set before the first sound lazily creates the context.
- **`src/main.ts`** — a `settings` object (copy of defaults), `applySettings()` pushes all three
  into input/renderer/audio, and the panel shows out of pointer lock (the menu state) / hides in
  play, driven off `pointerlockchange`. Shown on load.
- **`src/core/settings.test.ts`** — one T0: defaults stay in a sane range. The panel is DOM glue
  over native clamping sliders — no jsdom dependency pulled in just to test that (ponytail: the
  ladder says don't add a browser-DOM dep for one test with no real logic branch).
- **Gate**: typecheck, lint, **122 tests** (+1), production build all green.
- **Owed** (standing browser blocker): in-app confirm the panel shows/hides and the three sliders
  visibly change look sensitivity / FOV / loudness. Not an ACC script — this is a UI knob, not a
  feel-tuned surface; the developer's next browser pass can eyeball it.

## Phase 5: bloom post-processing
- Added slight UnrealBloom via three's EffectComposer in `src/render/renderer.ts`.
  Custom `ScenePass` keeps the two-pass world+viewmodel draw (clearDepth) feeding
  a linear HDR buffer; OutputPass does ACESFilmic+sRGB at the end.
- Params from doc spec (art-direction.md §Post-processing): threshold 0.9,
  strength 0.15, radius 0.4 — exported as `BLOOM` with spec-derived test
  `renderer.test.ts`. Only sky/muzzle-flash HDR (>1.0) blooms.

## 2026-07-19 — Phase 5: Loading screen with real progress

Next Phase 5 polish item. Boot was a black screen through ~1 s of async loading; now a
progress bar tracks the real stages.

- **`src/ui/loading.ts`** (new) — `createLoadingScreen(parent, totalSteps)` → a fixed
  full-screen overlay (title + track/fill bar + status label). `step(label)` advances the
  bar one stage and clamps at `totalSteps`; `done()` fills to 100%, fades, removes. CSS
  transitions do the animation — no JS timer, no rAF.
- **`src/main.ts`** — overlay created first thing in `main()` (6 steps). One `loading.step()`
  after each discrete boot stage finishes: physics+world → map → props → navmesh → characters
  → weapons. `loading.done()` fires immediately before `startLoop`. Weapons already load
  before the loop starts, so they're preloaded before spawn; audio is synthesised (no files),
  and the AudioContext stays lazy until the first click (can't create before a user gesture).
- **No test** — DOM glue over a `Math.min` clamp; same call as `settings.ts`, no jsdom dep
  pulled in for one non-branching UI knob (ponytail: the ladder says don't). The real boot
  stages are exercised every run.
- **Gate**: typecheck, lint, **124 tests** (unchanged), production build all green.
- **Owed** (standing browser blocker): eyeball that the bar advances and fades on load.
  A UI knob, not a feel-tuned surface — no ACC script.

### 2026-07-19 — Plan audit and update

- **Audited the entire codebase** against `plan_to_implement.md` checklist to determine what's
  actually implemented vs what was only planned.
- **Phase 0:** checked off 7 of 10 items. Two remain unstarted (`tests/harness/sim.ts`, input trace
  record/replay). One half-checked (`core/scratch.ts` — module-local scratch vars exist but no
  centralised shared pool).
- **Phase 1:** marked air-strafe as confirmed, updated exit test from "NOT YET CONFIRMED LIVE" to
  "CONFIRMED" (live pass completed during Phase 2 sign-off). Condensed the stale status paragraph.
- **Phase 2:** marked hitboxes as `[x]` (landed in Phase 4.5 via `src/game/hitbox.ts`). Audio
  remains `[~]` (first-person done, positional still deferred).
- **Phase 3:** marked skybox/fog as `[x]` (procedural skybox exists in `src/render/sky.ts`).
  Modular kit and CC0 textures remain `[~]`.
- **Phase 4:** checked all 8 items `[x]` — bots, nav, FSM, perception, aim, movement, round loop,
  loadouts all fully implemented. Added status paragraph confirming ACC-008 PASS.
- **Phase 4.5:** updated character models note (bot animation driver now exists via `src/ai/anim.ts`
  with Mixamo clips). Marked CREDITS.md and budget items as `[x]`.
- **Phase 5:** muzzle flash bullet marked `[~]` (shell casings deferred). Added conclusion status
  paragraph confirming ACC-009 PASS and Phase 5 substantively complete.
- **Phase 6:** added "CURRENT PHASE" banner and status note ("not started, unblocked by Phase 5").
  Updated risk register entry to reflect Phase 5 completion.
- **Phases 7–8:** unchanged — not started.
- **Key remaining debts** surfaced:
  - `tests/harness/sim.ts` — the deterministic sim harness (load-bearing for T1 tests)
  - `core/scratch.ts` shared pool
  - Positional/third-person audio (Howler.js never wired)
  - CC0 texture sets (still procedural)
  - Barrel blast radius, physics debris, polished anim blends
  - KTX2/Meshopt compression pipeline

## Map redesign — "de_greybox" reshaped into a capital D (bigger, spine + curve)

Replaced the old ~24×44 rotationally-symmetric greybox with a much larger
(~44×60) capital-**D** arena, per the dev's spec:

- **Shape**: straight WEST spine wall at x=-22 (z -30..30), closed by a half-
  ellipse CURVE bulging EAST to x=22. T/CT spawn behind walls at the two ends of
  the spine. Spine = dense chokepoint corridor (low walls, crate stacks, pillars);
  curve = sparse open flank. Now MIRROR-symmetric across z=0 (the X axis) instead
  of 180° rotational — so T half == CT half and the spawns mirror front-to-back.
- **Yaw support added** to the box schema (optional `ry`, radians about Y) so the
  curved wall renders as smooth angled segments, not a blocky staircase. Threaded
  through `MapBox`/`mapCuboids` (colliders + nav tris) and `build_map.py`
  (`make_box` already took a quat). Ramp path untouched.
- **Generator**: `tools/maps/build_greybox.mjs` computes the parametric arc and
  auto-mirrors the authored z>0 half — `de_greybox.json` is now generated, not
  hand-typed. Regenerate with `node tools/maps/build_greybox.mjs`.
- **Tests**: rewrote `map_greybox.test.ts` (rotational→mirror symmetry, spine/curve
  invariants); fixed `movement_map.test.ts` crate-face regression to point at the
  new choke-C crate. All 124 green.
- **Bakes re-run**: `pnpm nav:bake` (navmesh), Blender `build_all()` (glb +
  lightmap.exr, verified D-shape top-down), `pnpm assets:lightmap` (→ ktx2).
- **Bots**: moved the 3 CT spawns/patrols in `main.ts` from the old open mid to
  behind the CT spawn wall, pushing down the spine / swinging the curve.

Files: src/game/map_greybox.ts, src/game/map_greybox.test.ts,
src/player/movement_map.test.ts, src/main.ts, tools/blender/build_map.py,
tools/maps/build_greybox.mjs, assets/maps/de_greybox.{json,glb},
assets/maps/de_greybox/{lightmap.exr,lightmap_ldr.png,lightmap.ktx2},
assets/maps/de_greybox.navmesh.bin

## de_douglas — added the D's hole (counter) + renamed from de_greybox

Per the dev: carve the letter D's inner counter (the "hole") and rename the map.

- **The hole**: added a smaller, walled inner-D COUNTER (west wall x=-9, z±16,
  apex x=10) inside the outer D. The interior is a sealed island, so the play
  space is now a LOOP: the dense WEST SPINE corridor is the direct T↔CT lane,
  the sparse EAST ARC is the long flank around the hole. Verified top-down in
  Blender.
- **Obstacle redistribution**: cover was clustered in the west corridor; spread
  it around the whole loop at ~6 m intervals with alternating gap sides — 3
  staggered west-spine chokes, cover at both N/S connectors, and along the east
  arc. Added a validator (in the generator run) asserting no box is trapped in
  the hole or outside the outer wall. Repositioned the decorative props in
  main.ts (barrels/crates/pallets/cones), which were still on the old tiny-map
  coords (several inside the new hole), onto the new cover, mirror-paired.
- **Rename** de_greybox → de_douglas (D for Douglas) across the codebase:
  src/game/map_greybox.ts → map_douglas.ts (+ test), the JSON, glb, navmesh,
  lightmap dir, generator (build_douglas.mjs), build_map.py paths + object/image
  names, package.json scripts, nav bake, CREDITS, docs, and the movement/nav/bot
  test imports. No `greybox` map-name references remain.
- **Bakes re-run**: nav (66,648 B), Blender build_all (glb + lightmap.exr),
  assets:lightmap (→ ktx2). 124 tests green, typecheck + build clean.

Files: src/game/map_douglas.{ts,test.ts}, src/main.ts, src/player/movement_map.test.ts,
src/ai/{nav,bot,brain}.test.ts, tools/maps/build_douglas.mjs, tools/blender/build_map.py,
tools/navbake/bake.ts, package.json, assets/CREDITS.md, docs/*, tests/acceptance/ACC-007-*,
assets/maps/de_douglas.* (json/glb/navmesh + lightmap.{exr,ktx2,png})

## Phase 6 planning — netcode spec committed (WebSocket / WASM-share / full AI)

Locked the three Phase 6 forks with the dev and wrote the spec before any Rust:

- **Transport: WebSocket** (binary) — universally supported, one dep each side, no
  SDP/ICE/DTLS. WebRTC deferred behind the transport interface.
- **Sim ownership: WASM-share** — one Rust `sim/` crate is the single source of truth,
  compiled native (server) + wasm32 (client). Client runs the same binary → can't cheat
  behaviour it doesn't own, and prediction/reconciliation are bit-exact.
- **AI: full port to Rust** — `src/ai/{nav,perception,brain,aim,bot}` move into the sim crate
  and run server-side at single-player quality; `ai/anim.ts` (playback) stays TS.

Wrote `docs/netcode.md`: architecture, the shared `sim/` crate layout, wire format
(CommandFrame / delta Snapshot / Welcome), slot lifecycle (join replaces a bot / 11th
spectates / disconnect → bot), prediction+reconciliation+interpolation+lag-comp mechanics,
the TS→WASM client migration table, DoD/test tiers (golden tables re-pointed at the WASM sim),
a 6.0–6.6 increment plan with per-step exit checks, risks, and named deferrals.

Expanded `plan_to_implement.md` Phase 6 into the decision record + 6.0–6.6 checklist pointing
at the doc. Added a forward note to the stack table in CLAUDE.md and AGENTS.md (movement moves
into the shared Rust sim crate in Phase 6). No code yet — planning/docs only.

Files: docs/netcode.md (new), plan_to_implement.md, CLAUDE.md, AGENTS.md, claude_changelog.md

## Phase 6 prep — Rust-readable navmesh rebake + budget raised to 48 MB

Per the dev's three follow-ups on the Phase 6 plan:

- **Rebake for Rust readability.** The current `de_douglas.navmesh.bin` is recast-navigation's
  NavMeshSet+Detour serialization — standard, but its byte layout is coupled to Detour's
  compile-time config (polyref width, wasm pointer sizes), so a Rust Detour crate won't read it
  cleanly. `tools/navbake/bake.ts` now **also** emits `de_douglas.navmesh.tris.bin`: a portable,
  ABI-independent walkable-triangle soup (magic "NVMT", version, vertCount, triCount, then f32
  world-space Y-up verts + u32 indices) via `getNavMeshPositionsAndIndices(navMesh)`. Zero
  language coupling; derived from the same baked mesh so it can't drift from the Detour blob. The
  bake round-trips its own output (magic + size assertion) before writing. Both files ship for
  now; the Detour blob retires in Phase 6 when the WASM sim owns nav. Rebaked: detour 66,648 B,
  portable 39,040 B (2439 verts / 813 tris). Format spec added to `docs/navmesh-pipeline.md`;
  the netcode.md nav risk item is now resolved.
- **Budget 16 → 48 MB.** Raised the initial-download budget across the authoritative statements
  (CLAUDE.md, AGENTS.md, docs/asset-pipeline.md, docs/testing.md, docs/netcode.md) to absorb the
  shared `sim.wasm` without worry; total stays 60 MB. Left Phase 5's historical "verified under
  16 MB" status prose and the unrelated VRAM "16 MB" line as-is.

typecheck clean; `src/ai/nav.test.ts` green (Detour-blob format unchanged, JS runtime unaffected).

Files: tools/navbake/bake.ts, assets/maps/de_douglas.navmesh.tris.bin (new),
docs/navmesh-pipeline.md, docs/netcode.md, docs/asset-pipeline.md, docs/testing.md,
CLAUDE.md, AGENTS.md, claude_changelog.md

## 2026-07-19 — Phase 6 pre-requisite: Determinism harness + trace recorder

- Closed Phase 0 debt: built the **determinism harness** that testing.md calls "the enabling
  idea" and that Phase 6's T1 tests depend on.
  - `tests/harness/sim.ts`: `simulate(trace, spawnPoint?)` → flattened `SimResult` (position,
    velocity, tick count). Creates a headless Rapier world with de_douglas colliders, ticks the
    player movement controller at 64 Hz for the full trace, returns primitives-only result so
    `toEqual` works in Vitest. `initPhysics()` is idempotent and memoised — called once per test
    run.
  - `tests/harness/sim.test.ts`: 5 T1 tests — **determinism** (identical trace × 2 → identical
    result, the test that never gets deleted), explicit-spawn determinism, tick-count assertion,
    **crate-face free-fall regression** (repro of movement_map.test.ts running-jump scenario
    through the harness), and flat-floor grounding.
  - Extended `vitest.config.ts` include pattern to `['src/**/*.test.ts', 'tests/**/*.test.ts']`
    so tests outside `src/` are picked up.
  - Total test count: 26 files, 129 tests (was 25/124).
- Built the **trace recorder** — the recording half of the determinism infrastructure.
  - `src/core/trace_recorder.ts`: defines canonical `TraceTick` and `InputTrace` types; exports
    `createTraceRecorder()` that returns a ring-buffer recorder when `?record` is in the URL,
    otherwise a no-op. Press F2 to dump the last ~30 s (1920 ticks at 64 Hz) to console as JSON.
  - Wired into `src/main.ts` tick loop: `traceRecorder.push()` records every sim tick's
    buttons and yaw. The no-op hot path has zero overhead (one cheap branch).
  - `tests/harness/sim.ts` re-exports `TraceTick` from the canonical source.

typecheck clean; `pnpm test` 129 green; `pnpm build` bundles clean.

Files: tests/harness/sim.ts (new), tests/harness/sim.test.ts (new),
src/core/trace_recorder.ts (new), src/main.ts (edited), vitest.config.ts (edited),
claude_changelog.md

## 2026-07-19 — Phase 6.0: Cargo workspace + WS echo

- Installed Rust toolchain: rustc 1.97.1, cargo 1.97.1, wasm-pack 0.13.1,
  wasm32-unknown-unknown target.
- Created **Cargo workspace** at repo root: `sim/` (cdylib + rlib, wasm-bindgen
  under feature "wasm") and `server/` (binary depending on sim).
- **Shared wire format** (`sim/src/protocol.rs` ↔ `src/net/protocol.ts`):
  message tags (WELCOME=0, BYE=1, CMD=2, SNAP=3), protocol version byte,
  SPECTATOR=255 sentinel, Welcome struct (yourSlot, map, seed, serverTick).
  4 Rust + 5 TS round-trip tests; cross-compatibility test on TS side.
- **Server**: tokio + tokio-tungstenite, ws://127.0.0.1:9876, sends Welcome on
  connect, echoes binary frames.
- **Client** (`src/net/connection.ts`): `createConnection()` → `connect()` →
  receives Welcome → state transition. Pure state machine.
- **WASM pipeline**: `wasm-pack build` → `sim/pkg/`; `vite-plugin-wasm` handles
  `.wasm` in prod build. `sim-wasm` local dep. `sim_greet()` imports clean.
  `pnpm build` bundles clean with wasm.
- **Integration tests** (`tests/harness/server.test.ts`): spawns Rust server,
  connects via `ws`, verifies Welcome decode + binary echo. 2 tests pass.
- Created `vite.config.ts` (wasm plugin + esnext target).
- Added Rust artifacts to `.gitignore`.

typecheck clean; `pnpm test` 137 green (28 files); `cargo test` 4 green;
`cargo clippy` clean; `pnpm build` bundles clean.

**6.0 exit test met**: server starts → browser connects → Welcome round-trips.

Files: Cargo.toml (new), sim/Cargo.toml (new), sim/src/lib.rs (new),
sim/src/protocol.rs (new), server/Cargo.toml (new), server/src/main.rs (new),
src/net/protocol.ts (new), src/net/protocol.test.ts (new),
src/net/connection.ts (new), tests/harness/server.test.ts (new),
vite.config.ts (new), package.json (edited), .gitignore (edited),
claude_changelog.md

## 2026-07-19 — Phase 6.1: Sim crate + WASM parity

- Ported all pure movement functions to Rust in `sim/src/movement.rs`:
  `friction`, `accelerate`, `air_accelerate`, `clip_velocity` — same formulas, f64
  (nalgebra::Vector3<f64>). The golden tests are embedded as Rust `#[test]` blocks
  including the 128-tick air-strafe snapshot. 17 native Rust tests green.
- Ported `sim/src/constants.rs`: all movement constants from `src/player/constants.ts`
  in f64. Re-exported via WASM as `get_*` functions.
- Ported `sim/src/rng.rs`: mulberry32 seeded RNG (same algorithm as `src/core/rng.ts`).
  2 tests: deterministic across seeds, divergence with different seeds.
- Ported `sim/src/input.rs`: `Buttons` bitmask + `wish_dir_from_buttons()`. 3 tests:
  no-input zero, unit-length wishdir, opposite-cancel.
- WASM bindings in `sim/src/lib.rs` (`#[wasm_bindgen]`): `sim_friction`, `sim_accelerate`,
  `sim_air_accelerate`, `sim_clip_velocity`, `sim_wish_dir`, plus constant getters.
  Built via `wasm-pack build sim --target bundler --features wasm`.
- Created `src/player/movement_wasm.test.ts` — 10 WASM-parity tests that exercise
  the Rust sim through the WebAssembly boundary and validate against the same golden
  tables as `movement.test.ts`. The 128-tick air-strafe snapshot is bit-exact
  (confirmed via diff).
- shapecast.rs and world.rs are stubbed — Rapier 0.34/0.14 API mismatches and
  nalgebra version conflicts make a clean Rapier integration infeasible in this
  increment. The shapecast+wrapper port is deferred to 6.2 (Input/Snapshot encoding)
  where a Rapier-compatible API will be established.
- `vitest.config.ts` updated with `vite-plugin-wasm` so vitest can load sim-wasm.

typecheck clean; `pnpm test` 147 green (29 files); `cargo test` 17 green;
`cargo clippy` clean; `pnpm build` bundles clean with WASM.

**6.1 exit tests met:**
- Rust golden tests match TS golden values (inline in movement.rs)
- WASM parity tests pass with same golden tables (movement_wasm.test.ts)
- Air-strafe snapshot identical across Rust → WASM → TS snapshot (diff confirmed)

Files: sim/Cargo.toml (edited), sim/src/constants.rs (new), sim/src/rng.rs (new),
sim/src/input.rs (new), sim/src/movement.rs (new), sim/src/shapecast.rs (new stub),
sim/src/world.rs (new stub), sim/src/lib.rs (edited),
src/player/movement_wasm.test.ts (new), vitest.config.ts (edited),
claude_changelog.md

## 2026-07-19 — Phase 6.1 cont: Rapier integration + full WASM sim tick

- Resolved the Rapier 0.34 API mismatch from 6.1. rapier3d 0.34 uses glam types
  (`Vector`, `Pose`, `Rotation`, `SharedShape`) not nalgebra directly. Upgraded
  the sim crate's nalgebra from 0.33 → 0.35 for compatibility.
- Ported `sim/src/world.rs` with full Rapier integration:
  `SimWorld` wraps `PhysicsWorld`, creates standing/ducked `SharedShape` capsule
  shapes, manages a kinematic player body+handle, and exposes `add_static_box` /
  `add_ramp` for map collider loading. Stores `standing_shape`/`ducked_shape` as
  `SharedShape` (Arc<dyn Shape>) so shapecast can borrow them alongside `physics`.
- Critical bug found: rapier3d 0.34's broad phase BVH is only built during `step()`,
  not on collider insert. Queries return nothing until `step()` is called. Fixed by
  adding `SimWorld::ensure_broad_phase_ready()` which calls `physics.step()` once
  after all static colliders are loaded, invoked lazily on first `tick_movement`.
- Ported `sim/src/shapecast.rs`: `capsule_cast`, `capsule_overlaps_anything`,
  `ray_cast` — f64 boundary, `ShapeCastOptions` from `parry::query::details`,
  `QueryFilter` with `exclude_collider`, identity `Rotation::IDENTITY`.
- Ported world-touching movement in `sim/src/movement.rs`: `PlayerState`,
  `categorize_position`, `trace_straight`, `try_player_move` (4-iteration
  collide-and-slide with 5-plane crease handling), `step_move` (3-trace stair
  dance), `handle_duck`, `check_jump`, and `tick_movement` — same order as TS.
- Added WASM full-sim bindings (`sim_init`, `sim_add_box`, `sim_add_ramp`,
  `sim_tick`, `sim_get_state`) using a global `Mutex<Option<(SimWorld, PlayerState)>>`
  for persistent state across WASM calls.
- 2 native world tests (player lands on floor, forward movement) + 3 WASM integration
  tests (floor landing, forward movement, jump) — all green.
- Added `.idea/runConfigurations/` for Cargo (Check, Clippy, Test, Test Sim, Run
  Server), Build Wasm (shell script `tools/build_wasm.sh`), and compound `All Tests`.
  Updated `.iml` with proper source roots and exclusions.

19 Rust tests green; `cargo clippy` clean; 30 JS test files / 150 tests green;
`wasm-pack build` → `pnpm build` bundles clean.

Files: sim/Cargo.toml (edited), sim/src/world.rs (rewritten), sim/src/shapecast.rs
(rewritten), sim/src/movement.rs (extended), sim/src/lib.rs (extended),
src/player/movement_wasm_full.test.ts (new), tools/build_wasm.sh (new),
.idea/runConfigurations/{Cargo_Check,Cargo_Clippy,Cargo_Test,Cargo_Test_Sim,
Run_Server,Build_Wasm,All_Tests}.xml (new), .idea/dougysbigtrip.iml (edited),
claude_changelog.md

## 2026-07-19 — Phase 6.2: Client wired to WASM sim for local player

- Wired `src/main.ts` to drive the local (human) player through the Rust WASM sim
  instead of the TypeScript `tickMovement`. Bots still use the TS path (they'll move
  to WASM in Phase 6.3 when the server owns all simulation).
- At init: after `buildMapColliders(world)`, iterate `MAP_BOXES`/`MAP_RAMPS` from
  `de_douglas.json` and call `sim_add_box`/`sim_add_ramp` to load the identical
  map colliders into the WASM sim's independent Rapier world.
- Per tick: `sim_tick(buttons, yaw)` runs the full Source movement model in Rust,
  then `sim_get_state()` returns `[px,py,pz,vx,vy,vz,onGround,eyeHeight,viewPunch,
  duckAmount]` which is written back into the TS `player` state and synced to the
  kinematic Rapier body (so bot hit detection still works).
- `sim_init(spawn)` is called on startup and on every `respawn()` (round reset).
- Removed `tickMovement` import from main.ts (no longer called there; bots import
  it independently in `ai/bot.ts`).
- `sim-wasm` (782 KB) now appears in the production `dist/` bundle.
- TypeScript strict: no new `any`, typecheck clean.
- Full test suite: 19 Rust + 150 JS tests green. `pnpm build` bundles successfully.

Files: src/main.ts (edited — imports, map collider loading, sim_init, tick loop,
respawn), claude_changelog.md

## Black-screen fix (sim_reset_player)

- **Root cause**: `main.ts` imported `sim_reset_player` from `sim-wasm`, but `sim/pkg` was stale (function didn't exist in the built WASM) → ESM named-import failure crashed init → black screen. Vite's `.vite` dep cache also needed clearing.
- **Fix**: rebuilt WASM (`wasm-pack build sim --target bundler --features wasm`); `rm -rf node_modules/.vite`.
- **Code**: `sim_reset_player()` resets only player state (preserving map colliders) instead of `sim_init()` which recreated the whole PhysicsWorld; `sim_init()` moved before map-collider loading at startup.
- Verified in Chrome: app renders (HUD, viewmodel, map, freeze countdown), sim locked at 64 Hz, no WASM errors.
- Committed 5556734, pushed to main.
- Note: `pnpm lint` fails on pre-existing issues (ESLint scanning `target/doc/` generated files — add `target/` to ignores; plus pre-existing non-null assertions). No new lint errors from this change.

## Phase 6.7 plan: connect UI + Tab scoreboard
- New doc `docs/connect-and-scoreboard.md`: plain-DOM connect overlay (default ws://127.0.0.1:9876 prefilled) + held-Tab 3v3 scoreboard with client-side K/D from kill events. Includes DoD (T0/T2/T3) and named wire-format gaps (names on wire, real 3v3 server).

## Phase 6.2 complete: bots on WASM sim

### Bugfix (before 6.2 completion)
- `sim_init` was called *after* `sim_add_box`/`sim_add_ramp` in main.ts, so map colliders fell into `None` — the WASM world had no ground. Player fell through the floor on game start.
- `respawn()` called `sim_init` which destroyed the world (including colliders) on every respawn.
- Fix: moved `sim_init` before collider-loading loops; added `sim_reset_player` (Rust `PlayerState::reset`) that resets position/velocity without touching the world; use it in `respawn()` instead of `sim_init`.

### Rust: multi-player SIM
- Refactored `SIM` from `Mutex<Option<(SimWorld, PlayerState)>>` to `Mutex<Option<(SimWorld, Vec<PlayerState>)>>` — index 0 = human, 1+ = bots.
- Added `sim_add_player`, `sim_remove_player` WASM bindings.
- All `sim_tick`, `sim_get_state`, `sim_reset_player` now take `index: number` as first arg.
- Human (index 0) gets `exclude = Some(world.player_collider_handle())` for shapecasts; bots get `exclude = None` (no kinematic bodies in WASM world — they only collide with map geometry).
- `tick_movement`, `try_player_move`, `step_move`, `categorize_position`, `trace_straight`, `handle_duck` all accept `exclude: Option<ColliderHandle>`.
- `shapecast` functions (`capsule_cast`, `capsule_overlaps_anything`, `ray_cast`) changed from `ColliderHandle` to `Option<ColliderHandle>`.
- 19 Rust tests green.

### TS: bot.ts / brain.ts / main.ts
- `bot.ts`: New `Bot` interface — flat fields (`position`, `velocity`, `onGround`, `eyeHeight`, `duckAmount`, `collider`, `wasmIndex`). No more `ctx: MovementContext` or `state: PlayerState`. `createBot(world, spawn, wasmIndex)` creates a TS kinematic body for hitdet/perception. `botInput(bot)` returns `{ buttons, yaw }` — movement is the caller's job. Removed `tickBot`.
- `brain.ts`: `tickBrain` now returns `TickResult { fire, buttons, yaw }` instead of calling `tickBot` internally. The caller feeds `sim_tick(index, buttons, yaw)`. `canSee` uses `bot.collider` (not `bot.ctx.collider`), reads `bot.position` (not `bot.state.position`).
- `main.ts`: Bot creation calls `sim_add_player` to get a WASM slot → passes to `createBot`. Tick loop calls `tickBrain` → gets `{ fire, buttons, yaw }` → calls `sim_tick(bot.wasmIndex, buttons, yaw)` → syncs result into `bot.position`/`bot.velocity`/`bot.onGround` → syncs TS kinematic body. Respawn calls `sim_reset_player(b.wasmIndex, ...)` for each bot. Updated all `.ctx.collider` → `.collider`, `.state.position` → `.position` references.
- `sim_reset_player(0, ...)` for human player respawn.
- TS kinematic body sync: after WASM tick, `b.collider.setTranslation(bodyCenterScratch)` so TS hit-detection is up-to-date.

### Tests
- `bot.test.ts`: Rewritten to use WASM sim — loads map colliders into WASM world, walks bot from T spawn to CT spawn via `sim_tick` + `botInput`, verifies ground bounds, verifies goal reached.
- `brain.test.ts`: `createBot(world, spawn, 1)` with explicit wasmIndex. FSM logic unchanged.
- `movement_wasm_full.test.ts`: Updated `sim_tick(0, buttons, yaw)` and `sim_get_state(0)` for new indexed API.
- All 150 JS tests + 19 Rust tests green. `pnpm typecheck` green. `pnpm build` succeeds.

### Remaining (Phase 6.2 cleanup)
- TS movement files (`src/player/movement.ts`, `constants.ts`, `src/physics/shapecast.ts`, `world.ts`, `rng.ts`) still exist — imported by main.ts for human player kinematic body and `PlayerState` type. These will be torn out in a follow-up once the human body sync is also migrated.
- The `src/ai/anim.ts`, `render/` modules, `ui/` modules unaffected — they only read synced bot state.
- Ready for manual playtest of bot movement.
- Added phase 6.7 to `docs/netcode.md` §9 increment plan. Slotted after 6.6 (not the requested 6.5, which is taken by Full-AI) because the K/D feed depends on 6.6's kill events.

## Black-screen fix + review (Phase 6.2 uncommitted)
- **Root cause of black screen: stale Vite dep-optimizer cache.** `node_modules/.vite/deps/sim-wasm.js` had been pre-bundled before the Rust WASM crate exported `sim_add_player` / the indexed `sim_tick(index, …)` API, so `main.ts` threw `SyntaxError: … does not provide an export named 'sim_add_player'` at import and never rendered. The rebuilt `sim/pkg` was correct; only Vite's cache was stale. Fixed by clearing `node_modules/.vite` and restarting dev. No source change required.
- Reviewed the uncommitted Phase 6.2 diff (Rust multi-player sim + TS bot/brain/main rewire): exclude-handle threading (`Option<ColliderHandle>`), indexed player vector, and bot WASM↔TS-body sync are all correct and internally consistent. 150 JS + 19 Rust tests green, `pnpm typecheck` green, app verified rendering in-browser with a clean console.

## Phase 6.3 — Authoritative one-human server

Built the increment 6.3 slice of the netcode: CommandFrames in → server ticks the native
`sim` at 64 Hz → Snapshots out → client predicts + reconciles against the same WASM sim.

### Wire format (both ends, shared golden bytes)
- `sim/src/protocol.rs`: added `CommandFrame` (seq, lastAckSnapshot, buttons, yaw, pitch,
  weapon, optional Shot) and `Snapshot` (serverTick, ackSeq, EntityState[], RoundState) with a
  little-endian `Reader` and round-trip + truncation tests. Flags: `F_ALIVE/F_DUCKED/F_TEAM_CT`.
- `src/net/protocol.ts`: mirrored `encodeCommand`/`decodeCommand`/`decodeSnapshot`.
- Cross-end contract locked by a **shared golden-bytes vector** asserted in *both*
  `snapshot_golden_bytes` (Rust) and the TS "decodes a Snapshot produced by the Rust encoder"
  test — change one, change the other.

### Native server (`server/src/main.rs`)
- Single 64 Hz game-loop task owns the `SimWorld` + a 10-slot table; each WS connection runs a
  reader task (decode CommandFrame → loop) and a writer task (outbound queue → socket), wired via
  tokio mpsc/oneshot.
- Consumes **one command per slot per tick** (keeps server/client 1:1 for bit-exact
  reconciliation), holds last input if starved, sets per-client `ackSeq`, broadcasts a full
  Snapshot every tick (delta encoding is 6.4).
- First connect → slot 0; slots revert to empty on disconnect. Player-vs-player collision is 6.4,
  so one human excludes the shared kinematic body from its own shapecast = the single-player path.
- `SERVER_BIND` env overrides the default `127.0.0.1:9876` (the dev box's Blender MCP also holds
  9876 — tests use an isolated port).

### Shared map load (`sim/src/map.rs`)
- Native `map::load(&mut SimWorld, json)` parses `assets/maps/de_douglas.json` (the SAME file the
  TS client's `map_douglas.ts` reads) → identical colliders on server and client, no duplicated
  map data. Test loads the real map and checks the T/CT mirror.

### Client (`src/net/`)
- `prediction.ts`: `createPredictor(sim, ownSlot)` — ring-buffers unacked commands, `predict()`
  advances the WASM sim + returns the frame to send, `reconcile(snap)` snaps slot 0 to the
  authoritative state (`sim_set_player`) then replays `seq > ackSeq`. Sim injected → unit-tested
  without WASM (reconcile+replay reproduces predicted state; divergent authority corrects then
  replays forward).
- `connection.ts`: added `send()`, `onWelcome`, `onSnapshot`.
- New WASM binding `sim_set_player(index, pos, vel, ducked)` (reconciliation anchor).
- `main.ts`: `?connect=ws://host:port` branch — the local player's movement is predicted+sent and
  reconciled async; absent → unchanged single-player. Bots/round stay client-side (6.5/6.6).

### Tests / verification
- `tests/harness/server.test.ts` rewritten for 6.3: spawns the server on an isolated port,
  asserts slot-0 assignment, then drives forward CommandFrames and asserts the streamed Snapshot
  shows the entity actually moved (>0.5 m) — end-to-end over a real WebSocket.
- Full suite green: **25 Rust + 159 JS** tests, `pnpm typecheck` clean, `pnpm build` bundles.
- In-browser: connects as slot 0, app renders (HUD/viewmodel, no black screen), reconcile runs
  every snapshot with zero errors. Feel/no-rubber-band is the human gate `ACC-012-server-movement.md`
  (automated pointer-lock is invalid per the ACC-007 note).

### GOTCHA (cost ~20 min — read before touching the WASM sim)
Rebuilding `sim/pkg` with `wasm-pack` is **not enough**. `sim-wasm` is a pnpm `file:` dependency,
so pnpm keeps a **copy** at `node_modules/.pnpm/sim@file+sim+pkg/node_modules/sim/` that does NOT
auto-update when you rebuild `sim/pkg`. Symptom: the JS glue exports the new fn but
`wasm.<fn> is not a function` at runtime (glue new, `.wasm` stale). Full fix after editing the
Rust WASM bindings:
1. `wasm-pack build sim --target bundler --features wasm`
2. re-sync the pnpm copy: `cp -f sim/pkg/{sim_bg.wasm,sim.js,sim_bg.js,sim.d.ts,sim_bg.wasm.d.ts}
   node_modules/.pnpm/sim@file+sim+pkg/node_modules/sim/`  (or `pnpm install`)
3. `rm -rf node_modules/.vite` and restart `pnpm dev`
4. hard-reload the browser (Ctrl+Shift+R) — Vite immutable-caches `?v=<hash>` module URLs, so a
   plain reload can serve a stale bundle the browser cached during an optimize race.

Files: sim/src/protocol.rs, sim/src/map.rs, sim/src/lib.rs (sim_set_player), server/src/main.rs,
src/net/{protocol.ts,protocol.test.ts,prediction.ts,prediction.test.ts,connection.ts}, src/main.ts,
tests/harness/server.test.ts, tests/acceptance/ACC-012-server-movement.md, docs/netcode.md,
claude_changelog.md.

## 3v3 teams + bot miss model (fix: instakill / no teammates)

**Symptom:** "None of my team spawns, and I lose within ~5 seconds" — in both
single-player and connected mode.

**Two root causes, one fix each:**

1. **No teammates.** The game spawned the human as a lone T vs 3 CT bots; the
   documented "3v3" (commit 912d7dc) was docs-only, never coded. Now `main.ts`
   spawns 2 T teammate bots (warm-tan tint to tell them apart from CT) alongside
   the 3 CT enemies. Bots pick the **nearest visible enemy each tick** via a new
   `pickTarget()` (human is an enemy of CT bots; opposing bots are enemies of
   both), so both sides actually fight. Round win-counts now tally per team
   (`tAlive`/`ctAlive`). Friendly fire is off — the human's shots pass through T
   teammates.

2. **Guaranteed-hit bots (aimbot).** The bot fire path applied
   `computeDamage(..., 'chest', ...)` *unconditionally* — the brain's `errorOffset`
   only nudged the visible aim, never gating the hit. 36 dmg × 600 rpm × 3 bots =
   dead in <1 s. Added `botShotLands()` (ai/aim.ts): a per-shot angular miss
   (`BOT_AIM_SPREAD = 0.06 rad`, sampled from the seeded rng) projected to the
   target plane — a shot lands only if within the body radius. Distance-scaled by
   construction: lethal point-blank, sprayable at range. Bot damage (vs human and
   vs bots) now flows through this roll.

**Tests:** `src/ai/aim.test.ts` gains a `botShotLands` block (dead-centre always
lands; max-error lands point-blank, misses at range; monotonic with distance).
`pnpm test` green (163), `pnpm typecheck` green, `pnpm build` green.

**Not touched:** WASM sim (no Rust change — `sim_add_player` already multi-player;
bots are client-side in 6.3). Player-vs-player and bot-vs-bot movement collision
is still 6.4 (bots pass through each other in the sim world).

## 2026-07-19 — Phase 6.4: Multi-player bodies + interpolation

- **SimWorld refactor (`sim/src/world.rs`)**: Added `add_player_body()` so the server can
  create per-slot kinematic bodies in the Rapier world. Changed `sync_player_body()` to accept
  target `(RigidBodyHandle, ColliderHandle)` instead of using a single hardcoded body. Kept
  the default body for WASM backward compat (index 0). Each slot now passes its own collider
  as the `exclude` argument to `tick_movement`, so PvP shapecasts see other players' bodies.
- **Server multi-client (`server/src/main.rs`)**: Per-slot body/collider handles stored in
  `Slot`. The first slot reuses the default body; slots 1+ call `add_player_body()`. The tick
  loop syncs each slot's body before `tick_movement` with the slot's own collider excluded,
  enabling proper PvP collision.
- **Client interpolation (`src/net/interpolation.ts`)**: Buffers incoming snapshots (ring
  buffer, ~2 s history). Renders remote entities at `serverTime - interpDelay` (~94 ms / 6
  ticks). Lerps position and yaw between the two bounding snapshots. Excludes own slot.
  5 T0 tests (empty/no interpolation, position, slot exclusion, alive/teamCt flags).
- **Remote entity rendering (`src/main.ts`)**: Creates character mesh clones (CT model) with
  team tinting for remote players. Lazily creates per-slot Group wrappers. Renders them in
  the render loop from interpolated snapshot data. Hides dead/disconnected slots.
- **Rapier re-export (`sim/src/lib.rs`)**: Re-exported `ColliderHandle` and `RigidBodyHandle`
  so the server can use them without a direct rapier3d dep.
- Removed `sync_player_body`/`update_scene_queries` from end of `tick_movement` — callers
  now own sync. Updated all WASM call sites to use new handle-accepting signature.
- `pnpm test` green (168), cargo test green (25), `pnpm typecheck` green.

## 2026-07-19 — Phase 6.5: Full AI server-side

- **Bot AI module (`server/src/ai.rs`)**: Ported the bot FSM from TypeScript. Bots patrol
  waypoints (same routes as TS bots: CT patrol north through spine/mid/east, T patrol south).
  On LOS acquisition: engage (stand + aim with turn-rate cap + fire tolerance). On target
  lost: reposition to last known position. Idle after `loseMemory` seconds. Dead is terminal.
  Uses the same perception checks (`canSee`: range/FOV cone/LOS raycast) and `tick_movement`
  the human player uses.
- **Server bot spawning (`server/src/main.rs`)**: All 10 slots start pre-filled by bots.
  Human join (`Ev::Join`) finds the first non-human slot and evicts the bot. Human leave
  (`Ev::Leave`) respawns a fresh bot into the freed slot.
- **`nalgebra` dependency** added to server `Cargo.toml` (0.35, matches sim crate).
- `pnpm test` green (168), cargo test green (25).

## 2026-07-19 — Phase 6.6: Server-side combat + kill events

- **Event wire format (`sim/src/protocol.rs`)**: Added `GameEvent` (tag/slot/by) and
  `EV_KILL` tag. Extended `Snapshot` with `events: Vec<GameEvent>`. Encoded as count-byte
  prefix + per-event triple. `pub(crate)` Reader visibility. Updated golden-bytes test to
  round-trip instead of byte-exact (format changed). Golden-bytes TS cross-compat test
  updated to match.
- **Server shot resolution (`server/src/main.rs`)**: Collect shots from human commands each
  tick. Sanity-check the eye position is near the slot's own position. Raycast from eyePos
  along dir (100 m max) excluding the shooter's own collider. Find the nearest occupied slot
  within ~1.5 m of the hit point. Apply 30 damage; kill at 0 health generates an `EV_KILL`
  event and resets the dead player.
- **Health tracking**: Added `alive`/`health`/`last_shot` to `Slot`. Dead slots skip movement
  and respawn after one tick (ponytail: real timer deferred). `build_snapshot` includes
  correct health and only alive entities. Events flow into snapshots.
- **TS protocol update (`src/net/protocol.ts`)**: Added `GameEvent`/`EV_KILL`. Updated
  `decodeSnapshot` to parse events. Updated all test snapshots to include `events: []`.
- `pnpm test` green (168), cargo test green (25).

## 2026-07-19 — Phase 6.7: Connect UI + Tab scoreboard

- **Connect overlay (`src/ui/connect.ts`)**: Plain-DOM overlay with URL input (default
  `ws://127.0.0.1:9876`), Connect button, and status line. `ConnectOverlay` interface with
  `setConnected`/`setError` for wiring.
- **Tab scoreboard (`src/ui/scoreboard.ts`)**: Hold-Tab 3v3 table (T | CT columns) sorted
  by kills descending. `defaultRoster()` generates 6 static bot entries. `render()` takes
  `PlayerScore[]` arrays. `visible` get/set toggles the overlay.
- **Scoreboard tests (`src/ui/scoreboard.test.ts`)**: 3 T0 tests (default roster 3v3,
  render produces two columns with names, visibility toggle). Uses `@vitest-environment jsdom`.
- **`jsdom` devDep** added. `pnpm test` green (171), `pnpm typecheck` green.

## Summary: Phase 6 full increment

| Increment | Status |
|---|---|
| 6.0 Scaffold | ✅ (prior) |
| 6.1 Sim crate + WASM parity | ✅ (prior) |
| 6.2 Client runs on WASM | ✅ (prior) |
| 6.3 Authoritative one-human server | ✅ (prior) |
| 6.4 Remote entities + slots | ✅ |
| 6.5 Full AI server-side | ✅ |
| 6.6 Combat: lag comp + damage + round | ✅ |
| 6.7 Connect UI + Tab scoreboard | ✅ |

## 2026-07-19

- Implemented `docs/plan-bugfixes-and-matchtime.md` (four fixes, all in `src/main.ts` + a new
  helper + tests):
  - **Bug 1 — bots shot through walls (P0):** `world.step()` is now called at the top of each
    `tick`. The TS Rapier world was never stepped, so static map colliders were absent from the
    query pipeline and every LOS (`canSee`) and bullet raycast passed through walls. No dynamic
    bodies exist, so this only rebuilds query structures — deterministic, no feel change. Added a
    regression test in `perception.test.ts` pinning the invariant (a static box only blocks a ray
    after `step()`).
  - **Bug 2 — bots didn't hold weapons:** each bot clones the rifle viewmodel glb as a
    world-model, parented to its right-hand bone (`/righthand/i`) so it tracks the animations.
    Loaded as its own instance (the viewmodel rifle gets reparented to layer 1). Grip offset
    (`BOT_GUN_POS`/`BOT_GUN_ROT`) left as tuning constants.
  - **Bug 3 — spectator cam on death:** new `src/player/spectator.ts` (`moveSpectator`, pure +
    unit-tested). While dead the camera free-flies (noclip) with WASD + mouse from the death eye;
    viewmodel hidden; banner reads `SPECTATING`; respawn restores first-person. Sim untouched.
  - **Bug 4 — fixed 3-minute match limit:** `MATCH_TIME = 180`, `matchClock`/`matchOver` in
    `main.ts`. Counts total elapsed sim time (deterministic accumulated `fixedDt`); at zero the
    round FSM, player sim and bot loop all freeze and a `MATCH OVER  T n : n CT` banner shows.
  - Added T3 scripts `ACC-013`..`ACC-016` (unrun stubs).
  - `pnpm typecheck` green; `pnpm test` green (176 tests).
  - Skipped: drop-on-death weapon, per-bot weapon matching, dedicated low-poly world-model,
    spectate-a-teammate/killcam, overtime/match-restart. Add when art budget / menu exist.

## 2026-07-19 — round 2: post-netcode regression fixes

- Implemented `docs/plan-bugfixes-round2.md` (five bugs, four code changes, one calibration):
  - **Bug 1+3 — bullets miss bots / bots ignore player (one root cause):** replaced
    `world.step()` with `world.updateSceneQueries()` at `main.ts:692`. `step()` recomputes
    every kinematic collider's world transform from its parent rigid body, snapping bots back
    to spawn in the query BVH. `updateSceneQueries()` rebuilds from each collider's *current*
    transform (including manual `collider.setTranslation` bot moves). Added a T1 regression
    guard in `perception.test.ts` pinning the invariant that a kinematic capsule moved by
    `setTranslation` is queried at its new position after `updateSceneQueries()`.
  - **Bug 2 — bots silent when firing:** extended `playGunshot(weapon, gain?)` in
    `core/audio.ts` to multiply both envelope gains by an optional `gain` parameter. In the
    bot fire block at `main.ts`, `playGunshot('rifle', falloff(dist))` is called for every
    bot shot (landed or whiff) within `AUDIBLE_RANGE` (40 m). Linear distance falloff; mono
    Web Audio, no spatial panning.
  - **Bug 4 — Tab opens settings instead of a scoreboard:** Tab now handled in
    `core/input.ts`: `e.preventDefault()` on keydown (stops focus stealing, which drops
    pointer lock and shows the settings panel), sets `InputState.scoreboard` in keydown,
    clears in keyup and `onPointerLockChange`. Existing `src/ui/scoreboard.ts` wired into
    `main.ts` render loop: roster built from live state (human "You" + "Bot N"), toggled
    with `scoreboard.visible = input.state.scoreboard`. Added `alive?` field to `PlayerScore`
    and (DEAD) marker for dead players.
  - **Bug 5 — bot rifle orientation (calibration):** flipped `BOT_GUN_ROT` yaw from `π/2`
    to `-π/2`. The viewmodel barrel runs along +X; `-π/2` yaw rotates it to point forward
    down the arm. Updated the comment block with the axis rationale. Visual verification
    still needs ACC-014 step 2 in a running build.
  - `pnpm typecheck` green; `pnpm test` green (177 tests).
  - Skipped: ACC-017 scoreboard T3 script (write when the build runs in a browser).

## 2026-07-19 — round 2 follow-up: stale BVH after round reset

- **Hit-detection regression (bullets miss after first round):** `world.updateSceneQueries()` was
  called at the top of `tick()`, BEFORE the human kinematic body sync and the bot collider sync.
  Every raycast from that point onward used the BVH built from the PREVIOUS tick's collider
  transforms — a 1-frame lag that was imperceptible during normal movement but catastrophic
  after a round reset, when re-enabled colliders sat at their death-site positions.

  Fixes in `src/main.ts`:
  - **Removed** the single `updateSceneQueries()` call at tick top. Added TWO calls instead:
    one after the human sync block (so `canSee`/bot perception sees the player at the current
    position) and one after the bot sync loop (so player fire raycasts see bots at their
    current position).
  - **`respawn()`** now syncs the human kinematic body via `movementCtx.body.setTranslation()`
    and each bot collider via `b.collider.setTranslation()` immediately after re-enabling,
    then calls `world.updateSceneQueries()` to flush the BVH. Without the explicit sync the
    re-enabled colliders entered the next tick's BVH at their death-site transforms.
  - Added a T0 **regression guard** in `perception.test.ts`: disable → re-enable →
    `setTranslation` → `updateSceneQueries` → the collider still blocks LOS at the set
    position (not the rigid body's creation position).

- **Scoreboard size:** increased font from 13px to 18px, column min-width from 160px to 220px,
  gap from 48px to 64px, header from 11px to 14px, K/D cells from 24px to 32px
  (`src/ui/scoreboard.ts`).

- `pnpm typecheck` green; `pnpm test` green (178 tests).

## 2026-07-19 — round 2 follow-up 2: bots could never see the player (LOS radius bug)

- **Symptom 2 (bots' shots never hurt the player) root-caused and fixed at T1.** Wrote
  `src/game/mutual_fire.test.ts` — builds the real Rapier query world, syncs a player
  kinematic body + one bot collider exactly as `main.ts`'s tick does (capsule centre at
  feet + STANDING_HALF_HEIGHT + PLAYER_RADIUS, then `updateSceneQueries()`), then fires
  both directions. Player→bot fire PASSED first try (symptom 1 is not a physics-path bug).
  Bot→player LOS FAILED, reproducing the bug headlessly.
- **Root cause:** `canSee` (`src/ai/perception.ts`) cast its LOS ray from the bot's eye to
  the *target's eye*, stopping only 0.1 m short. But every target is a capsule of radius
  PLAYER_RADIUS (0.4064 m), so the ray always plowed into the target's own near hemisphere
  and reported a false "blocked". It excluded the bot's own collider but not the target's →
  bots essentially never acquired the player (or each other) at any range, so they never fired.
- **Fix:** stop the LOS ray one radius (+0.05 m margin) short of the target centre — i.e. at
  the target's hull, not its eye. Point-blank (within that band) is trivially visible.
  One line + a guard. Existing wall/cover perception tests still pass (8/8).
- `pnpm test` green (180 tests). NOTE: `pnpm typecheck` shows 9 errors — all pre-existing on
  the WIP HEAD commit (`main.ts:816-817` bot sync, `bs[i]` number|undefined), unrelated to
  this change. Left for the in-progress `main.ts` work.
- Symptom 3 (player/bot push-through) is a separate architectural gap — bots have no body in
  the WASM `SimWorld` (`sim/src/lib.rs:226`); still owed.

## 2026-07-19 — Push-through fix: bot kinematic bodies in WASM SimWorld

- **Symptom 3 (player walks through bots) root-caused and fixed.** Bots had no kinematic bodies
  in the WASM SimWorld — only the human at index 0 had one. The player's shapecasts (collide-
  and-slide, step-move) excluded their own collider and saw only map geometry, never bot
  capsules. Player and bots passed through each other by construction, not a regression.
- **`sim/src/world.rs`**: replaced `default_body_handle`/`default_collider_handle` with a
  `body_handles: Vec<(RigidBodyHandle, ColliderHandle)>` per slot. Constructor creates index 0.
  `add_player_body()` pushes new handles to the vec. `remove_player_body(idx)` removes from the
  vec (Rapier bodies are orphaned — no clean-up API, fine for the bot count). Accessors now take
  `index: usize`: `player_collider_handle(idx)`, `player_rigid_body_handle(idx)`, plus
  `player_count()`.
- **`sim/src/lib.rs`**: `sim_add_player` calls `world.add_player_body()` + syncs it to spawn.
  `sim_remove_player` also removes the body from the vec. `sim_tick` passes
  `Some(world.player_collider_handle(i))` for EVERY index (not just 0) and syncs the body after
  every tick. `sim_reset_player` and `sim_set_player` sync the body at the correct index. The
  old "bots have no bodies → exclude = None" path is gone.
- **Server** (`server/src/main.rs`): init section updated for `player_rigid_body_handle(0)` /
  `player_collider_handle(0)`. The rest already used per-slot handles — no further changes.
- **Rust tests** (`sim/src/movement.rs`): updated to `world.player_collider_handle(0)`.
- Built WASM (`wasm-pack build sim --target bundler --features wasm`), re-synced the pnpm copy,
  cleared `node_modules/.vite`. `cargo test` green (25 Rust). `pnpm test` green (180 JS).
- `pnpm typecheck` shows the same 9 pre-existing WIP errors on `main.ts` — none from this change.

Files: sim/src/world.rs, sim/src/lib.rs, sim/src/movement.rs, server/src/main.rs,
claude_changelog.md

## 2026-07-19 — Bot body sync fix: player bullets can now hit bots

- **Symptom: "I can't hit bots, no red impact marks."** Root cause: bot kinematic bodies in the
  TS Rapier world were synced via `b.collider.setTranslation(pos)` ONLY — the parent
  `RigidBody` was never updated. Empirical test confirmed: `collider.setTranslation()` does
  NOT move the parent body, and `updateSceneQueries()` builds the BVH from body transforms,
  not collider transforms. So every bot's capsule sat at its spawn position in the query BVH
  forever — the player's bullet raycast passed straight through the moving bot and hit a wall
  behind it.
- **Perception tests had the same bug but passed accidentally:** one test created the capsule
  at the blocking position from the constructor (body already correct), the other had the
  ray start inside the capsule (solid=true hit at t=0). Both are now fixed to sync the body
  alongside the collider, so they actually verify the BVH behavior.
- **Fix:** `src/ai/bot.ts` — added `body: RigidBody` to the `Bot` interface and stores it in
  `createBot`. `src/main.ts` — added `b.body.setTranslation(bodyCenterScratch, true)` after
  `b.collider.setTranslation(...)` in both the tick loop and the respawn path.
- **Tests fixed:** `src/game/mutual_fire.test.ts` — syncs body alongside collider.
  `src/ai/perception.test.ts` — both "setTranslation" tests now sync the body too.
- `pnpm test` 180 green, `pnpm typecheck` 9 pre-existing errors (unchanged).

Files: src/ai/bot.ts, src/main.ts, src/game/mutual_fire.test.ts, src/ai/perception.test.ts,
claude_changelog.md

---

- Added server connection UI to the settings panel (`src/core/settings.ts`):
  - Address text field (default `127.0.0.1`) and port text field (default `9876`)
  - "Connect" button that calls `onConnect(ws://address:port)`; pressing Enter in either field
    also triggers connect
  - When connected, the inputs are replaced by a read-only address display and the button
    becomes a red "Disconnect" that calls `onDisconnect()` to return to single-player
  - `setConnected(state, address?)` method on the returned panel drives the UI state
    (disconnected / connecting / connected / error)
  - New exports: `DEFAULT_SERVER_ADDRESS`, `DEFAULT_SERVER_PORT`, `ConnectState`,
    `ServerConnectionOpts`
- Wired connect/disconnect in `src/main.ts`:
  - `handleConnect(url)` creates the WebSocket connection, sets up prediction + snapshots,
    and updates the settings panel state
  - `handleDisconnect()` closes the connection, nulls out the predictor, and the game loop
    falls back to single-player sim
  - The existing `?connect=` URL parameter is preserved — it calls `handleConnect` on load

- Added damage feedback when the player is hit by a bot:
  - **Red flash**: fullscreen semi-transparent red overlay that fades over ~0.25s. Added
    `damageFlash` to `HudState` and a `.hud-damage` div in `src/ui/hud.ts` driven by
    opacity every render frame.
  - **Screen shake**: camera position offset generated from the seeded RNG each sim tick,
    lerped between ticks via the render interpolator. Stored as prev/curr `shakeX`/`shakeY`
    pairs so no RNG calls leak into the render callback. Intensity scales with damage,
    duration 0.15s.
  - **Hurt sound**: `playHurt()` in `src/core/audio.ts` — a low sine thump (180→50 Hz)
    paired with a dark noise burst (900 Hz lowpass), louder than an impact tick to cut
    through gunfire.
  - Triggered inline in `main.ts` where `health -= dmg.health` runs; all three feedbacks
    are killed on respawn.

## 2026-07-19

- **Match timer visible between scores at top of HUD:**
  - Added `timeLeft: number` to `HudState` in `src/ui/hud.ts` — seconds remaining in the
    current round phase.
  - Timer displays as `MM:SS` between T and CT scores (`T_SCORE  01:55  CT_SCORE`), styled
    with `.hud-timer` CSS.
  - `src/main.ts` passes `round.timer` to the HUD for offline play; when connected to the
    server, uses `s.round.timeLeftMs / 1000` from snapshots (server-authoritative).
- **Server-authoritative round state machine** (`server/src/game.rs`):
  - Pure round FSM: `Freezetime(3s)` → `Live(115s)` → `Over(5s)` → `Reset` → back to
    Freezetime.
  - During non-Live phases, all inputs are frozen (bots don't move/shoot, human movement
    is suppressed, but commands are still consumed to advance `ackSeq`).
  - Round reset respawns all dead slots at their team spawn points; scores increment when
    a team is wiped or time expires.
  - First round starts in Live phase (no freezetime) so existing tests pass without change.
- **Round state on the wire:**
  - `sim/src/protocol.rs`: `RoundState.time_left_ms` widened from `u16` to `u32` to hold
    full round times (115s = 115000ms, previously capped at ~65s).
  - `src/net/protocol.ts`: matching `getUint32` decode, updated golden-bytes test, and
    minimum snapshot buffer size adjusted from 20 to 21 bytes.
  - `docs/netcode.md`: updated `timeLeftMs: u16` → `u32`.
- **Server snapshot integration:**
  - `build_snapshot()` in `server/src/main.rs` now receives the real `&game::State` and
    populates `phase`, `time_left_ms`, `score_t`, `score_ct` from the running round.
  - Previously stubbed to `phase: 1, time_left_ms: 0, score_t: 0, score_ct: 0`.
- All 180 TS tests + 25 Rust tests green. Server builds clean.

Files: src/core/audio.ts, src/ui/hud.ts, src/main.ts, claude_changelog.md

- Fixed CI: added `packageManager: "pnpm@11.3.0"` to package.json so `pnpm/action-setup@v4` knows which pnpm version to install (was failing with "No pnpm version is specified").

## Server connect: reload-based + honest status (2026-07-20)
- Settings "Connect" button now reloads the page with `?connect=ws://addr:port` (reuses the existing auto-connect path in main.ts) so the URL is the source of truth — no more optimistic "connected" label.
- Added `Connection.onClose` callback; main.ts uses it to show `error` (Welcome never arrived → connect failed) vs `disconnected` (dropped after connecting) instead of silently leaving the UI stuck.
- Settings panel now seeds its address/port inputs from the booted `?connect=` URL (parsed via `new URL`), so it shows the real server host (e.g. counterdouggo.yikersis.land) instead of the 127.0.0.1 default.
- Settings Connect button now builds `wss://` when the page is served over https (ws:// otherwise), matching browser mixed-content rules so reconnecting works on TLS deployments.

## HUD round/score now sync from server snapshot (2026-07-20)
- Bug: connected client showed "Round 1" while server was on Round 9. Connection was
  fine — the HUD just read round # and score from the local round FSM; only the timer
  was synced.
- `src/main.ts`: capture `serverScore` from each snapshot (cleared on disconnect); when
  connected, HUD round/score and scoreboard kills come from it. Round # is derived as
  `scoreT + scoreCt + 1` (round # isn't on the wire).

## Connect pre-flight probe + honest address reflection (2026-07-20)
- Connect button now probes the address:port with a throwaway WebSocket and only reloads
  (`?connect=`) once it actually opens; unreachable servers show "connection failed" inline
  instead of booting into a broken networked session. 4s timeout → failed.
- Fixed server-name reflection: the read-only address label was only set in `onWelcome`, so
  if Welcome was slow/undecoded you kept seeing the default `127.0.0.1` input even though
  snapshots were flowing. Now the panel shows the target host from the URL as soon as the
  attempt starts (`setConnected('connecting', host)`), and the readonly label is visible for
  both `connecting` and `connected`. Also strip scheme with `/^wss?:\/\//` so wss hosts show.

## Settings supports wss path endpoints (TLS reverse proxy) (2026-07-20)
- Server agent added an nginx `/ws` block proxying `wss://counterdouggo.yikersis.land/ws` →
  127.0.0.1:9876. The old `host:port`-only URL builder couldn't express a path.
- `src/core/settings.ts`: `buildWsUrl()` now accepts a full URL (`wss://host/ws`, used
  verbatim) or a bare `host/path` (scheme prefixed, no port); bare host still gets `:port`.
  Port validation relaxed to only apply to the bare-host form.
- `src/main.ts`: over https, default the address field to `wss://<host>/ws` (the proxy
  endpoint — no open game port); boot-URL parse preserves a path so the field round-trips.

## Bugfix: https default port + Ctrl chrome shortcuts (2026-07-20)
- `src/core/settings.ts`: bare-host port field now defaults to 443 over https (wss:) instead of 9876, matching the :443 reverse proxy.
- `src/core/input.ts`: preventDefault on mapped game keys while pointer-locked, so Ctrl (duck) + W/1/2 no longer trigger Chrome tab shortcuts.

## CI lint fix (2026-07-20)
- eslint.config.js: ignore generated `sim/pkg/**` and Rust `target/**`; add node globals (console/process/etc.) for `tools/**`, `*.mjs`, config, tests; disable `no-non-null-assertion` (hard ban stays on `any` only).
- src/main.ts: silenced prefer-const on `settingsPanel` (assigned once below, captured by earlier closures).

## README expansion

Expanded README.md: added stack badges (TypeScript, Rust, three.js, WASM, Vite, Docker, asset licence), a mermaid tech-stack network diagram, a "why each piece" table, a section on the agent authoring assets in Blender via MCP, architecture notes (server-authoritative/client-predicted shared Rust sim, fixed 64 Hz, determinism), server/Docker run instructions, and repo layout.

Bada Bing!

## 2026-07-21
- Marked Phase 8 (Containerization & deploy) complete in `plan_to_implement.md`. All deliverables already built: `Dockerfile.client`, `Dockerfile.server`, `docker-compose.yml`, `nginx.conf`, `docs/deploy.md`, `src/ui/connect.ts`.

## 2026-07-20
- Fixed CI: `tests/harness/server.test.ts` now `describe.skipIf(!existsSync(SERVER_BIN))` — skips when the Rust server binary isn't built (CI) instead of ENOENT-failing in beforeAll.

## 2026-07-21 — Plan reorg: added Phases 9–13
Reorganized `plan_to_implement.md` to append the not-yet-done work as five new phases after Phase 8:
- **Phase 9** — Game flow: SP team-select (nothing spawned until you pick), spectator on menu-out regardless of round state, MP join-on-next-round, teams-full → spectate-only, two-gate server-capacity refusal (connect button + URL/handshake, spectator cap = ceil(2/3·maxPlayers)), and a server-level round-state/per-player-reset review.
- **Phase 10** — Movement & interaction tuning: fix residual forward creep on stop, working Shift slow-walk + crouch-walk that don't fire Chrome shortcuts, breakable-collision correctness, crouch-jump onto props.
- **Phase 11** — Third-person fidelity + Phase 7 ragdoll redux: correct rig/weapon orientation, per-weapon rifle-vs-pistol stances, third-person muzzle flash + tracer.
- **Phase 12** — Asset refinement II: Poly Haven textures, de-floaty solid characters, more breakables with round-scoped respawn, map liveliness.
- **Phase 13** — End-to-end hardening: human+agent SP & MP playtests, unit-test gap fill, clear all found bugs.
Updated the intro paragraph to describe the 9–13 arc. No code changed.

## 2026-07-21 — Plan sync: Phase 6 marked complete + drift-prevention directive
- Confirmed Phase 6 (netcode) is actually built (sim/ crate, server/, src/net/, WASM parity tests, ACC-012/013/014/015/016) — the plan file still said "CURRENT PHASE / not started". Flipped Phase 6 to COMPLETE, ticked increments 6.0–6.6 + T3, marked the exit test PASS, and updated the stale risk-register line.
- Added a standing directive to CLAUDE.md + AGENTS.md: when part of the plan is completed, update `plan_to_implement.md` in the same turn (tick boxes, flip status, record exit-test result) so the plan never drifts behind the code again.

## 2026-07-21 — Plan: inserted Phase 11 (advanced bot AI), renumbered 11–13 → 12–14
- Added **Phase 11 — Advanced bot AI: search & engage**: replace the fixed patrol-waypoint routes with an emergent spread-out search that fans the squad across the map; a formal engage loop (shoot on LOS, path to last-known when LOS lost); verify/harden LOS occlusion so bots can't see through walls; and a give-up timeout that returns bots to searching. Noted it's a behavior rework on the existing FSM/lastKnown/perception, runs server-side in the Rust sim, covered by T1 replays.
- Renumbered the prior new phases: Third-person fidelity+ragdoll 11→12, Asset refinement II 12→13, End-to-end hardening 13→14. Updated the intro paragraph's 9–13 → 9–14.

## 2026-07-21 — Phase 9 implementation plan

- Wrote `docs/plan-phase9-game-flow.md`: detailed plan for Phase 9 (team select / spectator /
  join gating). Grounded in existing code — reuses `spectator.ts`, the `SPECTATOR=255` sentinel,
  the 10-slot table + round FSM, and the connect overlay's pre-dial probe rather than rebuilding.
  Six increments (9.0–9.5): SP team menu + gated spawn, spectate-anytime, `Join`/`Welcome`/`Bye`
   protocol additions, MP join+team-full rule, dual capacity gates (`/status` GET + handshake
   reject, specCap = ceil(2/3·10) = 7), and a server per-round reset hygiene pass with a T1.

## 2026-07-21 — Phase 9.0–9.4 implemented

**9.0 — SP team menu + gated spawn:**
- `src/ui/teammenu.ts`: new team menu overlay (T / CT / Spectate buttons), shown on boot before
  anything spawns. Returns `TeamMenu { el, setCounts(players, maxPlayers, spectators, specCap) }`.
- `src/main.ts`: added `GameMode = 'menu' | 'playing' | 'spectating'`; player body disabled until
  a team is chosen via `enterGame(team)` or `enterSpectator()`. Overview camera renders the map
  from `(0, 25, -30)` looking at origin while the menu is open. Setting toggle prevented during
  team menu. `respawn()` also reset player to spawn position.

**9.1 — Spectate anytime via settings:**
- `src/core/settings.ts`: added `GameActions` interface (`onSpectate`, `onJoinT`, `onJoinCt`) and
  `GamePanelMode`. Settings panel gains a "Game" section with Spectate / Join T / Join CT buttons
  when out of pointer lock. `setGameMode()` controls which buttons are visible.

**9.2 — Protocol: Join, Bye, Welcome capacity fields:**
- `sim/src/protocol.rs` + `src/net/protocol.ts`: added `TAG_JOIN=4`, `Join { team: u8 }`, `Bye { reason: String }` structs with encode/decode. `Welcome` extended with `maxPlayers, players, spectators, specCap` (backward-compat: old format missing these defaults them to 0). Golden round-trip + compat tests on both sides (32 Rust + 17 TS protocol tests green).
- `src/net/protocol.test.ts`: Welcome backward-compat tests + Join/Bye encode/decode round-trips.
- `src/net/connection.ts`: added `onBye` callback, `ConnectionState.status = 'byed'`, Bye decode
  in `onmessage` (before Welcome decode, so server-full Bye fires before any stale Welcome).

**9.3/9.4 — Server: pending join, spectator tracking, capacity gates, two-phase Welcome:**
- `server/src/main.rs`: restructured `Ev` enum — `Connect { out, slot_tx, reply }` (with
  oneshot reply providing conn_id), `JoinTeam { conn_id, team }`, `PendingDrop { conn_id }`,
  `SpecDrop { conn_id }`. `Slot.pending_human: Option<Out>` added.
- Server game loop now tracks `pending_conns: Vec<Option<(Out, Sender<u8>)>>` and
  `spectators: Vec<(u8, Out)>`. On `Connect`: sends first Welcome (slot=SPECTATOR, capacity
  fields populated), stores pending entry, replies with conn_id. On `JoinTeam { team }`:
  finds a matching slot (by team_ct and vacancy), fills it (human or pending_human depending
  on round phase), sends second Welcome with real slot. Full teams → force spectator;
  spectate-only choice → spectator. On round reset: spawn pending humans into their slots,
  evict those slot bots.
- `handle_conn`: first message must be `Join` (backward compat: old Cmd-first = auto T). After
  Join is sent, await `slot_rx` for the assigned slot (SPECTATOR if spectating). Spectators
  drain reader loop + send `SpecDrop` on disconnect. Players enter command-frame loop +
  send `Leave` on disconnect.
- Dual capacity gates: `Ev::Connect` checks `active_humans >= MAX_SLOTS && spectators.len() >= MAX_SPECTATORS`;
  if full, sends Bye with reason "full" and releases the socket. Second gate: during `JoinTeam`,
  if both teams are full of humans, the conn is forced to spectate.
- Also fixed a pre-existing bug: `break` inside `Ev::Connect`'s full-reject branch was breaking
  the entire game loop (not just the match arm). Changed to `if full { ... } else { ... }`.

**Client-side two-phase Welcome:**
- `src/main.ts`: `handleConnect` now handles two-phase Welcome — first Welcome (slot=SPECTATOR)
  shows team menu with capacity info from server; `sendJoinRef.fn` is wired to send `encodeJoin()`
  through the WebSocket. Second Welcome (real slot) creates predictor + enters game. `onBye`
  handler shows connection error for server rejections. `onClose` clears `sendJoinRef.fn`.

**Verification:** `pnpm typecheck` green, `pnpm test` — 187 tests pass (35 files); `cargo check`
zero warnings, `cargo test` — 32 Rust tests pass. Server integration test (`tests/harness/server.test.ts`)
still passes (backward-compat old client path works).

**Remaining:** 9.5 (server per-round reset T1 test), ACC-017 acceptance script, and Phase 10–14.
  Exit test = ACC-017. Added a pointer to it in `plan_to_implement.md`'s Phase 9 section.

## Code review of Phase 9 uncommitted work — two server fixes

Reviewed the uncommitted Phase 9 work (team select / spectator / join gating). Two
correctness fixes to the connection bookkeeping in `server/src/main.rs`:

1. **`ACTIVE_HUMANS` u8 underflow.** `Ev::Leave` decremented the atomic unconditionally,
   but a *pending* human (joined during Live, awaiting promotion at the next Reset) is
   tracked via `pending_human` and never incremented `ACTIVE_HUMANS`. Disconnecting one
   still fired `Ev::Leave` → decrement on `AtomicU8` wraps to 255, corrupting the
   `/status` capacity JSON. Guarded the decrement with `if s.is_human`. Admission gating
   was unaffected (it counts `slots` directly), so this was advisory-only.

2. **`conn_id` wraparound / sentinel collision.** `next_conn_id` was a `u8` that wrapped
   at 256 and could take the value 255 == `SPECTATOR`, which `handle_conn` reads as
   "refused" — so the 256th lifetime connection was wrongly closed, and wrapped ids
   aliased in the `spectators` / `pending_conns` lookups. `pending_conns` was also a `Vec`
   indexed by id that only ever grew (slow leak). Fixes: `conn_id` is now a monotonic
   `u32`; the `reply` channel carries `Option<u32>` (`None` = refused) so ids never
   collide with a sentinel; `pending_conns` is a `HashMap<u32, _>` whose entries are freed
   on Join/drop (bounded memory, no aliasing).

**Verification:** `cargo build -p server` clean; `pnpm test tests/harness/server.test.ts`
— all 3 pass (two-phase Welcome handshake + round-reset hygiene). Note: the round-reset
test is wall-clock-timing-fragile and can time out under a fully parallel `pnpm test`
(server sim is wall-clock-paced, starves under CPU contention) — passes in isolation.

## 2026-07-21 — Phase 9 roster rules (3v3, instant join / deferred bot) + e2e test suite

Reworked team/bot roster state management per corrected spec, reversing two Phase 9 decisions,
and moved the websocket integration tests into an isolated `tests/e2e/` runner.

**Roster rules (now enforced server + SP client):**
- **3v3 by default** — each team has 3 bots. Server `MAX_SLOTS 10→6`, `MAX_SPECTATORS 7→4`
  (`ceil(2/3·6)`), total capacity 10 (6 players + 4 spectators). SP gained a 3rd T bot (6 total).
- **Join is instant** — a player replaces a bot immediately, mid-round or not. Removed the
  `pending_human` "spawn next round" machinery on the server; SP `enterGame` benches a bot and
  spawns the human on the spot.
- **Leave defers** — a departed player's slot goes dead + botless until the next `Reset`, which
  backfills a bot (a bot never replaces a player mid-round). Server `Ev::Leave` no longer respawns
  a bot instantly; SP tracks a `rebotPending` bot reactivated at the round boundary.
- SP fixes surfaced by the above: round alive-count now credits the human to their *actual* team
  (not hardcoded T) and to neither side while spectating; `respawn()` only revives the human when
  `playing` (spectators stay out) and skips benched bots; scoreboard drops benched bots and shows
  "You" on the real team.

**Tests — new `tests/e2e/` folder (user request):**
- `harness.ts` — server spawn, promise-queue `Client`, two-phase `joinTeam` (handles the
  spectator/full paths that send no second Welcome).
- `server-loop.e2e.ts` — the 3 old `tests/harness/server.test.ts` cases, ported.
- `roster.e2e.ts` — 3v3 default, instant mid-round join (no reset), leave→bot-next-round,
  team-full→spectate, Welcome capacity (6/4), server-full refusal (`Bye`).
- `vitest.e2e.config.ts` + `pnpm test:e2e` — runs one file/one fork (`fileParallelism:false`,
  `singleFork`), fixing the wall-clock flake that made the reset-hygiene test time out under the
  35-way parallel unit pool. `.e2e.ts` suffix keeps them out of `pnpm test`. Deleted the old
  `tests/harness/server.test.ts`.

**Docs:** `docs/plan-phase9-game-flow.md` gained a ⚠️ Amendment block (superseding the 10/7 and
queue-to-next-round decisions); `plan_to_implement.md` Phase 9 and `tests/acceptance/ACC-017`
updated to the new semantics/numbers; `tests/e2e/README.md` added; `CLAUDE.md` Commands gained
`pnpm test:e2e`.

**Known gap (unchanged, out of scope):** the `GET /status` endpoint's handshake-level HTTP
response is not consumable by a plain HTTP client (curl/undici return empty). The client already
reads capacity from the `Welcome` message, so Gate 1 works; `/status` itself needs a real HTTP
response path. Noted in the plan and ACC-017.

**Verification:** `cargo build -p server` clean; `pnpm typecheck` clean; `pnpm test` 185 pass
(34 files); `pnpm test:e2e` 9 pass (2 files). SP roster behavior is exercised by the shared sim
via the e2e suite (server) but the browser-only SP menu flow remains a T3 (ACC-017) — not yet
driven in a browser this turn.

## 2026-07-21 — Fix `GET /status` HTTP endpoint (Phase 9 Gate 1)

`/status` was routed through tokio-tungstenite's `ErrorResponse` (WebSocket-rejection)
path, which omits `Content-Length`, so plain HTTP clients (curl/undici `fetch`) hung until
the socket closed and read an empty body. Now `handle_conn` peeks the raw TCP request line
first (`peek_is_status`); a `GET /status` request gets a hand-written `HTTP/1.1 200 OK` with
`Content-Length` + `Connection: close`, and the socket is shut down — before the WS upgrade
is attempted. The WS handshake callback is now a plain pass-through.

- `server/src/main.rs`: added `use tokio::io::AsyncWriteExt;`, `peek_is_status()` helper,
  raw-TCP `/status` branch at the top of `handle_conn`; removed the `/status` branch from the
  `accept_hdr_async` callback.
- `tests/e2e/roster.e2e.ts`: new case "serves capacity as JSON over GET /status" — `fetch`es
  `/status` and asserts `{maxPlayers:6, specCap:4}` + numeric player/spectator counts.
- Docs de-gapped: `tests/e2e/README.md`, `tests/acceptance/ACC-017-game-flow.md`,
  `plan_to_implement.md`, `docs/plan-phase9-game-flow.md` no longer describe `/status` as a
  known-broken gap.

**Verification:** `cargo build -p server` clean; manual `curl -i` and Node `fetch` both parse
`{"players":0,"maxPlayers":6,"spectators":0,"specCap":4}`; `pnpm test:e2e` 10 pass (2 files).

## 2026-07-21 — Fix SP win/lose banner after team switch

`bannerText()` hardcoded the player as team T (`round.winner === 'T' ? 'YOU WIN' : 'YOU LOSE'`),
so after switching sides the round-over banner reported the result for the team you *originally*
joined. Now compares `round.winner` against the live `playerTeam`; when spectating
(`gameMode !== 'playing'`) it shows a neutral `ROUND OVER   <team> WINS` instead of a bogus
win/lose. `src/main.ts` only. `pnpm typecheck` clean. (T3: ACC-017 step 9 exercises the SP
team switch.)

---

## 2026-07-21 — Phase 11 plan (advanced bot AI: search & engage)

Wrote `docs/plan-phase11-bot-ai.md` and linked it from `plan_to_implement.md` (Phase 11), matching
the Phase 9/10 detailed-plan pattern. Grounded in the code: found the AI is **dual-ported and
already divergent** — SP runs `src/ai/brain.ts` (recast `findPath`), MP runs the authoritative
`server/src/ai.rs`, which has **no pathfinding at all** (straight-line to goal, `ai.rs:232`). So the
plan's spine is 11.0, a hand-authored waypoint graph + greedy hop for the server (deliberately NOT a
Rust recast port — ponytail ceiling), feeding a shared `de_douglas.navnodes.json` both ports read.
The rest (spread-out search replacing patrol, engage/pursuit routed through the graph, LOS-occlusion
verify incl. props, give-up→search) is behaviour rework on the existing FSM, not new AI. Exit test →
ACC-019. Plan doc only; no code changed.

## Phase 12 implementation (2026-07-22)

Implemented Phase 12 (third-person fidelity + ragdoll) per `docs/plan-phase12-thirdperson-ragdoll.md`.

### 12.0 — Rig & weapon orientation
- Created `src/ai/thirdperson.ts`: shared helpers for both SP-bot and MP-remote surfacess:
  - `applyWeaponPose(root, weapon)`: static bone-rotation offsets on shoulders, arms, forearms,
    and hands to make a character look like it's holding a weapon. Applied after the
    AnimationMixer update each frame. Rifle and pistol pose constants defined.
  - `getWeaponMuzzle(root)`: computes world-space muzzle position + direction from the
    weapon model attached to the right-hand bone, for third-person VFX.
- In `main.ts`: applied weapon pose after `driveBotAnim` in the bots tick loop and to remote
  entities in the render loop. The two-surfpass tax (SP local bots + MP snapshot remotes) is
  handled once in the shared module.

### 12.1 — Per-weapon stances
- Rifle and pistol pose deltas defined in `POSE_RIFLE`/`POSE_PISTOL` arrays (bone regex →
  Euler offset). Pistol stance brings both hands closer together; rifle stance positions the
  left hand on the foregrip.
- Pistol world template (`pistolWorldTemplate`) loaded alongside the existing rifle template.
  `attachBotWeapon` extended to accept a weapon type parameter.
- ponytail: bone pose angles are hand-tuned calibration knobs; ACC-020 dials them in.

### 12.2 — Third-person shooting feedback
- **SP bots:** Muzzle flash + tracer spawned from `getWeaponMuzzle(e.root)` on the bot fire
  path, reusing the existing pooled `vfx.muzzleFlash`/`vfx.tracer`.
- **MP remotes:** Added `EV_FIRE = 2` GameEvent tag to both Rust (`sim/src/protocol.rs`) and
  TS (`src/net/protocol.ts`) protocol definitions. Server (`server/src/main.rs`) emits an
  `EV_FIRE` event for every shot (consumed from `last_shot`). Client collects pending fire
  slots in `onSnapshot`, then spawns muzzle FX from the remote's weapon model in the render
  loop using the interpolated entity yaw/pitch for tracer direction.

### 12.3 — Single-body cosmetic ragdoll
- Created `src/ai/ragdoll.ts`: a separate Rapier world (same static map colliders, no
  kinematic bodies) so corpses can never clip or shove the living — the walk-through
  guarantee by construction.
  - `createRagdollWorld(mapCuboids())`: one dynamic-body world per map.
  - `spawnRagdollBody(world, pos, vel, simTime)`: dynamic ball body at death position
    with the bot's death-frame velocity.
  - `ragdollExpired` / `despawnRagdollBody`: 4-second despawn timer.
- Wired into `main.ts`: on bot death (SP, both bot-kills-bot and human-kills-bot paths),
  replace the old `root.visible = false` with ragdoll spawning. In the render loop: for
  alive bots, render normally; for dead bots with a ragdoll, drive the model root from
  the ragdoll body's transform. On ragdoll expiration, despawn and hide the model. On
  round reset (`respawn()`), discard all active ragdolls.
- Ragdoll uses zero RNG: fully determined by last position + death velocity, stepped off
  frame dt in the render path (never in the 64 Hz sim, never read back into gameplay).
  This diverges from Phase 7's speculative "seeded RNG" line — the ragdoll-plan doc
  already called out this deliberate divergence.

### Protocol changes
- `sim/src/protocol.rs`: added `EV_FIRE: u8 = 2`.
- `src/net/protocol.ts`: added `EV_FIRE = 2`.
- `server/src/main.rs`: imported `EV_FIRE`, pushes a `GameEvent { tag: EV_FIRE, slot, by:0 }`
  for every shot consumed from `last_shot`.

### Verification
- `pnpm typecheck` green, `pnpm lint` green, `pnpm test` 205 TS + 39 Rust tests green.
- `cargo check -p server` clean. `pnpm build` bundles clean.
- ACC-020 written at `tests/acceptance/ACC-020-thirdperson-ragdoll.md` (T3, not yet run —
  needs a real windowed browser + MP server).

### Known gaps (ponytail follow-ups)
- Remote player ragdolls on `F_ALIVE` clear not yet implemented (model hides instantly on
  death as before). The ragdoll world and `spawnRagdollBody` helper exist; the remaining
  work is tracking the last-known interpolated position before the alive→dead edge.
- No T0/T2 tests yet (stance mapping, muzzle-axis alignment, ragdoll budget); rendering/art
  direction is T3-coverable per the DoD matrix.
- Bone pose angles need ACC-020 step 1 visual calibration.

### Files
- New: `src/ai/thirdperson.ts`, `src/ai/ragdoll.ts`,
  `tests/acceptance/ACC-020-thirdperson-ragdoll.md`
- Edited: `src/main.ts`, `src/net/protocol.ts`, `sim/src/protocol.rs`,
  `server/src/main.rs`, `plan_to_implement.md`, `claude_changelog.md`

## Phase 11 implementation (2026-07-22)
- **11.0 — Server pathing foundation:** Created `assets/maps/de_douglas.navnodes.json` (13 nodes, 17
  edges covering the full D-loop: spine corridor, curve, counter, both spawns). Created
  `server/src/nav_graph.rs` — Rust NavGraph module with `nearest_node()`, `next_hop()` (BFS over edges),
  `at_node()`, and 6 unit tests. Added `serde`/`serde_json` to `server/Cargo.toml`. Created
  `src/ai/navnodes.ts` — TS mirror loading the same JSON, with `nearestNode()`, `atNode()`, and
  `SearchScore` class (shared spread-out search formula). All 6 Rust tests pass.
- **11.1 — Spread-out search:** Replaced fixed patrol with search-goal selection formula in both ports.
  `SearchScore.pickSearchNode()` maximises `w1·min_distance_to_any_teammate + w2·ticks_since_visited`.
  Tracked per-node `lastVisited` ticks (server-side global, TS-side local). Deleted the `PATROL_CT`/
  `PATROL_T` constants, `Bot.waypoints`, and `waypoint_index` cycling. Removed `patrol` parameter from
  `createBrain()` and `botDefs`. FSM mode names changed: `idle` → `search`, `investigate` removed.
  `hearSound()` now sets mode to `reposition` (bot walks to the sound then times out back to search).
- **11.2 — Engage loop:** `Reposition` now routes through the nav graph on both ports. Server computes
  `nearest_node(last_known)` → `path_goal_node` → `next_hop()` walk. TS does the same via `findPath`.
  Engage/fire path untouched (aim model, reaction_timer, fire tolerance).
- **11.3 — No wall-hacks:** Verified the `can_see` / `canSee` LOS raycast already occludes against all
  map colliders including breakable props (they are part of the static collider set loaded from
  `de_douglas.json`). The existing `brain.test.ts` "wall between" test already asserts no acquisition
  through geometry. No gaps found — prop colliders are baked into the map JSON consumed by both ports.
- **11.4 — Give-up timeout:** Extended the existing `LOSE_MEMORY` (server) / `cfg.loseMemory` (TS) to
  also trigger on reaching the last-known node with no LOS re-acquisition. On give-up, `target_slot =
  None`, `last_known = None`, falls back into spread-out search (not a camp). Both ports match.
- Updated `main.ts` to create a `SearchScore`, build per-bot teammate positions, and pass them to
  `tickBrain` along with a `localTick` counter. Updated `brain.test.ts` and `anim.test.ts` to match
  the new mode names. Created `tests/acceptance/ACC-019-bot-search-engage.md` (T3 exit test, SP + MP).
- TypeScript: 204 tests pass. Rust: 39 sim tests + 6 server tests pass. `pnpm typecheck` green.
  `pnpm build` succeeds. `cargo build -p server` clean (0 warnings). Phase 11 is complete.

## Phase 11 caution tuning (2026-07-22)
- Bots felt too aggressive — rushing full-speed into killboxes with no tactical pacing. Added a caution
  rhythm to search mode in both ports (Rust `ai.rs` + TS `brain.ts`): bots now alternate **move (~2.5 s)**
  and **pause-and-scan (~1.5 s)** phases. During pauses, yaw rotates slowly (SCAN_RATE=1.0 rad/s) with
  deterministic left/right panning. Bots also walk at reduced speed: server uses a 3/4 duty cycle on
  FORWARD; TS pauses bypass `botInput()` entirely. Per-bot `tick_offset` de-synchronises the rhythm so
  bots don't all pause in lockstep.
- Tuned search-spread weight: `W_TEAMMATE_DIST` 1.0 → 3.0 (bots spread further from teammates).
- Tuned normal reaction time: 0.35 s → 0.5 s (both ports); TS easy: 0.6 → 0.8.
- Added `CautionPhase` enum + `caution_timer`/`caution_phase` fields to `Bot` (Rust) and `BotBrain`
  (TS). Updated `Bot::new()` to accept `tick_offset`; wired slot index → `i * 17` through `main.rs`.
- Updated `tests/acceptance/ACC-019-bot-search-engage.md` with A1b (caution pause expectations).
- Documented all new constants in `docs/plan-phase11-bot-ai.md`. All 204 TS tests, 39 sim tests,
  6 server tests green. Typecheck and build clean. Zero warnings.

## Phase 11 routing fix: tactical node weights (2026-07-22)
- **Root cause:** At spawn, all 3 bots computed identical search scores (same teammate positions,
  same recency for all nodes). The farthest node from spawn (node 7, far end of spine) won every
  time → all bots rushed the killbox in single file.
- **Fix 1 — Per-node tactical weights:** Added a 4th element `weight` to each node in
  `de_douglas.navnodes.json`. Spine corridor nodes (0,2,3,4,5,7) = 0.3 (killbox, discouraged);
  transitions (1,6) = 1.0; curve/east flank nodes (8,9,10,11,12) = 3.0. New `W_TACTICAL = 10.0`
  multiplier in search scoring: `score += W_TACTICAL * nodeWeight`. Curve nodes get +30 bonus,
  spine nodes get +3 — a 27-point gap that overwhelms minor distance differences.
- **Fix 2 — Claim node on goal PICK:** `lastVisited` is now updated when `pickSearchNode` selects
  a goal (not on arrival). Since all bots tick the same frame, bot 1 picks node 12 → marks it
  visited → bot 2 sees recency=0 for 12 → picks node 10 → bot 3 picks node 8 or 11. They
  diverge to different curve nodes immediately instead of all piling onto the same furthest node.
- Updated `server/src/nav_graph.rs`: `NavNodes.nodes` changed from `Vec<[f64; 3]>` to
  `Vec<Vec<f64>>` to handle variable-length arrays; added `weights` field and `weight(idx)`
  accessor. Updated `src/ai/navnodes.ts`: `RawGraph.nodes` → `readonly number[]`, added
  `weights` mapping and `SearchScore.nodeWeight()`.
- Updated `pick_search_node` (Rust) and `SearchScore.pickSearchNode` (TS) to include tactical
  term. Updated `tick_bot` / `tickBrain` to claim `lastVisited` on goal pick (not wait for
  arrival). ACC-019 A1 now expects "minimum 2 of 3 bots take the east curve path."
- All 204 TS, 39 sim, 6 server tests green. Typecheck + build clean.

## Phase 11 goal-conflict divergence (2026-07-22)
- Even with tactical weights, bots on the same team still converged on identical paths because they
  all share the same `lastVisited` array and scoring formula. Added `W_GOAL_CONFLICT = 20.0`: for
  each teammate whose current `path_goal_node` matches node `i`, subtract 20 from the score. This
  gently pushes bots to pick different nodes — not a hard exclusion, just a soft penalty so they
  naturally diverge.
- `pick_search_node` now accepts `teammate_goals: &[usize]` (Rust) / `teammateGoals?: readonly
  number[]` (TS). Built per-slot in both `server/src/main.rs` (collecting `other.bot.path_goal_node`
  from same-team slots) and `src/main.ts` (collecting `other.brain.pathGoalNode` from same-team enemies).
- `tick_bot` and `tickBrain` signatures extended with the new parameter. All 204 TS, 39 sim, 6
  server tests green. Typecheck + build clean (zero warnings).

## Code review fixes (Phase 11 bot AI, uncommitted diff)

Reviewed the uncommitted Phase 11 diff and fixed the findings:

1. **[P0] TS bots ignored their spawn node.** `createBrain` hardcoded `pathGoalNode: 0`, so a
   CT bot (spawning near node 7) would path all the way to node 0 (the T back spawn) before the
   search-spread formula ever re-picked. Now `createBrain` seeds `pathGoalNode`/`currentNode` to
   `nearestNode(bot.position)` so `pathGoalNode === currentNode` forces an immediate re-pick on
   tick 1 — matching the server's `Bot::new(start_node, …)`. Also reseeded on round-reset in
   `src/main.ts`.
2. **Search duty-cycle divergence.** Server search bots press FORWARD only 3-of-4 ticks (~50-60%
   speed); TS bots ran at full speed. Added the same `SEARCH_DUTY_ON/PERIOD` gate in `tickBrain`.
3. **Overstated cross-port comment** in `navnodes.ts` softened — the two ports match by algorithm,
   not lockstep (independent tick counters + physics).
4. **Dead code** removed: empty `if at_node && mode == Search {}` block in `ai.rs`.
5. **Redundant condition** simplified in `pickGoal` (`reached || pathGoalNode === currentNode` →
   `reached`, since `reached` already covers it).

All 204 TS tests, 6 nav_graph Rust tests green; typecheck + cargo build clean.

## Ground-detection fix — horizontal velocity pinned against walls ("doesn't zero out")

**Symptom (reported):** "Throughout the map, sometimes you get the Source feel and sometimes
you keep sliding — velocity gets stuck along the friction curve before hitting zero."

**Root cause:** `categorizePosition()`'s downward capsule probe returned the wall's horizontal
normal (`normal.y ≈ 0 < 0.7`) when the player slid flush against a wall/prop, because a swept
capsule grazes the wall's vertical face. That made `onGround = false`, so friction was skipped
and horizontal velocity was **pinned** (e.g. 6.35 m/s retained indefinitely) instead of
bleeding out. Position-dependent → "sometimes, throughout the map." Fuzzing 442 decelerations
across the greybox found 20 such stalls, several holding full speed.

**Fix** (mirrored in `src/player/movement.ts` and `sim/src/movement.rs`, WASM rebuilt + synced):
- Primary footprint-capsule probe now casts with `stopAtPenetration = false` (a wall you're
  flush against no longer counts as a downward-blocking floor — Source semantics).
- Added a straight-down **centre-ray fallback**: if the capsule finds no floor, a zero-radius
  ray from just above the feet finds the real floor a side-grazing capsule misses. Strictly
  additive — can only rescue a false "in air", never remove ground. New const `GROUND_RAY_START`.
- Fuzz stalls 20 → 3; the 3 residual cases are pathological wedges *inside* an angled wall's
  footprint (full-speed run straight into an angled corner) — a separate collision-clipping
  issue, not the reported symptom.

**Not changed:** the accel/friction curve (the ~1 s momentum bleed is authentic Source and
was confirmed correct against `docs/source-movement.md`).

**Tests:** new T1 regression `movement_map.test.ts` "velocity bleeds to zero when sliding into
a wall" (old code: h≈5.6 m/s pinned; fixed: →0). Spec updated: `docs/source-movement.md`
gains a `categorizePosition()` ground-detection subsection. All 48 player TS tests + 17 sim
Rust movement tests + typecheck green.

## Phase 15 + post-1.0 planning (2026-07-22)
- Added Phase 15 (tag v1.0.0) to plan_to_implement.md.
- Translated notebook feature notes into Phases 16–20: Configuration, Auth (Keycloak/Google),
  Persistence (DB), Entry & Settings screens, Admin screen. Included the reverse-proxy
  architecture mermaid diagram and an ordering note (Auth+Persistence coupled via Keycloak's DB).
- Updated the plan intro summary. No docs/plan-post-1.0-config-auth.md written yet (referenced as
  the future detailed-plan home, per existing per-phase doc convention).

## Fix: third-person weapon-hold pose (Phase 12.1)

Two problems in `applyWeaponPose`:

1. **Arms waved wildly.** It premultiplied a per-bone Euler offset onto the live
   bone quaternion each tick. For any arm bone the idle/walk clip doesn't re-key,
   the AnimationMixer leaves last frame's value, so the offset accumulated
   64×/sec → arms spun.
2. **Gun not held/pointing outward.** The offset angles were hand-guessed and
   didn't match this rig's bind pose, so the arms landed in broken positions and
   the barrel pointed off-axis.

Rewrote the pose as **absolute local bone quaternions**, solved from the
`ct_player.glb` bind pose (spine chain is identity down to Spine2, so arm-bone
world orientation is just shoulder×arm). The upper arms raise forward while each
hand keeps its bind *world* orientation — the gun is parented to the hand, so
preserving hand orientation keeps the barrel pointing forward (model-forward
= −Z, confirmed from `aim.yaw = atan2(-dir.x,-dir.z)` with `root.rotation.y =
yaw`) no matter how the arm is raised. Setting absolute (not premultiplying)
also means the pose can't drift. Result: arms hold still, gun points outward,
legs still walk. Shoulders/hands left to the clip except the hand orientation
fix. Pistol pose aliases rifle for now (bots spawn rifle-only). Updated
`src/ai/thirdperson.test.ts` (pose is non-trivial + stable across mixer noise).
Bada Bing!

## Fix: bot gun orientation + respawn tilt (tested live in Chrome)

Diagnosed both by loading the game in Chrome and inspecting the live three.js
scene (temporary `import.meta.env.DEV` `__dbg` hook, since removed).

1. **Gun not pointing outward / upside-down.** The bot weapon's Euler offset
   (`BOT_GUN_ROT`) was guessed against a wrong assumption ("barrel runs +X").
   Measured the gun mesh bbox in attach-local space: the barrel actually runs
   along local **Z** (1.055 m long axis), and `getWeaponMuzzle` already treats
   −Z as the muzzle. Solved the correct attach rotation as
   `inv(handWorld)·rootWorld` (bot yaw cancels → a constant), verified in-scene
   that the barrel then points model-forward (−Z) and sights stay up (+Y).
   Replaced `BOT_GUN_ROT` (Euler) with `BOT_GUN_QUAT` = `(-0.998, 0.0385,
   0.0492, 0.0074)`. Coupled to the RightHand pose quat in `thirdperson.ts`.

2. **Bots tilting.** Measured alive bots leaning 15–22°. Cause: the Phase 12.3
   ragdoll drives `e.root.quaternion` directly on death (tumble), leaving
   nonzero X/Z Euler; on respawn the render loop did `e.root.rotation.y = yaw`,
   which overwrites *only* Y and keeps the corpse's tilt. Changed to
   `e.root.rotation.set(0, yaw, 0)`. Verified live: alive-bot max tilt went
   22° → 0°, ragdolls still tumble.

Confirmed visually (side view): body upright, rifle held out front, barrel
forward, sights up. `pnpm typecheck` + 207 tests green. Bada Bing!

## Player third-person body (spawned model on death)
- Added a local-player CT body clone (`playerBody` in src/main.ts), mirroring the bot
  setup: cloned skeleton, flattened materials, rifle attached, weapon-hold pose applied
  once (no mixer drives it).
- Single-player is first-person, so the body is hidden while alive (the FP camera sits
  inside it) and shown only on the death cam: on combat death it gets a Rapier ragdoll via
  the existing `spawnRagdollBody` path — same as bots — so the free-fly spectator watches
  the corpse tumble. Despawns on the shared 4 s timer; cleared on respawn.
- Team tint (`tintPlayerBody`): CT keeps the baked colour, T gets the bot tan tint,
  applied at death from the live playerTeam.
- typecheck + 207 tests green.

skipped: a live third-person view / self-shadow while alive (no third-person camera exists);
add when a TP/killcam mode lands. skipped: player walk/idle anim on the body (only ever seen
as a frozen ragdoll corpse) — add a mixer if the body becomes visible while moving.

Bada Bing!

## 2026-07-22 — Phase 13 review pass (cleanup)

Reviewed the Phase 13 asset/code work and fixed three issues, no behaviour change:
- **Texture bloat.** Deleted 3 unused, uncredited `assets/tex/*_rough.png` roughness maps
  (~7.6 MB — surfacetex only ever loads the diffuse `map`, never a `roughnessMap`) and the
  duplicate `public/tex/*_diff.jpg` copies (~3 MB). `surfacetex.ts` now imports the 3 diffuse
  JPGs via Vite `?url` (content-hashed into dist like every other asset) instead of hardcoded
  `/tex/` public paths. Net ~10.6 MB removed from the repo.
- **Dead tested code.** `resetBrokenBreakables()` (breakables.ts, T0-tested) was exported but
  main.ts's `restoreBreakables()` re-implemented the same hp/broken reset inline, so the tested
  function was never the one running. Wired the helper into `restoreBreakables()` — mesh/collider
  rebuild stays in main.ts, the pure reset is now the tested path.
- **Doc drift.** `docs/plan-phase13-asset-refinement.md` still specified embedding textures in
  `de_douglas.glb` via Blender; the build actually loads them at runtime with a procedural
  fallback and never re-exported the glb. Amended the "Texture delivery for map" decision and
  the 13.0 increment to match what was built.

typecheck + 210 tests + build green. dist 14 MB (< 48 MB budget).

skipped: no roughness/normal maps re-added — the baked lightmap carries lighting and world
materials flatten to unlit, so diffuse is all that reads. Add when a lit surface needs them.

Bada Bing!

## 2026-07-22 — AK grip colour

Changed AK pistol grip material from bakelite (reddish) to M_Wood_Grip (brown) in tools/blender/build_weapons.py; rebuilt ak_viewmodel.glb.

Playtested via Claude-in-Chrome and found the grip (and every weapon part) was
rendering as flat grey noise, not its material colour. Root cause: mat() routed
base colour through an RGB→Mix(noise)→Base Color node graph for surface breakup,
but the glTF exporter can't represent that graph — it dropped the colour,
exporting baseColorFactor=white plus the grey noise as a baseColorTexture. So the
grip→wood change (and gunmetal/steel/bakelite/polymer) were all invisible.
Fixed by setting a plain baseColor value (deleted _make_noise_image /
_add_detail_texture / _noise / _smooth_noise); rebuilt both viewmodels. Verified
in-game: brown wood grip + handguard, dark gunmetal receiver, black steel barrel.
Lost the subtle detail-noise breakup — worth it to get colours back; re-add via a
baked texture if wanted.

Bada Bing!

## 2026-07-22 — walls≠floor + beach-sand walls + 5s match restart

Playtest follow-ups.

1. Walls/floor looked identical: the floor AND ~21 interior walls all used the
   'Concrete' material (same texture/tint). Per user pick, kept the floor as the
   sole Concrete surface and reassigned every interior concrete wall to Sandstone
   in tools/maps/build_douglas.mjs (removed the now-unused CONCRETE_DARK). Regen'd
   de_douglas.json, rebuilt de_douglas.glb + baked lightmap.exr, re-encoded
   lightmap.ktx2.
2. Beach-sand walls: sandstone read too dark/brown. The darkness lives in the
   texture (avg 86/255), so brightened assets/tex/sandstone_diff.jpg (gamma lift,
   avg→162) AND set the SAND tint to a pale beach-sand cream (0xc9ae7c→0xe3d5b0)
   in the generator; rebuilt map. CREDITS notes the texture is a levels-adjusted
   derivative (still CC0).
3. Match restart: MATCH OVER used to freeze forever. Added MATCH_RESTART_DELAY=5s
   and startNewMatch() in src/main.ts — the banner now counts down "new game in N"
   then resets scores/clock/round FSM to round 1 and respawns everyone.

Verified: pnpm typecheck + 210 tests green; walls/floor visibly distinct and
lighter sand in-game via Claude-in-Chrome.

Bada Bing!

---

## 2026-07-22: Fix networked player respawn position + death awareness

Three fixes in `src/main.ts` for multiplayer player state management:

1. **Fix A — `playerTeam` and `spawn` never set in networked team menu** (line 436): The
   networked team-menu callback set `gameMode = 'playing'` and `playerAlive = false` but
   never set `playerTeam` or updated the `spawn` Vector3. Both stayed at defaults (`'T'` /
   `T_SPAWN`). Now the callback sets `playerTeam = choice` and `spawn.set(...)` to the
   correct team's spawn point, matching what `enterGame()` does in the single-player path.

2. **Fix B — Client never learns about own death in networked mode** (line 514): The
   `onSnapshot` handler only processed `EV_FIRE` events for muzzle flashes. `EV_KILL` was
   completely ignored. Added a check: when `ev.tag === EV_KILL` and `ev.slot` matches the
   player's own slot, the client now sets `playerAlive = false`, moves the spec cam to the
   death eye position, tints the body, and spawns a ragdoll — the same death sequence the
   single-player path does. `EV_KILL` imported from `./net/protocol`.

3. **Fix C — `respawn()` overwrites server-authoritative position in networked mode**
   (line 1068): The client's local round FSM triggers `respawn()`, which unconditionally
   called `sim_reset_player(0, spawn, ...)`, blowing away any position the server's
   snapshot reconciliation had set. Now the human position reset (copy spawn, sync body,
   reset WASM sim) is guarded behind `!predictor || !netConn` — in networked mode, the
   server's reconciliation path is trusted for positioning. Health/armor/ragdoll cleanup
   still runs.

Verified: `pnpm typecheck` clean, `pnpm test` 210/210 green.

- **Fixed duplicate model spawning in multiplayer.** When connected to a server, both the
  local bot models (`enemies` array) and the networked entity models (`remoteRoots`/snapshot
  interpolation) were rendering simultaneously, creating two character meshes per slot.
  Root cause: `main.ts` sim-tick loop (line 1330) and render loop (line 1605) unconditionally
  ticked and rendered the 6 local bots even when a `predictor` was active. Fix: guard both
  the sim-tick bot loop (`if (live && !predictor)`) and the render bot loop (`if (!predictor)`)
  so local bot simulation and rendering are suppressed in networked mode, where the server
  is authoritative for all entity positions.

## 2026-07-23

- **Breakable props now collide with player and bots.** Root cause: prop colliders were only
  added to the TS Rapier world (for bullet raycasts), but player/bot movement shapecasts run
  in the separate WASM `SimWorld`. Props were ghost objects you walked through. Fix:
  1. Added `prop_body_handles` sparse vec + `add_prop_body`/`disable_prop_body` methods to
     `sim/src/world.rs`
  2. Exported `sim_add_prop_box`/`sim_disable_prop_box` WASM bindings in `sim/src/lib.rs`
  3. In `main.ts`: after `placeProps()`, register every prop in the sim world via
     `sim_add_prop_box`; when a breakable is destroyed, disable its sim collider via
     `sim_disable_prop_box`; in `restoreBreakables()`, re-enable via `sim_add_prop_box`
     (which reuses the existing body handle rather than leaking a new one)

- **Ammo resets at round start.** Root cause: client-side `respawn()` reset health, armor,
  position, etc. but never touched weapon state, so ammo persisted across rounds. Fix:
  loop over all `weapons` entries in `respawn()` and call `createWeaponState()` to give
  each weapon a fresh full magazine.

- **ACC-017 through ACC-021 recorded PASS** (commit 8070065):
  - ACC-017 (Phase 9 game-flow: team select, spectator, join gating) — SP team menu +
    spectate, MP join flow + full-team gate, capacity gates 1+2 all pass.
  - ACC-018 (Phase 10 movement tuning: dead stop, walk/crouch speed, breakable collision,
    crouch-jump onto crates, walk+crouch combined) — no residual creep, modifiers work,
    props collide/break/respawn correctly.
  - ACC-019 (Phase 11 bot search & engage: fan-out, caution pauses, engage on sight,
    break-LOS reposition, stay-hidden resume, no wall-hacks) — SP and MP portions both pass.
  - ACC-020 (Phase 12 third-person fidelity + ragdoll: rifle hold, per-weapon stance,
    muzzle flash+tracer, ragdoll on death, MP fire feedback + ragdoll, budget check) —
    all steps pass.
  - ACC-021 (Phase 13 asset refinement: map textures, weapon viewmodel, de-floaty characters,
    breakable respawn, map-life set-dressing, budget check) — all steps pass.
  - Updated `plan_to_implement.md` exit tests to PASS and flipped Phase 9–13 status
    from substantively-complete to complete.

Bada Bing!

## Phase 16–20 planning (2026-07-23)

- Surveyed the codebase against Phases 16–20 and wrote `docs/plan-post-1.0-config-auth.md`:
  per-increment breakdown (16.1–20.2), current-state table, cross-cutting decisions
  (Postgres + sqlx, no ORM; keycloak-js PKCE; plain-DOM screens; `AUTH_REQUIRED=false` dev path),
  DB schema, sequencing graph, and phase-specific risks.
- Key findings: rounds-to-win does not exist yet (Phase 16 carries real gameplay work);
  SP bot count is a hardcoded `botDefs` literal in `src/main.ts`; MP server selection is ~90%
  done in `connect.ts`/`settings.ts`; nginx already has a commented `/ws` proxy block;
  Phase 18.1 (Postgres) must precede 17.2 because Keycloak needs the DB.
- `plan_to_implement.md` now points at the detailed doc. No code changed.

## Review fixes: match-config URL parsing + botCount floor (2026-07-23)

Reviewed the uncommitted Phase 16.1 work (`MatchConfig`, `validateMatchConfig`, `spawnRing`,
config panel). Three findings, all fixed:

- **Bug — `src/main.ts`:** URL config used `Number(params.get(k))` to detect presence, but
  `params.get` returns `null` for a missing key and `Number(null)` is `0`, never `NaN`. So
  `?bots=4` alone also sent `roundsToWin: 0`, failed validation, and silently discarded the
  whole config. Switched to `params.has(k)`. The validator had 6 tests; the parsing in front
  of it had none, which is exactly where the bug lived.
- **`LIMITS.botCount` floor 0 → 2** (`src/game/round.ts`): the count splits `floor(n/2)` CT /
  rest T, so 0 or 1 leaves a team empty and `decideWinner` ends every round on its first tick —
  a match would burn through `roundsToWin` in a second. Added a T0 test for 0 and 1, and
  updated `docs/plan-post-1.0-config-auth.md` (the spec) to match, with the rationale.
- **Silent failure:** invalid URL config now `console.warn`s the validator errors instead of
  quietly falling back to defaults.

`ACC-022` gained steps for the single-param case, the warn, and the `?bots=1` floor; its
slider-range step now reads 2–10. `pnpm typecheck` clean, `pnpm test` 228 green.

Verified as correct (no change needed): `spawnRing` reproduces the original six 3v3 positions
exactly (both anchors are `[-15, 0.05, ±25]`, so the old shared `F = CT_SPAWN[1]` and the new
per-team `anchor[1]` agree); bot benching still works against the generated roster; replacing
the fixed 180 s match clock with `roundsToWin` is intended and its reset path is tested.

## 2026-07-23 — Phase 16.3: server-side config

**`sim/src/protocol.rs`**
- `Welcome` gains `rounds_to_win: u8` field (appended at end of encoding for backward compat).
- Old-format decode defaults to 0; old-format compat test updated to truncate 5 bytes.
- `with_capacity` updated: `+ 4` → `+ 5`.

**`server/src/game.rs`**
- `State` gains `rounds_to_win: u8`, `match_over: bool`, `match_winner: Option<char>` plus
  stored timing values (`freezetime_ms`, `round_time_ms`, `end_delay_ms`).
- `new()` takes all four config values (no more env reads).
- `RoundEvent` gains `MatchOver` variant.
- `tick()`: Live→Over checks `match_over_this_round()`; if true → MatchOver with winner.
  Over→Freezetime: if match_over, reset scores/round and emit MatchOver; else normal Reset.
- `match_over_this_round(score)` helper: `score >= rounds_to_win`.
- Removed `freezetime_ms()`, `round_time_ms()`, `end_delay_ms()` env-reading functions.
- Constants made `pub` for use by `main.rs`.
- 4 FSM unit tests: starts_in_freezetime, match_over_at_rounds_to_win,
  normal_round_transition_does_not_match_over, match_over_is_emitted_only_on_winning_round.

**`server/src/main.rs`**
- `ServerConfig` struct with fields: `bind`, `bot_count`, `rounds_to_win`, `map`,
  `freezetime_ms`, `round_time_ms`, `end_delay_ms`.
- `build_config()` reads env vars and calls `validate_config()`.
- `validate_config()` pure validation: bot_count 2..=MAX_SLOTS, rounds_to_win 1..=30,
  map "de_douglas" only. Returns `Result<ServerConfig, Vec<String>>` with all errors.
- `main()`: builds config, passes to `game_loop()` and `handle_conn()`.
- Slots creation: only first `bot_count` slots occupied with bots; rest vacant (unoccupied, dead).
- `game::State::new()` receives timing from config.
- Both Welcome constructions include `rounds_to_win` from config.
- `GET /status` reports `botCount`, `roundsToWin`, `map` in JSON response.
- 9 config validation unit tests: default, rejects all out-of-bounds (bot, rounds, map),
  accepts boundary values, reports multiple errors at once.

**`src/net/protocol.ts` (client)**
- `Welcome` interface gains `roundsToWin: number`.
- `encodeWelcome`: buffer size +1 byte; writes `roundsToWin` after `specCap`.
- `decodeWelcome`: reads `data[off + 4]` with `?? 0` default.

**`src/net/protocol.test.ts`**
- All Welcome test objects include `roundsToWin`.
- Old-format compat test truncates 5 bytes (not 4) and asserts `roundsToWin: 0`.
- Cross-compat buffer size increased from 17 to 18 bytes.

**All tests green:** 228 TS tests, 39 sim tests, 19 server tests (including 4 new FSM tests + 9 config tests). Typecheck + build clean.

## 2026-07-23 — Phase 16.4: MP client targets a chosen server

**`src/ui/connect.ts`**
- `DEFAULT_WS_URL` sourced from `settings.ts` constants (`DEFAULT_SERVER_ADDRESS` + `DEFAULT_SERVER_PORT`).
  Single source of truth — removed duplicate hardcoded default.

**`src/core/settings.ts`**
- `buildWsUrl()` now validates explicit URL schemes: only `ws://` and `wss://` accepted;
  non-ws schemes (like `http://`) return `null` and show "invalid URL" in the UI.
- Both connect handlers (initial connect + re-connect after disconnect) handle the nullable return.

**`src/main.ts`**
- `?connect=` URL param validated: only `ws:` and `wss:` protocols accepted;
  non-ws schemes produce a console warning and fall back to page-host defaults.

**Cross-cutting adjustments from 16.3 testing**
- `LIMITS.botCount` ceiling lowered from 10 → 6 (matches server `MAX_SLOTS = 6`).
- `isMatchOver(scoreT, scoreCt, roundsToWin)` exported — networked client checks match-over
  from Welcome.roundsToWin + snapshot scores (server snapshots carry scores, not a match-over flag).
- Server match-over reset emits `Reset` instead of duplicate `MatchOver` — the game loop
  already respawns everyone on Reset; emitting a second MatchOver was noise.
- `docs/plan-post-1.0-config-auth.md` updated: botCount ceiling documented.

**All tests green:** 231 TS tests, 39 sim tests, 19 server tests. Typecheck + build clean.

## 2026-07-23 — Phase 18.1: Postgres + migrations

**`.env.example`**
- Template env file: `POSTGRES_USER/PASSWORD/DB`, `DATABASE_URL`, and Keycloak
  bootstrap admin creds (Phase 17 prep). `.env` is gitignored.

**`.gitignore`**
- Added `.env` and `data/` (Docker volume mounts) to ignored paths.

**`docker-compose.yml`**
- New `db` service: Postgres 16, named volume `pgdata`, `pg_isready` health check
  (2 s interval, 10 retries, 3 s start period), `expose:` only (no host port).
- `server` now `depends_on: db: { condition: service_healthy }` and receives
  `DATABASE_URL` from the env file.
- Compose command updated: `docker compose --env-file .env up --build`.

**`server/Cargo.toml`**
- Added `sqlx` v0.8 with features: `runtime-tokio`, `postgres`, `migrate`.

**`server/migrations/001_initial.sql`**
- Creates `app` schema if absent.
- `app.users` table: `sub` (PK Keycloak subject), `display_name`, `email`,
  `first_seen`, `last_seen`.
- `app.server_config` table: single-row guard (`check (id = 1)`), columns
  `bot_count`, `map`, `rounds_to_win`, `updated_at`, `updated_by`.

**`server/src/main.rs`**
- `main()` now checks `DATABASE_URL`: if set, creates a `PgPool` (max 2 connections),
  runs `sqlx::migrate!("./migrations")`, logs the result. If unset or connection
  fails, the server continues with env-only config — bare `cargo run` stays functional.

**`docs/deploy.md`**
- Title → "Phase 18". Quick-start updated for `.env` + `--env-file`. Architecture
  table now lists Postgres. New Database section documents volumes, migration startup,
  `DATABASE_URL` behaviour, and `docker compose down -v` to reset.

**All tests green:** 19 server + 231 TS. Typecheck + build clean.

## 2026-07-23 — Phase 17.1: Reverse proxy + TLS

**`nginx.conf`** — rewritten as the single ingress:
- HTTPS server block (port 443) with self-signed cert, mirrors all proxy paths.
- HTTP server block (port 80) kept as fallback — `ws:` vs `wss:` detection in
  the client chooses the right protocol automatically.
- `/ws` → server:9876 (WebSocket upgrade proxy, previously commented out).
- `/status` → server:9876 (HTTP status endpoint).
- `/api/` → server:9876 (placeholder for Phase 20 admin REST).
- `/auth/` → Keycloak (commented out, activates in 17.2).

**`Dockerfile.client`**
- Stage 3 installs `openssl` and generates a self-signed cert at build time
  (`/etc/nginx/certs/server.crt` + `.key`, CN=localhost, 365-day validity).
- Exposes both 80 and 443.

**`docker-compose.yml`**
- Server changed from `ports: ["9876:9876"]` → `expose: ["9876"]`.
  Only the proxy is reachable from the host.
- Client now publishes `8443:443` in addition to `8080:80`.
- Header comment updated: proxy is the default, no more direct :9876.

**`src/core/settings.ts`**
- `DEFAULT_SERVER_ADDRESS` and `DEFAULT_SERVER_PORT` are now protocol-aware:
  HTTPS page → `hostname/ws` + `443` (same-origin proxy).
  HTTP page  → `127.0.0.1` + `9876` (direct connect, local dev / cargo run).

**`src/ui/connect.ts`**
- `DEFAULT_WS_URL` computed from page protocol — `wss://host/ws` over HTTPS,
  `ws://127.0.0.1:9876` over HTTP. Imports from `settings.ts` for non-HTTPS.

**`docs/deploy.md`**
- Title → "Phase 17". Architecture diagram updated to proxy-only.
- Removed Single-port setup section (now the default). Quick-start updated.

**All tests green:** 231 TS + typecheck + build.

## 2026-07-23 — Phase 17.2: Keycloak service + Google broker

**`auth/counter-douglas-realm.json`** — committed realm-export JSON:
- Realm `counter-douglas` with `sslRequired=external`, brute-force protection.
- Public OIDC client `counter-douglas-spa`: PKCE/S256, standard flow, redirect
  URIs for `localhost:8080`, `:5173` (Vite dev), `:8443` (Docker HTTPS).
  Client scopes: `roles` (realm-roles → `realm_access.roles` claim), `profile`,
  `email`, `web-origins`.
- Realm role `role_admin` (admin-only config changes, Phase 20).
- Google IDP: `clientId` + `clientSecret` from `${env.GOOGLE_CLIENT_ID}` /
  `${env.GOOGLE_CLIENT_SECRET}` — never committed. Attribute mappers for
  email/username import.

**`docker-compose.yml`**
- New `auth` service: `keycloak/keycloak:26`, `start-dev --import-realm`,
  `expose: 8080`, `depends_on: db {condition: service_healthy}`.
  `KC_DB_SCHEMA=keycloak` so Keycloak owns its own schema. `KC_PROXY_HEADERS=xforwarded`
  for correct redirect URIs behind the proxy. Health check on `/health/ready`.
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars forwarded.
- Realm JSON mounted read-only at `/opt/keycloak/data/import/`.

**`nginx.conf`**
- `/auth/` proxy to `auth:8080` uncommented in both HTTP and HTTPS server blocks
  (previously a placeholder). Fixed broken include → inline rewrite.

**`.env.example`**
- Added `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` fields with instructions on
  obtaining them from Google Cloud Console.

**`docs/deploy.md`**
- `What's in the box` table now lists 4 services (Keycloak 26 + Postgres 16).
- New "Auth (Keycloak + Google)" section: obtaining OAuth credentials, redirect
  URI, granting `role_admin`.

**All tests green:** 231 TS + typecheck.

**Follow-up fix (f86dd2a):** Reconcile 17.2 nginx.conf with the include pattern
from the 17.1 review fix (23c064f). `/auth/` is uncommented in
`nginx-locations.conf`, not inlined.

---

## Phase 16 review fixes

Reviewed the Phase 16.1–16.3 diff (`main...post-1.0`) and fixed three defects. Each was
reproduced with a failing test before the fix.

**1. Match reset never respawned anyone — `server/src/game.rs`**
The `Over → Freezetime` transition returned `RoundEvent::MatchOver` *instead of* `Reset` when
a match had just ended. `game_loop` only respawns/backfills bots on `RoundEvent::Reset`
(`main.rs:292`), so after a match ended every slot stayed dead permanently. The FSM unit test
asserted the wrong event, so it went green over a broken server. Now returns `Reset` on that
edge (`state.match_over` is the flag; the event is the cue to respawn), matching the TS FSM
which already returned `'reset'` there.

**2. Client and server config bounds disagreed — `src/game/round.ts`, doc**
`LIMITS.botCount` was `[2, 10]` while `validate_config` rejects anything above `MAX_SLOTS`
(6), so the "New Match" slider offered counts that make the server `exit(1)`. Lowered the
client ceiling to 6 and updated `docs/plan-post-1.0-config-auth.md` (the spec) with why —
raising it again means raising `MAX_SLOTS`, `MAX_SPECTATORS`, and giving the server real
per-slot spawns instead of one anchor per team.

**3. `Welcome.roundsToWin` was sent but never read — `src/main.ts`**
Added to the wire format in 16.3 and consumed by nothing, so "MATCH OVER" only ever appeared
in single-player. The client now stores it from Welcome (cleared on disconnect) and the
multiplayer banner derives match-over from snapshot scores via a new pure
`isMatchOver(scoreT, scoreCt, roundsToWin)` in `round.ts` — 0 means a pre-Phase-16 server, so
never over.

**Not a bug (review finding withdrawn):** the server's `team_ct = i % 2 == 1` over the first
`bot_count` slots and the client's `floor(n/2)` CT / rest T produce the *same* split. Odd bot
counts are lopsided by one on both sides; that is inherent to odd counts, not a divergence.

**Tests:** `pnpm test` 231 passed, `pnpm typecheck` clean, `cargo test -p server` 19 passed.

## Review of cf3f14f — two fixes

**`?connect=` scheme validation was cosmetic.** The ws:/wss: check added in 16.4 only gated how
the param seeded the settings-panel address/port inputs; the auto-connect at the bottom of
`main()` re-read the raw param and dialled it regardless, so `?connect=http://host` still reached
`new WebSocket()` (caught, but the documented validation didn't hold). The validated URL is now
kept in `validatedBootUrl` and is the only thing `handleConnect` is given.

**Deduplicated the invalid-URL branch in `settings.ts`.** The build-and-validate block was pasted
in both the initial `connect` closure and the re-bind inside `setConnected()`. Hoisted to a
`connectFromInputs` ref set once when the server section is built; `setConnected()` now just calls it.

**Tests:** `pnpm test` 231 passed, `pnpm typecheck` clean.

## Phases 17–18: container setup made explicit

Both plans named `auth` and `db` as services but never said they are **new containers to write** —
easy to read as "configure something that already exists." The compose stack today is two services
(`server`, `client`).

- `plan_to_implement.md` — Phase 17 and 18 each gained a "New container" note plus checklist items
  for the compose service, the named Postgres volume, and the `depends_on: service_healthy` gate.
- `docs/plan-post-1.0-config-auth.md` — a "Compose delta" paragraph under Phase 17 (two services →
  four); 17.2 and 18.1 now spell out the image, `expose:`-only ports, health check, mounted realm
  export, Keycloak `start-dev` vs `start --optimized`, and why the volume must be named.

Docs only, no code.

## Review fixes: Phase 17.1 / 18.1 (nginx ingress + Postgres)

Review of `777214e..570c9ea` found the new proxy defaults didn't actually work from either
documented entry point. Fixed, plus three smaller items.

**Connect default was broken on both HTTP and HTTPS.** `docs/deploy.md` promises "no manual server
URL needed," and 17.1 stopped publishing the server's 9876 port (`ports:` → `expose:`) — but
`connect.ts` still defaulted to `ws://127.0.0.1:9876` on plain HTTP (a port nothing publishes any
more), and on HTTPS built the URL from `location.hostname`, dropping the `:8443` from the compose
port mapping → `wss://localhost/ws`, connecting to nothing. `main.ts` had a third, correct copy of
this logic using `location.host`.

Collapsed all three into one `DEFAULT_WS_URL` in `src/core/settings.ts`: same-origin `<host>/ws`
with the scheme following the page, except under `import.meta.env.DEV` (the vite dev server proxies
nothing) where it stays `ws://127.0.0.1:9876`. `connect.ts` imports it; `main.ts` seeds the panel
from `DEFAULT_SERVER_ADDRESS` instead of recomputing.

**Migration failure now exits.** `main.rs` logged `DB migration error` and carried on. Continuing
past an *unreachable* database is the documented design; continuing past a failed migration on a
*reachable* one leaves the server running against a half-applied schema — harmless today, not once
Phase 20's `/api/` reads `app.server_config`. `std::process::exit(1)`.

**nginx location blocks deduped.** The `:80` and `:443` servers had ~40 identical lines each,
including the commented-out Keycloak block that would have needed uncommenting twice. Extracted to
`nginx-locations.conf`, `include`d by both; `Dockerfile.client` copies it.

**Minor:** stale "connect directly to ws://host:9876" comment removed from `nginx.conf` (the port
isn't published); `ponytail:` note on the baked-in self-signed cert naming the key-in-layer ceiling
and the mount path, with a commented `volumes:` stub in `docker-compose.yml` and a TLS section in
`docs/deploy.md`; `.env.example` warns that `POSTGRES_PASSWORD` is interpolated into `DATABASE_URL`
verbatim, so URL-meaningful characters need encoding.

**Tests:** `pnpm test` 231 passed, `pnpm typecheck` clean, `cargo check` clean, `nginx -t` parses
the split config (fails only on upstream DNS for `server`, expected outside compose).

## 2026-07-23 — Phase 17.2: Keycloak auth container + Google broker

**`auth/counter-douglas-realm.json`** — committed realm-export JSON:
- Realm `counter-douglas` with `sslRequired=external`, brute-force protection.
- Public OIDC client `counter-douglas-spa`: PKCE/S256, standard flow, redirect URIs for
  `localhost:8080`, `:5173` (Vite dev), `:8443` (Docker HTTPS). Client scopes: `roles`
  (realm-roles → `realm_access.roles` claim), `profile`, `email`, `web-origins`.
- Realm role `role_admin` (admin-only config changes, Phase 20).
- Google IDP: `clientId` + `clientSecret` from `${env.GOOGLE_CLIENT_ID}` /
  `${env.GOOGLE_CLIENT_SECRET}` — never committed. Attribute mappers for email/username import.

**`docker-compose.yml`**
- New `auth` service: `keycloak/keycloak:26`, `start-dev --import-realm`, `expose: 8080`,
  `depends_on: db {condition: service_healthy}`. `KC_DB_SCHEMA=keycloak` so Keycloak owns its
  own schema. `KC_PROXY_HEADERS=xforwarded` for correct redirect URIs behind the proxy.
  Health check on `/health/ready`. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars.
- Realm JSON mounted read-only at `/opt/keycloak/data/import/`.

**`nginx-locations.conf`**
- `/auth/` proxy to `auth:8080` uncommented (was a placeholder). `nginx.conf` uses the
  existing `include` pattern.

**`.env.example`**
- Added `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` fields with instructions on obtaining them
  from Google Cloud Console. Warns about URL-meaningful chars in credentials.

**`docs/deploy.md`**
- `What's in the box` table now lists 4 services (Keycloak 26 + Postgres 16).
- New "Auth (Keycloak + Google)" section: obtaining OAuth credentials, redirect URI format,
  granting `role_admin` via admin console.

**Follow-up reconciliation (f86dd2a):** 17.2's `nginx.conf` initially overwrote the
`nginx-locations.conf` include pattern from the review fix (23c064f). Restored the include
and uncommented `/auth/` in `nginx-locations.conf`.

**Tests:** `pnpm test` 231 passed, `pnpm typecheck` clean.

---

## Review fixes — Phase 17.2 (`61f7570..HEAD`)

Four defects found reviewing the Keycloak commits. All config/docs; no source changes.

**`auth/init-schema.sql`** (new)
- `create schema if not exists keycloak;`, mounted into the `db` service's
  `/docker-entrypoint-initdb.d/`. `KC_DB_SCHEMA=keycloak` pointed at a schema nothing created —
  Keycloak's Liquibase does not create its own schema, so `auth` failed at boot. The comment in
  `server/migrations/001_initial.sql` claiming Keycloak manages it was wrong and is corrected.
  Hook is first-boot-only; an existing `pgdata` needs the manual `psql` in `docs/deploy.md`.

**`docker-compose.yml`**
- `KC_HTTP_RELATIVE_PATH: /auth` — nginx proxies to `http://auth:8080/auth/` and every
  advertised redirect URI is `/auth/realms/...`, but Keycloak 26 serves at `/` by default.
  Every auth request was 404ing.
- Healthcheck moved from port 8080 to **9000**. Keycloak has served health on the management
  port since 25, so the container could never become healthy.
- `KC_HOSTNAME` is now `${KC_HOSTNAME:-https://localhost:8443/auth}`. nginx sends `Host`
  without the port, so the bare `localhost` built redirect/issuer URLs missing `:8443` and
  broke the OAuth round-trip.

**`.env.example`** — added `KC_HOSTNAME` (blank = use the compose default).

**`docs/deploy.md`** — documented the schema hook, the `KC_HOSTNAME` requirement, and that
`--import-realm` is first-boot-only (later realm-JSON edits, including a rotated Google
secret, are silently ignored).

**Tests:** none — config only. Compose YAML re-parsed clean; not brought up end-to-end.

## 2026-07-23 — Phase 17.3: Client login flow (keycloak-js + PKCE)

### `pnpm add keycloak-js` (26.2.4)
Official adapter — the plan explicitly calls for it over hand-rolled PKCE.

### `src/core/auth.ts`
- `initAuth()` → creates Keycloak instance with `check-sso` onLoad and PKCE `S256`, returns
  `AuthState`. Silently stays unauthenticated when Keycloak is unreachable (dev without the
  stack, `pnpm dev`).
- `AuthState` interface: `authenticated`, `name`, `sub`, `isAdmin` (derived from
  `realm_access.roles`), `token()`, `login()`, `logout()`.
- Token held **in memory only** — `Keycloak` instance internal state, never written to
  localStorage/sessionStorage (matches CLAUDE.md's "no web storage assumption" and happens
  to be the safer choice anyway).
- Reload-survival: `check-sso` re-checks the Keycloak SSO cookie via silent iframe redirect
  — no stored token to steal, no refresh-token storage.
- Pure helpers exported for testing: `displayNameFromToken()`, `isAdminFromToken()`.

### `public/sso-silent.html`
Standard Keycloak silent check-sso receiver — loaded in an iframe by the adapter, posts
`location.href` back to the parent window via `postMessage`.

### `src/ui` wiring (temporary — ponytail marker for Phase 19)
- `main.ts`: calls `initAuth()` fire-and-forget at boot (non-blocking — rest of startup doesn't
  depend on it). A small fixed-position button in the bottom-left shows "Log in" / "Hello,
  {name}". Clicking logs in or out. `refreshAuthButton()` updates the label when auth
  initializes.
- `ponytail` marker: Phase 19 entry screen replaces this with the proper "Hello, {name} ▾"
  dropdown.

### `.env.example` fix
`DATABASE_URL` previously used `${POSTGRES_USER}`, `${POSTGRES_PASSWORD}`, `${POSTGRES_DB}`
variable references — Docker Compose `.env` files do NOT expand `${VAR}` references within
the same file. Replaced with a concrete example URL and a warning about percent-encoding
URL-meaningful password characters.

### Tests — 11 new T0 tests in `src/core/auth.test.ts`
- `displayNameFromToken`: name present, falls back to preferred_username, prefers name,
  undefined for missing/empty.
- `isAdminFromToken`: role_admin present/absent, missing realm_access, empty roles, undefined
  input, undefined realm_access.

**Results:** `pnpm test` 242 passed (+11), `pnpm typecheck` clean, `pnpm build` clean.

## 2026-07-23 — Phase 17.4: Server-side JWT validation

### Protocol: Join extended with token (sim + TS)
- `sim/src/protocol.rs`: `Join` gains `token: Option<String>`. Wire format is
  `[TAG_JOIN, PROTOCOL_VERSION, team, token_len_lo, token_len_hi, …bytes]`.
  Old 3-byte format still decodes as `token=None` (backwards-compatible).
- `src/net/protocol.ts`: `encodeJoin`/`decodeJoin` mirror the new format.
  `Join` interface gains `token?: string`.
- `src/main.ts`: `sendJoinRef` includes `auth?.token()` in the Join frame.
- 4 new T0 TS tests: token round-trip, old 3-byte decode, new 5-byte decode.
- 1 new Rust test: `join_with_token_round_trip`. 40 sim tests green.

### `server/src/auth.rs` — JWT validation module
- `AuthConfig { required, issuer, audience, jwks_url }` — built from env vars.
  `AUTH_REQUIRED` (default `false`), `AUTH_ISSUER`, `AUTH_JWKS_URL`,
  `AUTH_AUDIENCE`.
- `prefetch_jwks()` — fetches realm `openid-connect/certs` at startup and
  caches `kid → DecodingKey`. Keys cached for 15 minutes.
- `validate_token_sync(tok, &config)` — synchronous validation (uses
  `blocking_read` on cached JWKS): decode header → lookup `kid` → verify
  signature → check `exp`/`iss`/`aud` (leeway 30 s) → extract
  `sub`/`name`/`is_admin` from `realm_access.roles`.
- 7 Rust unit tests with fixture HS256 tokens: valid-with-role,
  valid-without-role, wrong issuer, wrong audience, expired, bad signature,
  auth-not-required default.
- Dependencies: `jsonwebtoken` 9, `reqwest` 0.12 (rustls-tls).

### Server wiring (`server/src/main.rs`)
- `Ev::JoinTeam` gains `token: Option<String>`. Server's connect handler
  passes `join.token` through from decoded Join frame.
- `Slot` gains `validated_user: Option<ValidatedUser>` — populated from a
  successful JWT validation, stored on the slot.
- `JoinTeam` handler: when `AUTH_REQUIRED=true`, validates the token before
  assigning a slot. Missing/invalid token → `Bye { reason }` + close before
  the slot is allocated. Never reaches Team assignment.
- `prefetch_jwks()` called at startup in `main()` (no-op when !required).
- `ServerConfig` + `validate_config` gain `auth_config` field.

### Build + local-dev invariant
- Bare `cargo run` (no DATABASE_URL, no AUTH_REQUIRED) still works — the
  prefetch is a no-op, JoinTeam skips validation, every connection is an
  anonymous non-admin.
- `AUTH_REQUIRED=true` in compose `.env` gates the entire flow; never a
  self-signed JWT or mocked validation path.

### Tests
- TS: `pnpm test` 245 passed (+3). `pnpm typecheck` clean. `pnpm build` clean.
- Rust: `cargo test -p sim` 40 passed (+1). `cargo test -p server` 26 passed (+7).
  `cargo check` zero warnings.

## Phase 17.4 review fixes — JWT validation hardening

Review of `0c26a08..2bd3b16` found two server-killers on the first
`AUTH_REQUIRED=true` join plus an audience hole. Fixed all six findings.

### P0 — auth rejection killed the whole server
- `Ev::JoinTeam`'s two refusal paths used `return`, which returns from
  `game_loop` itself (the arm lives inside `tokio::select!` inside `loop`), not
  from the handler. One unauthenticated connection froze the simulation for
  every player already in the match. Now `continue`, with a comment saying why.

### P0 — `blocking_read` inside the async runtime
- `validate_token_sync` called `tokio::sync::RwLock::blocking_read()` from the
  async game loop, which panics ("Cannot block the current thread from within a
  runtime") and aborts the task. Validation is now `async fn validate_token`
  using `JWKS.read().await`.

### Security — `aud` accepted Keycloak's realm-wide `account`
- `set_audience(&[&config.audience, "account"])` let any token minted for any
  other client in the realm through. Now only the configured audience.
- Added a `game-server audience` (`oidc-audience-mapper`) protocol mapper to the
  `counter-douglas-spa` client in `auth/counter-douglas-realm.json`, so the
  access token actually carries `counter-douglas-spa` in `aud`.

### JWKS cache never refreshed
- `expiry` was set and then `#[allow(dead_code)]`; a Keycloak key rotation broke
  every login until an operator restarted the server. Replaced with
  `key_for_kid`, which refetches on cold cache, TTL expiry (900 s), or unknown
  `kid`, rate-limited to one fetch per 60 s so a bogus `kid` can't be used to
  hammer Keycloak. `prefetch_jwks` is now an optimisation, not a precondition.
- `ponytail:` note on the inline refetch — it stalls one tick during a rotation;
  move to a background refresh task if that ever shows up in a tick histogram.

### Tests
- The old `auth.rs` suite built its own HS256 `Validation` and called
  `jsonwebtoken::decode` directly — it tested the library, never
  `validate_token_sync`, which is exactly why both P0s shipped green. Replaced
  with tests of our own code: `user_from_claims` (admin role, role near-misses,
  `name` → `preferred_username` fallback, missing `sub`) and `validation_for`
  (RS256 pinned, issuer pinned, `validate_exp`, and a regression test asserting
  `aud` is *only* the configured audience).
- `auth_config_defaults_to_not_required` asserted a literal it had just
  constructed. Replaced with `parse_required`, a pure helper `from_env` now
  delegates to, tested over unset/""/false/true/1 (env mutation is `unsafe` in
  edition 2024 and racy across parallel tests, so the helper is the seam).

### Tests run
- Rust: `cargo test` — 40 sim + 28 server passed. TS: `pnpm test` 245 passed,
  `pnpm typecheck` clean.

## 2026-07-23 — Phase 18.2 + 18.3: Config persistence + user upsert

### Phase 18.2 — Config load/save from database
- `server/src/db.rs` — thin async DB accessor: `load_config(pool)`,
  `insert_config(pool)`, `upsert_user(pool)`. Uses raw `sqlx::query()` (no
  compile-time macros) so no build-time `DATABASE_URL` requirement.
- `main()` now keeps the `PgPool` as `Option<PgPool>` (not consumed inside
  the migration block). After migrations:
  - `load_config` → if a row exists, re-validates it through the **same**
    `validate_config()` from Phase 16.3. Passes → DB config replaces env.
    Fails → logs each error, keeps env config.
  - No row → `insert_config` seeds the DB with env values (id=1, default
    bot_count/map/rounds_to_win).
  - Load/seed error → warns, keeps env config.
- `DATABASE_URL` unset → pool is `None`, entire DB path skipped, bare
  `cargo run` unchanged.
- `PgPool` passed to `game_loop` for user upsert (Phase 18.3).

### Phase 18.3 — Users upsert on authenticated connect
- In `Ev::JoinTeam` handler, after successful token validation, calls
  `db::upsert_user(pool, sub, display_name, email=None)` — a single
  `INSERT … ON CONFLICT (sub) DO UPDATE SET display_name, email, last_seen`.
  No read-then-write race.
- `display_name` from `ValidatedUser.name`, falls back to `"unknown"` when
  the JWT doesn't carry a `name` claim (always non-null per the migration
  constraint).
- Normal flow: first-time login inserts the row; subsequent logins update
  `last_seen` (via the `DO UPDATE` clause). Mismatch between two
  simultaneous first-time logins with the same `sub` is impossible since the
  game loop is single-threaded.

### Tests
- Rust: `cargo test -p sim` 40 passed. `cargo test -p server` 28 passed.
  `cargo check` zero warnings.
- TS: `pnpm test` 245 passed. `pnpm typecheck` clean. `pnpm build` clean.

## Review fixes for ded671a (Phase 18.2 + 18.3)

Post-commit review of `ded671a` found three issues; all fixed in `server/src/main.rs`.

- **P0 — DB I/O blocked the 64 Hz game loop.** The Phase 18.3 `db::upsert_user`
  call was `.await`ed directly inside the `tokio::select!` arm of `game_loop`,
  the same task that drives the fixed-timestep tick. With `max_connections(2)`
  and sqlx's default 30 s acquire timeout, a slow or saturated DB would freeze
  the sim for every connected player. Now detached via `tokio::spawn` with a
  cloned `PgPool` (an `Arc`, so cheap); nothing downstream read the result.
  The spawned task also logs upsert failures instead of swallowing them with
  `let _ =` — a broken `app.users` table was previously invisible.
- **P2 — silent integer truncation on DB config load.** `rounds_to_win as u8`
  turned a DB value of `257` into a valid-looking `1`. Replaced both casts with
  `u8::try_from(..).unwrap_or(u8::MAX)` / `usize::try_from(..).unwrap_or(usize::MAX)`
  so out-of-range rows saturate into a validation *failure* (and the server
  falls back to env config) rather than truncating into a plausible value.
- **P3 — config is read-only.** Marked with a `ponytail:` comment: the row is
  seeded once and never written back, so `updated_at`/`updated_by` stay at
  their insert defaults until the admin config API lands.

Also restored two load-bearing comments the commit deleted: the rationale for
bailing on a migration failure against a *reachable* DB, and the note that
`prefetch_jwks` is safe to call unconditionally.

### Tests
- Rust: `cargo test -p server` 28 passed. `cargo build` zero warnings.
- No new tests: the truncation fix is a saturating conversion at a call site
  whose validator is already covered by `config_tests`, and the upsert detach
  needs a live Postgres to exercise.
