# ACC-006 — Two weapons, switching, animation, audio

Covers the remaining Phase 2 items: the two guns' distinct feel (spray vs. tap), weapon
switching, the anim FSM (idle/fire/reload/draw/holster), and weapon audio.

Written **before** tuning. Run in a **real windowed browser** (look-dependent, and audio needs a
real audio device — headless has none). Sound is judged by ear; there's no automated audio assert.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** _______________  **Date:** _______  **Commit:** _______  **Result:** PASS / FAIL

## Steps

1. **Two distinct guns.** Click to lock. `1` = AK (30 rounds, `AK-analogue`), `2` = USP (12
   rounds, `USP-analogue`). The HUD name and ammo count change with the key. The pistol is
   visibly a different, smaller model held higher/closer than the rifle.
   - [ ] Pass

2. **Draw animation on switch.** Each time you switch, the new gun animates *up into view* from
   below (a quick raise), rather than popping in fully-formed. The old gun dips out of view first
   (holster), then the new one draws.
   - [ ] Pass

3. **Ammo persists per weapon.** Fire the AK down to e.g. 20/30, switch to pistol, switch back —
   the AK still reads 20/30 (each gun keeps its own mag), not reset to 30.
   - [ ] Pass

4. **Spray vs. tap feel.** Hold the AK trigger: it climbs and pulls in the §3 pattern, hard to
   control. Hold the USP trigger: it fires slower (semi-ish cadence), climbs gently and nearly
   straight. Tapping the USP at a distant point lands accurately.
   - [ ] Pass

5. **Fire animation.** While firing, the gun kicks back toward you and the muzzle rises, settling
   between shots. It's additive — the gun can kick while otherwise idle, and full-auto stays
   smooth (no anim restart stutter per shot).
   - [ ] Pass

6. **Reload animation + gating.** Press `R`: the gun dips and rolls down through the reload, comes
   back up, and the ammo refills only when it returns. You cannot fire mid-reload, mid-draw, or
   mid-holster. Switching weapons is likewise ignored until the current anim finishes.
   - [ ] Pass

7. **Audio.** Each shot makes a gunshot sound — the AK punchier/brighter, the USP shorter/drier.
   Reload makes a two-click (mag-out / mag-in) sound. Audio starts only after the first click
   (the pointer-lock gesture unlocks the AudioContext); no shot before that is silent-then-loud.
   - [ ] Pass

8. **Nothing else broke.** Zero console errors across switching/firing/reloading. Stats panel
   frame rate stays stable with both models loaded.
   - [ ] Pass

## Known gaps at the time of writing

- **Audio is synthesised, mono, non-positional** (`src/core/audio.ts`, Web Audio, not Howler).
  No distance tail, no first-person/third-person variants, no shell-casing tink. Those land with
  bots in Phase 4 (positional) / Phase 5 (polish). See the CLAUDE.md stack note.
- **No real reload/draw *content*** — the anims are procedural pose moves (dip/raise/kick), not
  authored clips or mag-swap geometry (the models have no armature). Good enough to read; a rigged
  weapon with hands is out of scope for the demo.
- **Viewmodel poses are taste dials**, tuned by eye (rest offset in `main.ts`, FOV in
  `renderer.ts`). The pistol in particular is dark polymer and reads as a dark shape — fine for a
  greybox.
- **No viewmodel sway/bob** on look/walk (Phase 5 "small things").
- Draw-call budget still not auto-asserted (no T2 harness). Two models on one layer-1 pass; only
  the visible one draws (~2 calls).
