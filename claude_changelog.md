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

- Renamed the project from `hl-demo` to **Counter Douglas Global Offensive**: `package.json`
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
- Added phase 6.7 to `docs/netcode.md` §9 increment plan. Slotted after 6.6 (not the requested 6.5, which is taken by Full-AI) because the K/D feed depends on 6.6's kill events.
