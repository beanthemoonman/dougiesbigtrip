# Plan to Implement

Target: a browser FPS demo with CS:Source-like look and movement feel. One map, two weapons,
bots, round loop. Single-player. ~5 weeks of evenings.

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

- [ ] Rapier world, static trimesh collider for a greybox room, kinematic capsule for player.
      Capsule: radius 0.4064 m, standing height 1.8288 m, ducked 0.9144 m.
- [ ] Implement `categorizePosition()` — ground trace, ground vs. air state, surface normal.
- [ ] Implement `friction()`, `accelerate()`, `airAccelerate()` per the doc's formulas.
- [ ] Implement `tryPlayerMove()` — collide-and-slide with 4 clip iterations + `clipVelocity`
      with the 1.0 overbounce factor.
- [ ] Step offset (`stepSize` = 0.4572 m): `stairs` up-trace / down-trace pass.
- [ ] Jump: fixed impulse `6.816 m/s` (= `sqrt(2 * 20.32 * 1.143)`, a 45-unit rise).
- [ ] Duck: crouch transition timing, ducked speed cap, and duck-jump.
- [ ] Air-strafe works: mouse + A/D in air gains speed. **This is the acceptance criterion.**
- [ ] `movement.test.ts` — golden tables from the doc. Keep green forever.
- [ ] View: eye height 1.6256 m (0.7112 m ducked), landing view-punch, no view bob yet.

**Exit test:** In a greybox room, you can bunnyhop-strafe down a corridor and exceed the
250 u/s (6.35 m/s) ground speed cap. Standing still on a slope doesn't slide. Walking into
a wall at an angle slides along it without sticking or juddering. Stairs are walked up, not
jumped up.

---

## Phase 2 — Combat (1 week)

Read `docs/weapon-feel.md`.

- [ ] Weapon defs data file: rate of fire, damage, armour pen, range falloff, spread,
      recoil table, mag size, reload time, movement speed multiplier.
- [ ] Two guns to start: an AK-analogue (rifle) and a USP-analogue (pistol). Distinct feel:
      spray vs. tap.
- [ ] Hitscan: raycast from camera centre (**not** the muzzle), with spread applied in a
      disc around the aim vector.
- [ ] Deterministic recoil: fixed spray pattern index advancing per shot, decaying back on
      trigger release. Recoil moves *the view*, and the bullet follows the view — same as CS.
- [ ] Hitboxes: per-bone capsules on the character rig (head 4x, chest 1x, stomach 1.25x,
      limbs 0.75x). Query against these, not the render mesh.
- [ ] Viewmodel: **separate camera + separate FOV + separate render pass**, layer 1,
      depth cleared between passes. See the doc — this is the #1 thing people get wrong.
- [ ] Weapon animation state machine: idle / fire / reload / draw / holster.
- [ ] Audio: positional gunshots, distance-based tail, first-person vs. third-person variants.
- [ ] HUD: health, armour, ammo, crosshair (dynamic gap driven by current inaccuracy).

**Exit test:** Full-auto the rifle at a wall from 10 m. The decals form a recognisable,
*repeatable* spray pattern — fire twice, the patterns match. Tapping at 30 m is accurate.
The viewmodel doesn't clip into walls and doesn't distort at the screen edges.

---

## Phase 3 — The map (1 week)

Read `docs/blender-pipeline.md` end to end **before opening Blender.** The lightmap UV
workflow has to be right from the first mesh or you redo everything.

- [ ] Build the modular kit in Blender: wall 2 m/4 m, doorframe, floor tile, stair, crate,
      pillar, roof. All on a 0.5 m grid. All at the correct texel density (see doc).
- [ ] Greybox the map with the kit. One small map: two spawns, three routes, one open site.
      Roughly the scale of half of Dust2's B site.
- [ ] Playtest the greybox with Phase 1 movement **before texturing**. Timings and sightlines
      are set now; art is set later.
- [ ] Texture with Poly Haven / Kenney CC0 sets. Tan sandstone, grey concrete, faded blue
      doors. Max 4 materials for the whole map.
- [ ] UV channel 2 (lightmap UVs), non-overlapping, packed. Bake in Cycles. Denoise. Export
      lightmap as EXR → KTX2.
- [ ] Export `.glb`. Import into three. Lightmap wired into `material.lightMap` + `lightMapIntensity`.
- [ ] Static-merge geometry per material. Verify draw call count.
- [ ] Add exponential fog + a skybox matching the lightmap's sun direction.

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

## Phase 5 — Polish + ship (½–1 week)

- [ ] Muzzle flash (sprite + brief light exception — the one allowed dynamic light), tracers,
      shell casings, impact decals per surface type, blood puffs, footstep audio per material.
- [ ] Surface types: material name convention drives impact sound + decal + footstep.
- [ ] Slight bloom, film grain off, sharp shadows only from the bake.
- [ ] Loading screen with real progress. Preload weapon/audio before spawn.
- [ ] `pnpm assets:opt`: Meshopt + KTX2/Basis. Verify the 16 MB budget.
- [ ] Settings: sensitivity, FOV (world), volume. Persist to a config object.
- [ ] Deploy static to Pages/Netlify. Verify on a mid-range laptop, not just your desktop.

**Exit test:** A stranger opens the URL on an integrated-GPU laptop, is shooting within 10 s,
and doesn't mention frame rate.

---

## Explicitly out of scope

- **Netcode.** Multiplayer needs client prediction, lag compensation, server reconciliation,
  and an authoritative server. It is a bigger project than everything above combined. If you
  want it later: Geckos.io (WebRTC unreliable channel) + a headless Node sim sharing
  `src/player/movement.ts`. The fixed-timestep discipline in Phase 0 is what makes that
  possible at all — which is why it's in Phase 0.
- Buy menu / economy
- Bomb plant/defuse (add in ~a day once rounds work, if you want it)
- Multiple maps
- Ragdolls (Rapier can, but the tuning time is a trap)

## Risk register

| Risk | Mitigation |
|---|---|
| Movement feels "floaty, but I can't say why" | Golden tests + the reference table. Don't tune by vibes alone; verify against numbers first, *then* tune. |
| Lightmap pipeline fights you for a week | Do the doc's 10-minute single-cube walkthrough before touching the real map. |
| Asset licence contamination | CREDITS.md at add-time. Never "just for testing." |
| Scope creep into multiplayer | It's in the out-of-scope list for a reason. |
| Blender UV2 mistakes discovered at texture time | Bake a test lightmap on the greybox before art passes. |
