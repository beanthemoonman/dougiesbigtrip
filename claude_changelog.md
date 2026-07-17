# Claude Changelog

A running log of what Claude Code did in this repo, appended to at the end of each turn.

---

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
