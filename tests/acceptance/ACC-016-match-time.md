# ACC-016 — Fixed 3-minute match time limit

Covers Bug 4: the match ends after a fixed 3 minutes (`MATCH_TIME = 180` s) of play, freezing on
a final banner instead of looping into another round.

Written **before** tuning, per the Definition of Done. Run in a **real windowed browser**.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** Alexander Bean Apmann  **Date:** 2026-07-22  **Commit:** cacd251  **Result:** ✅ PASS

> Tip: to avoid waiting 3 minutes each run, temporarily lower `MATCH_TIME` in `src/main.ts`, then
> restore it before committing the run.

## Steps

1. **It ends.** Play until the clock expires. At 3 minutes the match freezes: bots stop, the
   round no longer advances, and a `MATCH OVER   T n : n CT` banner shows the final score.
   - [ ] Pass

2. **It stays frozen.** After the banner appears, the world does not silently start another
   round — everything is held still.
   - [ ] Pass

3. **Score is right.** The banner's T:CT numbers match the round score you actually earned before
   time ran out.
   - [ ] Pass

4. **Nothing else broke.** Zero console errors; frame rate stable.
   - [ ] Pass
