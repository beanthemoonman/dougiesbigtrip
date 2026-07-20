# ACC-014 — Bots hold their weapons

Covers Bug 2: each bot now carries a rifle world-model parented to its right-hand bone, so it
tracks the idle/walk/death animations.

Written **before** tuning, per the Definition of Done. Run in a **real windowed browser**.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** _____  **Date:** _____  **Commit:** _____  **Result:** ⏳ PENDING

## Steps

1. **A gun in every hand.** Look at each bot. Each holds a rifle in its right hand — no
   empty-handed bots, no floating guns.
   - [ ] Pass

2. **Grip reads right.** The rifle sits in the hand and points roughly down the arm/forward — it
   is not buried in the torso or aimed at the sky. (If it clips, note it: `BOT_GUN_POS` /
   `BOT_GUN_ROT` in main.ts are the tuning knobs.)
   - [ ] Pass

3. **It tracks animation.** While a bot walks/turns, the gun moves with the hand, not the world.
   On death the gun stays in hand through the death anim (drop-on-death is out of scope).
   - [ ] Pass

4. **Budget holds.** Stats panel: draw calls still < 400 with all bots + guns on screen. Zero
   console errors.
   - [ ] Pass
