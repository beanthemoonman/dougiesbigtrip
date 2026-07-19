# ACC-008 — Bots + round loop playtest

Covers the **Phase 4 finale**: bots wired into the live game (`src/main.ts`) — three CT bots
defending, a freezetime → live → over → reset round loop, two-way damage, and the round/score
HUD. The unit behaviour is under T1 (`brain.test.ts`, `round.test.ts`, `damage.test.ts`,
`hitbox.test.ts`); this script signs off that the *wiring* feels right in the real app.

Written **before** any tuning, per the Definition of Done. Run in a **real windowed browser**
(headless pointer-lock injects a spurious yaw jump; every step is look/aim dependent).

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** Alexander Bean Apmann  **Date:** 2026-07-19  **Commit:** 0e71ae2  **Result:** ✅ PASS

You spawn at **T** (south) as the lone attacker. Three red capsule bots hold **CT** (north).

## Steps

1. **Freezetime holds you still.** On load the banner reads `FREEZE 3…2…1` and you cannot move
   (mouse-look still works). At zero the banner clears and you can walk.
   - [x] Pass

2. **Bots react, not snap.** Push a lane until a bot sees you. It turns to face you over a beat
   (not instantly) before firing — no aimbot flick.
   - [x] Pass

3. **Bots lose you behind cover.** Break line of sight behind a crate/pillar. The bot stops
   firing and eventually gives up (stops tracking through the wall).
   - [x] Pass

4. **Your shots hurt bots; headshots hurt more.** Shoot a bot in the body — it takes several hits
   to drop. A shot to the top of the capsule kills far faster. A dropped bot disappears.
   - [x] Pass

5. **Bots hurt you.** Stand in the open and let a bot shoot: your **HP** falls. Take enough and
   the banner reads `DEAD` and you stop moving/firing.
   - [x] Pass

6. **Round ends and resets.** Kill all three bots → banner `YOU WIN`, the **T** score ticks up by
   one. Or die → `YOU LOSE`, **CT** score ticks. After a few seconds a new round begins: freezetime
   again, everyone respawned, HP back to 100, `ROUND` incremented.
   - [x] Pass

7. **Score is counted once.** Over several rounds the score matches the outcomes — no double
   counts, no ticking while the result banner is up.
   - [x] Pass
