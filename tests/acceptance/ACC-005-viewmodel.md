# ACC-005 — Viewmodel render pass

Covers the viewmodel clause of the **Phase 2 exit test**: "The viewmodel doesn't clip into walls
and doesn't distort at the screen edges." Plus the setup in `docs/weapon-feel.md` §1 (separate
camera, separate FOV, separate pass, `clearDepth()` between passes).

Rendering / art-direction features are T2 (config) + T3 (acceptance) in the DoD. No headless-gl
harness exists in this repo, so the config assertions here are checked by eye — same standing gap
as ACC-003/ACC-004. Run in a **real windowed browser**.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** Alexander Bean Apmann  **Date:** 2026-07-17  **Commit:** aafcb6b  **Result:** ✅ PASS

## Steps

1. **It's there and it's an AK.** On load, the weapon sits in the lower-right of the screen —
   recognisable receiver, wood handguard, barrel with a front sight, curved magazine hanging
   down. It is lit (wood reads brown, metal dark grey — **not** flat black, which is the failure
   mode for un-environment-mapped PBR metal).
   - [ ] Pass

2. **Drawn on top, never clipped by the world — the whole point of §1.** Walk right up against a
   wall until the camera is nearly touching it. The gun stays fully drawn; no part of it is
   sliced away by the wall's depth. Walk into a corner, into the underside of the staircase —
   the gun is never cut.
   - [ ] Pass

3. **No edge distortion.** The gun is rendered with its own ~60° FOV, not the 90° world FOV, so
   it does not stretch or fisheye at the screen edge the way a 30 cm-from-camera object would in
   the world pass. Look around quickly; the gun's proportions stay stable.
   - [ ] Pass

4. **The world still looks right behind it.** The world pass is unaffected: fog, palette,
   geometry, and the HUD all render as before. The two passes composite cleanly — no z-fighting
   flicker between gun and world, no double-cleared black frame.
   - [ ] Pass

5. **Recoil moves the view, gun rides along.** Fire a spray. The view kicks (crosshair climbs)
   and the gun is still welded to the view — it doesn't lag off-screen or detach. (Viewmodel
   sway/kick *animation* is a separate Phase 5 item; this only checks the gun stays put under the
   view kick.)
   - [ ] Pass

6. **Nothing else broke.** Zero console errors. Stats panel shows a stable frame rate; the second
   pass hasn't tanked it.
   - [ ] Pass

## Known gaps at the time of writing

- **Viewmodel position is a taste dial**, tuned by eye (`docs/weapon-feel.md` §1 says to expose
  FOV in settings, default 60°). Not asserted by a test; if it reads wrong, adjust the offset in
  `main.ts` and the FOV constant in `render/renderer.ts`.
- **No viewmodel animation** yet — no idle sway, no bob, no fire/reload/draw/holster clips. The
  weapon anim FSM is the next Phase 2 item. The gun is currently static relative to the view.
- **No draw-call assertion.** The DoD budget (< 400) is not auto-checked — no T2 harness. The
  second pass adds ~2 calls (two materials on one mesh); the greybox is trivial, so the budget is
  not a concern here, but it is not pinned.
- **`viewCamera` is static at the origin.** The weapon lives in eye-space, so the doc's
  world-camera pose copy is a no-op for an isolated viewmodel scene and is skipped (commented in
  `renderer.ts`). Revisit if world-anchored effects ever join the viewmodel pass.
