# ACC-015 — Dying switches to a spectator cam

Covers Bug 3: on death the camera detaches from the corpse and free-flies (noclip) with the
mouse + WASD until respawn.

Written **before** tuning, per the Definition of Done. Run in a **real windowed browser**.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** Alexander Bean Apmann  **Date:** 2026-07-22  **Commit:** cacd251  **Result:** ✅ PASS

## Steps

1. **Death enters spectate.** Let a bot kill you. The view stops being locked to the corpse; the
   HUD banner reads `SPECTATING`; the viewmodel weapon disappears.
   - [ ] Pass

2. **Free-fly works.** WASD moves the camera; mouse looks. W flies the direction you're looking
   (climbs when you look up). Space/Ctrl raise/lower. You pass through walls (noclip).
   - [ ] Pass

3. **The world keeps running.** While spectating, bots keep fighting and moving — the sim did not
   freeze, only your player is dead.
   - [ ] Pass

4. **Respawn restores first-person.** On the next round reset you respawn: first-person returns,
   the weapon reappears, WASD moves the player normally again.
   - [ ] Pass

5. **Nothing else broke.** Zero console errors; frame rate stable.
   - [ ] Pass
