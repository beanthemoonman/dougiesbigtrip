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
