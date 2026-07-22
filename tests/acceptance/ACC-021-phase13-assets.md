# ACC-021 — Phase 13 Asset Refinement Acceptance

**Written:** 2026-07-22 (before tuning)
**Runs against:** Phase 13 build (map textures, weapon detail, de-floaty characters,
breakable respawn, map-life set-dressing)
**Prerequisite:** `pnpm dev` against a server (`pnpm server:dev` or solo via `?solo`)

## Step 1 — Map surfaces read as real materials

1. Load the map and observe the walls/floor:
   - [ ] The large sandstone perimeter walls show block lines (large_sandstone_blocks texture)
   - [ ] The concrete spine/counter walls show grain/wear (concrete_wall_003 texture)
   - [ ] The wood crate boxes show plank detail (brown_planks_05 texture)
   - [ ] Surfaces are not flat-colour noise bands — the detail reads as photographic
2. Verify no visual regressions:
   - [ ] Lightmapped shadows still present under crates/walls
   - [ ] Fog still colours the distance correctly
   - [ ] No texture seams visible at wall edges (RepeatWrapping holds)

## Step 2 — Weapon viewmodel reads as a real object

1. Spawn in, look at the rifle in your hands:
   - [ ] Metal surfaces (receiver, barrel, gas tube) show subtle surface breakup — not perfectly flat
   - [ ] Wood grip and stock have visible surface variation
   - [ ] The viewmodel still renders correctly in its own pass (no world clipping, correct FOV)
   - [ ] Switch to pistol (press `2`): same treatment on the slide/frame

## Step 3 — Characters read as connected solid bodies

1. Observe a bot at ~10 m:
   - [ ] No visible gaps at the elbows and knees when walking
   - [ ] Shoulder/hip joints are bridged — the body reads as one connected unit
   - [ ] Character head is visible above the shoulders (neck joint present)
2. Kill a bot and watch the death animation:
   - [ ] Joints stay connected during the death crumple

## Step 4 — Breakables respawn at round reset

1. Find a crate/barrel and shoot it until it breaks:
   - [ ] The prop vanishes (no floating mesh)
   - [ ] You walk through where it was (no invisible collider)
2. Wait for the round to end (or kill all bots to trigger reset):
   - [ ] On the next round, the destroyed crate/barrel is back
   - [ ] It is solid again (you can bump into it)
   - [ ] If it was a stacked crate, both levels are restored
3. Shoot only the top crate of a stack:
   - [ ] The top crate breaks, the bottom remains (cascade is correct)

## Step 5 — Map life: set-dressing present

1. Walk to the T spawn area (south end, near z = -25):
   - [ ] A dark metal sign with orange border, ↑ arrow, and "SPAWN" label is visible on the wall
2. Walk to the CT spawn area (north end, z = +25):
   - [ ] A matching "SPAWN" sign on the wall
3. Scan the play area:
   - [ ] Props have varied colours (not all identical — barrels have different rust shades, crates differ)
   - [ ] Extra set-dressing (cones, jerry cans) visible at new positions in the map

## Step 6 — Budgets

1. Open the browser devtools console, type `renderer.info.render.calls`
   - [ ] Draw call count < 400
2. Check the Network tab for total downloaded bytes:
   - [ ] Initial page load < 48 MB

## Result

| Step | PASS/FAIL | Notes |
|---|---|---|
| 1 — Map textures | | |
| 2 — Weapon viewmodel | | |
| 3 — Characters connected | | |
| 4 — Breakable respawn | | |
| 5 — Map life | | |
| 6 — Budgets | | |

**Overall:** PASS / FAIL

**Tester:** ______________ **Date:** ______________ **Build commit:** ______________
