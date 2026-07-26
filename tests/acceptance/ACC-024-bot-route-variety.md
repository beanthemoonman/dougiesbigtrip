# ACC-024 — Bot route variety and unsticking

T3 for the search-goal jitter/repulsion rework and the stuck detector
(`src/ai/{navnodes,brain}.ts`, `server/src/ai.rs`). Written **before** tuning was run in-app.

Boot: `pnpm dev`, `?bots=3`, difficulty normal. Stay dead/hidden where a step says so — the bots
must be in **search** mode for the routing steps.

## A — Route variety (SP)

1. Watch the bots from spectator for three full rounds without engaging them.
   **Expect:** the squad does not repeat the same loop each round. Over the three rounds you see
   bots visit the spine, both curve/flank nodes, *and* at least one low-traffic node (a spawn-side
   or corner node) — not only the three high-weight tactical nodes.
   - [ ] Pass

2. **They don't conga-line.** At any moment, no two bots are walking the same corridor in file
   toward the same node. When one bot closes on another, the second re-picks and peels away.
   - [ ] Pass

3. **Determinism didn't break.** Restart the round with the same seed and no player input:
   the bots take the *same* routes as the identical prior run (the jitter is a hash of the tick,
   not an RNG). If two identical-seed runs diverge, that's a P0 determinism bug, not a tuning nit.
   - [ ] Pass

## B — Unsticking from breakables

4. Find a bot walking a corridor with crates in it. **Expect:** it does not press itself into a
   crate and grind. Within ~half a second of contact it strafes out and continues.
   - [ ] Pass

5. Stack/park yourself so a bot is boxed against a crate on a route it wants. **Expect:** after two
   failed sidesteps it abandons that goal and heads somewhere else entirely, rather than
   oscillating against the obstacle.
   - [ ] Pass

6. Shoot the crate away while a bot is sidestepping past it. **Expect:** no snap, no teleport — the
   bot just walks on. (The collider is removed with the mesh, so there is nothing left to bump.)
   - [ ] Pass

7. **No new stuck cases created.** Over three rounds no bot ends the round motionless against
   geometry, and none walks a permanent circle.
   - [ ] Pass

---

**Overall:** not yet run

**PASS recorded against commit:** _pending_
**Tester:** _pending_
**Date:** _pending_
