# ACC-003 — HUD

Covers the Phase 2 HUD checkbox: health, armour, ammo, and a crosshair whose gap is driven by
the current inaccuracy.

Written **before** tuning, per the Definition of Done. Run in a **real windowed browser** — not
headless. Headless Chromium's synthetic pointer-lock click injects a large spurious yaw jump
(see the Phase 1 note in `plan_to_implement.md`), which makes every look-dependent step below
untrustworthy.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** _______________  **Date:** _______  **Commit:** _______  **Result:** PASS / FAIL

## Steps

1. **It's there.** On load, before clicking: bottom-left reads `HP 100` and `AP 100`,
   bottom-right reads `30 / 30` and `AK-analogue`, and a small green four-line crosshair sits at
   the exact centre of the screen.
   - [ ] Pass

2. **Standing gap is tight.** Click to lock the mouse. Standing still, the crosshair gap is a few
   pixels — it reads as a crosshair, not a box. Crouch (Ctrl): the gap gets no wider.
   - [ ] Pass

3. **Moving opens it.** Hold W and run. The gap visibly widens while moving and settles back
   within a moment of stopping. Jump: the gap opens *dramatically* wider than running — jumping
   should read as "do not shoot right now".
   - [ ] Pass

4. **Spraying opens it.** Standing still, hold left mouse and empty the mag. The gap grows shot
   over shot, is widest at the end of the spray, and shrinks back after releasing the trigger.
   - [ ] Pass

5. **Ammo counts down.** During that spray the counter falls `30 / 30` → `0 / 30`, one per shot,
   and firing stops at 0.
   - [ ] Pass

6. **Reload.** Press R. The ammo readout dims for ~2.5 s, no shots come out while it's dim, then
   it snaps back to `30 / 30` at full brightness.
   - [ ] Pass

7. **The view follows the recoil, and the bullet follows the view.** Fire a long spray at a wall
   and watch the crosshair itself: the *view* climbs up and to the left through the middle of the
   pattern (steps 8–12), then swings right — matching `docs/weapon-feel.md` §3. It must be the
   view that moves, not a crosshair drifting on a static view.
   - [ ] Pass

8. **Nothing else broke.** Zero console errors. The stats panel still shows a stable frame rate
   with the HUD up.
   - [ ] Pass

## Known gaps at the time of writing

- Bullets currently go nowhere: the world raycast and per-bone hitbox query need the character
  rig (Phase 3). Step 7 is judged on **view motion**, not on impacts — there are no decals yet.
  Re-run this script once decals land; that's what turns the Phase 2 exit test ("fire twice, the
  patterns match") into something observable.
- HP/AP are hardcoded at 100. Nothing damages the player until the Phase 4 round loop, so those
  two readouts are only checked for presence and formatting.
- **T2 (runtime budgets) does not apply.** The HUD is a DOM overlay: no draw calls, no
  materials, no assets. The DoD's HUD row asks for T2, but there is no GL surface to assert on —
  and no headless-gl/Playwright harness exists in this repo yet to assert it with. Revisit when
  the viewmodel pass lands, which *is* GL and does need T2.
