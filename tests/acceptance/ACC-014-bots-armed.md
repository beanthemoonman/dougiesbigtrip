# ACC-014 — Bots hold their weapons

Covers Bug 2: each bot now carries a rifle world-model parented to its right-hand bone, so it
tracks the idle/walk/death animations.

Written **before** tuning, per the Definition of Done. Run in a **real windowed browser**.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** Alexander Bean Apmann  **Date:** 2026-07-22  **Commit:** cacd251  **Result:** ✅ PASS
- **Re-run needed** (2026-07-26): the hold was re-solved as a shouldered rifle *square to the
  body* — steps 2 and 4 changed. **Tester:** ____  **Date:** ____  **Commit:** ____
  **Result:** ____

## Steps

1. **A gun in every hand.** Look at each bot. Each holds a rifle in its right hand — no
   empty-handed bots, no floating guns.
   - [ ] Pass

2. **The hold reads as a shouldered rifle.** From the front and the side: the **stock touches the
   right shoulder**, the **right hand is on the pistol grip**, the **left hand is on the
   handguard**, and — this is the one that keeps regressing — **from directly behind the bot the
   barrel runs straight away from you**, level, not canted across the chest. Not buried in the
   torso, not aimed at the sky, no hand floating off the gun. (Tuning knob: the landmarks at the
   top of
   `tools/modelview/solvepose.ts`. Re-solve, don't hand-edit the quaternions. Inspect without
   booting the game: `pnpm modelview assets/characters/ct_player.glb --weapon
   assets/weapons/ak_viewmodel.glb --pose rifle --angles back,hero,top,left`.)
   - [ ] Pass

3. **It tracks animation.** While a bot walks/turns, the gun moves with the hand, not the world.
   On death the gun stays in hand through the death anim (drop-on-death is out of scope).
   - [ ] Pass

4. **Muzzle FX follow the aim.** Let a bot shoot at you. The flash starts at the muzzle tip (not
   mid-receiver) and the tracer flies at *you*, straight down the barrel — bore and facing now
   agree, so a tracer that veers off means the hold has drifted off square.
   - [ ] Pass

5. **Budget holds.** Stats panel: draw calls still < 400 with all bots + guns on screen. Zero
   console errors.
   - [ ] Pass
