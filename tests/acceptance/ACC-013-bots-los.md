# ACC-013 — Bots stop shooting through walls

Covers Bug 1: the TS Rapier world is now stepped each tick, so bot line-of-sight (and player
bullets) respect the map geometry instead of passing through walls.

Written **before** tuning, per the Definition of Done. Run in a **real windowed browser**.

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** Alexander Bean Apmann  **Date:** 2026-07-22  **Commit:** cacd251  **Result:** ✅ PASS

## Steps

1. **Cover works.** Get into a firefight with a bot, then break LOS behind a solid wall or crate
   stack. Within a moment the bot stops hitting you (HP stops dropping) — it can't see through
   the wall.
   - [ ] Pass

2. **Peeking re-engages.** Step back out into the bot's sightline. It re-acquires and starts
   firing again.
   - [ ] Pass

3. **Your bullets stop at walls too.** Shoot a solid wall with a bot directly behind it: the bot
   takes no damage (the ray is blocked). Shooting the bot in the open still damages it.
   - [ ] Pass

4. **Nothing else broke.** Zero console errors; frame rate stable; movement feel unchanged (the
   step() only rebuilds query structures — no dynamic bodies exist).
   - [ ] Pass
