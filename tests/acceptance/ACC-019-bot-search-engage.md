# ACC-019 — Advanced bot AI: search & engage

**Written before tuning.** Phase 11 exit test.

Prerequisite: `pnpm dev` running.

This is a **two-part** test: first in single-player (SP), then in multiplayer (MP). The MP
portion requires `docker compose up` running the server so you can connect two browsers.

---

## Part A — Single-player (SP)

### A1 — Bots fan out (no fixed routes)

1. Launch the game in SP mode. Pick the **CT** team (so you are a CT and T bots are enemies).
2. Stay behind the CT spawn wall. Do **not** move for at least 30 seconds.
3. Open the scoreboard (Tab) — confirm all 3 T bots are listed alive.
4. Watch the T bots via the overview/spectator cam, or walk out and observe them from a
   distance. **Expect:** The bots fan out across the map over 10+ seconds — minimum 2 of the
   3 bots take the **east curve path** (nodes 8→10→12 or 9→11→12), not all rushing straight
   up the spine corridor. They do **not** cluster at a single spot and they do **not** walk a
   fixed repeating loop.
5. Kill all three T bots (shoot them). Watch them respawn next round (round timer triggers
   auto-reset when one side is wiped).
6. **Expect:** After respawn, the T bots fan out again — the pattern starts from scratch,
   not a continuation of the previous round's positions.

### A1b — Caution pauses (bots don't rush)

7. Continue watching bots in search mode (no targets visible). **Expect:** Bots **pause
   periodically** — they stop walking, stand still, and slowly scan their head left/right
   for ~1.5 seconds before resuming movement. The pauses are scattered (different bots pause
   at different times) — they do **not** all stop simultaneously in lockstep.
8. **Expect:** While pausing, the bot's head turns smoothly (not snapping). While moving,
   the bot walks at a **reduced pace** — not sprinting full-speed. The overall rhythm
   reads as "cautious search," not "rushing between nodes."

**PASS / FAIL** (commit: ________)

---

### A2 — Engage on sight

9. Walk into the open area (east of the spine). Find a T bot looking away from you.
10. Wait for it to turn or for you to enter its FOV. **Expect:** The moment a bot gets LOS,
    it switches from searching/walking to **standing and shooting** within a short reaction
    delay (< 1 second). You take damage.
11. Walk past a bot at close range. **Expect:** It acquires you within its view cone and
    opens fire.

**PASS / FAIL** (commit: ________)

---

### A3 — Break LOS → reposition

12. Get a bot to engage you (as in A2). Step behind a **wall** or corner to break line of
    sight.
13. **Expect:** The bot immediately stops firing. It does **not** continue tracking or
    shooting through the wall. After a brief pause it moves toward the spot where it last
    saw you (reposition step). It does **not** give up instantly — it walks toward your
    last-known position.
14. Do the same test with a **crate**: stand behind an intact wooden crate, out of the bot's
    view. **Expect:** The bot does not track or fire through the crate. If you break it,
    the bot can re-acquire.

**PASS / FAIL** (commit: ________)

---

### A4 — Stay hidden → bot resumes search

15. After breaking LOS (A3), stay hidden behind a wall that blocks movement pathing
    (e.g. the spine wall or CT spawn wall). Wait 5+ seconds.
16. **Expect:** The bot stops searching for you at the last-known spot. It resumes fanning
    out — picks a new graph node goal and walks away. It does **not** camp the spot
    indefinitely.

**PASS / FAIL** (commit: ________)

---

### A5 — No wall-hacks

17. Stand behind a **wall** (any collider, e.g. the spine wall at x=-9 between spine
    corridor and open area). A bot is on the other side, within hearing/sight range but
    with no direct line of sight.
18. **Expect:** The bot never acquires you — it does not turn toward you, track you
    through the wall, or fire at you. If you peek out and duck back, it acquires on
    peeking and loses on ducking.

**PASS / FAIL** (commit: ________)

---

## Part B — Multiplayer (server authoritative)

> Run `docker compose up` or start the server (Phase 8). Connect two browser windows.

### B1 — Bots fan out (server-side)

19. Connect as Player 1, pick CT. Connect as Player 2, pick CT as well (so both human
    players are CT and T bots fill the other side — the server autoruns).
20. **Expect:** T bots fan out on the server side (same fanning behaviour as SP). Both
    clients see the same bot positions and movement. Bots pause and scan periodically
    (caution rhythm visible from both clients in sync).

### B2 — Server-authoritative engage + reposition

21. Player 1 engages a T bot: get LOS, trigger the bot to fire.
22. **Expect:** Player 2 sees the T bot standing and firing, then moving toward last-known
    when Player 1 breaks LOS. Both clients agree on the bot's behaviour because it all
    runs on the server.
23. Player 1 hides and stays hidden. **Expect:** The bot resumes searching after the
    give-up timeout — Player 2 sees it fan out again.

### B3 — MP wall-hack check

24. Both players stand behind a wall. A bot is on the far side. **Expect:** The bot does
    not track either player through the wall (server-side can_see raycast).

**MP PASS / FAIL** (commit: ________)

---

**Overall: PASS / FAIL**

(All items must PASS for the phase to exit. The MP portion is a subset — it exists to
confirm the server is authoritative; the core behaviours are covered in SP Part A.)

---

**PASS recorded against commit:** ________
**Tester:** ________
**Date:** ________
