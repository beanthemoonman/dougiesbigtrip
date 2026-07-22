# ACC-018 — Movement & interaction tuning

**Written before tuning.** Phase 10 exit test.

Prerequisite: `pnpm dev` running. Single-player mode (no server needed for the movement
tests) — launch, pick a side, play.

---

## T3 — Dead stop (no residual creep)

1. Spawn and walk forward (W) for a moment to build speed.
2. Release all movement keys.
3. **Expect:** The player comes to a **complete dead stop** — no residual forward drift, no slow
   creep in any direction. The view stops immediately.
4. Repeat but strafe (A/D) and release. Same expectation.

**PASS / FAIL** (commit: ________)

---

## T3 — Walk (Shift) speed

5. Walk forward (W) and alternately hold and release **Shift**.
6. **Expect:** Holding Shift noticeably reduces movement speed. Releasing Shift returns to full
   speed. The speed change is immediate; Shift does **not** trigger any browser shortcut or
   sticky-keys prompt. The browser's address bar does not jump focus.
7. Hold Shift and walk sideways (A/D). **Expect:** speed remains reduced.

**PASS / FAIL** (commit: ________)

---

## T3 — Crouch (Ctrl) speed

8. Hold **Ctrl** and walk forward. **Expect:** You move at crouch speed (~34% of normal)
   — noticeably slower than standing walk. The browser does **not** fire Ctrl+W (close-tab) or
   any other Ctrl shortcut while pointer-locked.
9. Release Ctrl and continue walking. **Expect:** speed returns to full.

**PASS / FAIL** (commit: ________)

---

## T3 — Breakable collision (crates)

10. Walk up to an intact wooden crate (the greybox map has crates at various positions).
    Push against it with W.
11. **Expect:** You **cannot** walk through it. The crate is a solid obstacle.
12. Shoot the crate until it breaks (3–4 rifle shots).
13. **Expect:** The crate mesh disappears the instant it breaks. You can now walk through
    where it was — there is **no invisible box** blocking you.
14. Walk back through the spot. **Expect:** No ghost collider snags you.
15. Find a barrel. Shoot it until it breaks. Same expectations.

**PASS / FAIL** (commit: ________)

---

## T3 — Crouch-jump onto crates

16. Find a crate near a wall. Stand beside it.
17. Hold **Ctrl** (duck) and press **Space** (jump) while strafing onto the crate.
18. **Expect:** The duck-jump clears the crate height and you can **land and stand on top**
    of the crate. The standing position should be stable — you don't slide off.
19. While standing on the crate, shoot it out.
20. **Expect:** The crate breaks, your player falls to the floor. You land and can walk
    normally. No floating above where the crate was.

**PASS / FAIL** (commit: ________)

---

## T3 — Walk + crouch combined

21. Hold both **Shift** and **Ctrl** together while walking forward.
22. **Expect:** You move at the combined reduced speed — even slower than either alone.
    Neither key triggers a browser action.

**PASS / FAIL** (commit: ________)

---

**Overall: PASS / FAIL**

(All items must PASS for the phase to exit.)
