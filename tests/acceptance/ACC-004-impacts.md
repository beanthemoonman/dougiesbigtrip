# ACC-004 — Bullet impacts and the spray pattern

Covers the **Phase 2 exit test**: "Full-auto the rifle at a wall from 10 m. The decals form a
recognisable, *repeatable* spray pattern — fire twice, the patterns match. Tapping at 30 m is
accurate." Also `docs/weapon-feel.md` §3's acceptance test.

Written **before** tuning, per the Definition of Done. Run in a **real windowed browser** — not
headless, for the same reason as ACC-003: headless Chromium's synthetic pointer-lock click
injects a large spurious yaw jump, and every step here is look-dependent.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** _______________  **Date:** _______  **Commit:** _______  **Result:** PASS / FAIL

## Steps

1. **Bullets land.** Click to lock the mouse. Fire one shot at a wall. A single small dark hole
   appears on the wall, at the crosshair, flat against the surface — not floating off it, not
   edge-on, not sunk into it and flickering.
   - [ ] Pass

2. **Every surface takes them.** Put a hole in a wall, in the floor, and on the side of the
   staircase. All three sit flat on their surface. The floor one in particular is the case that
   breaks first if the decal basis is wrong.
   - [ ] Pass

3. **The pattern is a shape.** Stand ~10 m from a wall (the greybox is 20 m across, so from one
   wall aim at the far one). Standing still, hold left mouse and empty the mag *without*
   compensating. The holes form the AK shape from `docs/weapon-feel.md` §3: up hard for the first
   7, left through 8–12, right through 13–20, loose scatter after. It must read as a *pattern*,
   not a cloud.
   - [ ] Pass

4. **The pattern repeats — this is the exit test.** Reload (R). Without moving, from the same
   spot, aim at the same point and empty the second mag. The two patterns are recognisably the
   same shape. They will not be pixel-identical — the random spread disc is deliberately on top —
   but if the second one is a differently-shaped cloud, the recoil is random and the model is
   wrong.
   - [ ] Pass

5. **Tapping at 30 m is accurate.** The greybox is only 20 m across, so this step **cannot be run
   as written** until Phase 3's map exists. Substitute: from the far corner (~20 m diagonal),
   single-tap the opposite wall 5 times, pausing ~1 s between shots for the spray index to reset.
   All 5 holes land in a tight cluster on the crosshair. If they scatter, the spray index isn't
   resetting or the still-stance spread is too wide.
   - [ ] Pass — note the substitution above when recording the result.

6. **Recoil is visible in the impacts, not just the view.** Fire a long spray while pulling the
   mouse *down and against* the pattern. The holes should stay clustered near the crosshair —
   that's the compensation skill the whole model exists to reward. If pulling down doesn't bring
   the impacts down, the bullet isn't following the view.
   - [ ] Pass

7. **The pool recycles cleanly.** Empty four mags (128 holes, `MAX_DECALS`). Keep firing. The
   oldest holes start disappearing one at a time as new ones appear. Nothing flickers, and the
   frame rate on the stats panel doesn't move.
   - [ ] Pass

8. **Nothing else broke.** Zero console errors. Draw calls have not meaningfully changed — all
   decals share one `InstancedMesh`, so the whole system costs exactly one.
   - [ ] Pass

## Known gaps at the time of writing

- **The viewmodel half of the exit test is not covered here.** The full Phase 2 exit test also
  says "the viewmodel doesn't clip into walls and doesn't distort at the screen edges". No
  viewmodel exists yet — that needs a weapon asset. That clause gets its own script when the
  viewmodel pass lands; Phase 2 is not done until then.
- **Bullets stop at the first surface.** No wall penetration — `docs/weapon-feel.md` §6 makes it
  explicitly optional for the demo, and nothing in the greybox is thin enough for it to read.
- **No impact particles, sparks, or sound.** Phase 5, along with surface-type-matched decals; the
  hole is currently one flat dark disc regardless of what it hit.
- **Nothing takes damage.** These are world impacts only. The per-bone hitbox query needs the
  character rig (Phase 3); `src/game/damage.ts` has the math waiting for it.
- **T2 (runtime budgets)** is asserted by eye in step 8. No headless-gl/Playwright harness exists
  in this repo yet — same note as ACC-003. The one-draw-call claim is a property of using a
  single `InstancedMesh` and is visible in the stats panel, but it is not yet pinned by a test.
