# ACC-009 — Combat juice: muzzle flash, tracers, surface impacts, footsteps

Covers the **Phase 5** first bullet: "muzzle flash, tracers, impact decals per surface type, blood
puffs, footstep audio, surface-type convention." This is a **feel** feature, so per the Definition
of Done this script was written **before** tuning began, and must be run in a **real windowed
browser** — headless Chromium's synthetic pointer-lock click injects a spurious yaw jump and every
step here is look- and movement-dependent.

The verification the closes it is that the shot now has *weight* and *feedback*: you can tell you
fired, tell where the round went, and tell what you hit — flesh reads different from wall.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** ______________  **Date:** __________  **Commit:** __________  **Result:** ☐ PASS ☐ FAIL

## Steps

1. **The gun flashes.** Click to lock the mouse. Fire a single shot at a wall. A brief bright
   warm-white flash pops at the muzzle, in front of the gun, and is gone within a frame or two — a
   pop, not a lingering glow. Hold full-auto: it strobes with the fire rate.
   - ☐ Pass

2. **The flash lights nothing.** Fire in a dark corner. The flash is a bright quad but it does
   **not** illuminate the surrounding wall — the map is unlit/lightmapped and stays as baked. (If a
   wall visibly brightens on each shot, a realtime light snuck in against art-direction.md.)
   - ☐ Pass

3. **Tracers trace.** Fire at a distant wall. A thin bright line snaps from the muzzle to the
   impact point along the exact shot direction, then vanishes. Fire past a target into open space
   (a miss): the tracer still runs out to full range, so a whiff still reads as a shot fired.
   - ☐ Pass

4. **Impacts puff by surface.** Shoot: a **wall** (pale dust puff + a dark bullet hole), a **wood
   crate** (tan splinter puff + a hole), an **explosive barrel** (bright spark puff + a hole). Each
   puff sits flat on the surface at the crosshair and fades fast. The puff **colour** differs
   between concrete, wood, and metal.
   - ☐ Pass

5. **Blood, and no hole, on a bot.** Shoot a bot in the body. A **red** puff appears at the hit
   point and there is **no bullet hole left on the bot** (bodies don't take decals). Contrast with
   step 4: the feedback colour tells you "hit a person", not "hit a wall".
   - ☐ Pass

6. **Impacts sound different.** With volume up, listen: concrete/metal hits give a short bright
   tick, wood a duller knock, and a bot hit a low wet thud with no ricochet snap. You can tell what
   you hit with your eyes closed.
   - ☐ Pass

7. **Footsteps.** Walk in a straight line across the map. Soft footstep thumps play, paced by
   distance — they speed up when you move faster and stop the instant you stop. Standing still is
   silent; there is no first-step "pop" the moment you start again.
   - ☐ Pass

8. **The pools recycle and the budget holds.** Empty several mags in a row while watching the stats
   panel. Tracers and impact puffs keep appearing and expiring; nothing flickers or piles up, and
   the draw-call count does **not** climb with rounds fired — flash, tracers, and impacts are three
   fixed scene objects (one flash mesh + two `InstancedMesh` pools). Frame rate does not move.
   - ☐ Pass

9. **Nothing else broke.** Zero console errors. The old bullet-hole decals still land on hard
   surfaces (ACC-004 still holds); breakables still break; bots still take damage and die.
   - ☐ Pass

## Known gaps at the time of writing

- **No shell casings.** Deferred with a `ponytail:` note — barely visible in an FPS and pure
  animation code; add ejected instanced casings if a playtest asks for them.
- **Surface is inferred from what was hit, not from the geometry.** Bots → flesh, crates/pallets →
  wood, barrels/cans → metal, everything else (the whole map) → concrete. The Rapier collision is
  abstract cuboids with no material, and the visual map's concrete/sandstone/wood split lives only
  on the glb. If the map ever needs per-region footstep/impact surfaces, tag the map colliders at
  `buildMapColliders` time — the `Surface` convention and the FX/audio tables are already in place.
- **Footsteps are always concrete.** The greybox floor is uniform; per-region floors would key off
  the same tag-the-collider work above.
- **T2 (draw-call budget)** is asserted two ways: by eye on the stats panel in step 8, and — the
  part that actually pins it — a T0 test (`src/render/vfx.test.ts`) proving the pools add exactly
  three scene objects and never grow no matter how many effects fire. No headless-gl harness exists
  in this repo yet (same standing note as ACC-003/004).
