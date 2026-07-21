# ACC-017 — Game flow: team select, spectator, join gating

**Written before tuning.** Phase 9 exit test.

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
9. **Expect:** Spawned at T spawn on the next round. Player body back. HUD back.

**PASS / FAIL** (commit: ________)

---

## T3 — Multiplayer join flow + full-team gate

Prerequisite: Rust server running, one browser connected as a player (slot 0).

10. Open a **second browser** (incognito or different profile) to `http://localhost:5173`.
11. **Expect:** Team menu appears. Capacity info shows `Players: 1 / 10, Spectators: 0 / 7`.
12. Click **T**.
13. **Expect:** Team menu disappears. Player is **queued** — no body appears, snapshots
    stream but the slot shows a bot playing.
14. Wait for the current round to end (all one team dies or clock expires).
15. **Expect:** On next freezetime, the queued player spawns at T spawn. HUD appears.
16. In the second browser, during play, press Esc and click **Spectate**.
17. **Expect:** Body disappears, spectator free-fly active. Can watch the match continue.

18. Connect a **third browser**. Click **T**.
19. If T is full (both T slots occupied by humans), **Expect:** Spectate button is the only
    enabled choice. T and CT buttons are greyed out or show "Full."
20. Click **Spectate**.
21. **Expect:** Spectator mode active. Free-fly camera. Match visible.

---

## T3 — Capacity gates (Gate 1 and Gate 2)

Prerequisite: Server running with all 10 player slots filled by humans and 7 spectators
connected.

22. Open a **new browser** and try to connect.
23. **Expect (Gate 2):** Connection is refused. The server sends `Bye{reason:"full"}` and
    closes the socket. The client shows an error message ("Server is full" or similar).
24. From the host machine, run `curl http://127.0.0.1:9876/status`.
25. **Expect (Gate 1):** JSON response: `{"players":10,"maxPlayers":10,"spectators":7,"specCap":7}`.

**PASS / FAIL** (commit: ________)

---

## Sign-off

| Run | Date | Commit | Tester | Result |
|---|---|---|---|---|
| 1   |      |        |        |        |
