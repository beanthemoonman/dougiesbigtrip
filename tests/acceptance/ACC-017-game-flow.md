# ACC-017 — Game flow: team select, spectator, join gating

**Written before tuning.** Phase 9 exit test.

**Amended (roster & capacity):** 3v3 by default (3 bots/team). Joining a side **replaces a bot
instantly, mid-round** — no "spawn next round" wait. Leaving a side → bot backfills next round.
Capacity = **6 players + 4 spectators**. Automated coverage of these rules lives in
`tests/e2e/roster.e2e.ts` (`pnpm test:e2e`); this T3 is the human-in-the-loop pass.

Prerequisite: `pnpm dev` running, Rust server on `ws://127.0.0.1:9876` (`cargo run -p server`).

---

## T3 — Single-player team menu + spectate

1. Open `http://localhost:5173` in a fresh browser tab.
2. **Expect:** A team menu overlay (T / CT / Spectate) over a free-look view of the map. No
   player body visible. No HUD. No round clock running.
3. Click **CT**.
4. **Expect:** Team menu disappears. Player spawns at CT spawn. HUD appears (health, ammo,
   crosshair). Round freezetime clock counts down.
5. Play. Move, shoot bots.
6. Press **Esc** (or click out of pointer lock) → the settings panel opens. Click **Spectate**
   under the Game section.
7. **Expect:** Player body disappears. Free-fly spectator camera active (WASD, mouse look,
   space/ctrl for altitude). Can fly around the map while the match continues.
8. Click **Join T** in the settings panel.
9. **Expect:** Spawned **immediately** at T spawn (replacing a T bot). Player body back. HUD
   back. The T side still totals three (you + two bots).

**PASS** (commit: 8070065)

---

## T3 — Multiplayer join flow + full-team gate

Prerequisite: Rust server running, one browser connected as a player (slot 0).

10. Open a **second browser** (incognito or different profile) to `http://localhost:5173`.
11. **Expect:** Team menu appears. Capacity info shows `Players: 1 / 6, Spectators: 0 / 4`.
12. Click **T**.
13. **Expect:** Team menu disappears. Player **spawns immediately** at T spawn, mid-round,
    replacing a T bot. Body and HUD appear right away — no wait for the next round.
14. In the second browser, during play, press Esc and click **Spectate**.
15. **Expect:** Body disappears, spectator free-fly active. The seat you left keeps playing as a
    dead slot until the round resets, then a bot backfills it. Match continues.

16. Connect a **third and fourth browser** and join **T** on both.
17. **Expect:** With 3 humans on T, T is full. The next player to pick **T** gets only the
    Spectate choice (T greyed / "Full"); **CT** still has room and spawns instantly.
18. Click **Spectate**.
19. **Expect:** Spectator mode active. Free-fly camera. Match visible.

---

## T3 — Capacity gates (Gate 1 and Gate 2)

Prerequisite: Server running with all **6** player slots filled by humans and **4** spectators
connected.

20. Open a **new browser** and try to connect.
21. **Expect (Gate 2):** Connection is refused. The server sends `Bye{reason:"full"}` and
    closes the socket. The client shows an error message ("Server is full" or similar).
22. On any connected client's team menu, read the capacity line.
23. **Expect (Gate 1):** `Players: 6 / 6, Spectators: 4 / 4` — sourced from the `Welcome`
    message. The `GET /status` HTTP endpoint also returns this as JSON
    (`curl http://127.0.0.1:9876/status` → `{"players":6,"maxPlayers":6,"spectators":4,"specCap":4}`).

**PASS** (commit: 8070065)

---

## Sign-off

| Run | Date | Commit | Tester | Result |
|---|---|---|---|---|---|
| 1   | 2026-07-23 | 8070065 | dev | PASS |
