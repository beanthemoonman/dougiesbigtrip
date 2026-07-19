# ACC-012 — Authoritative server movement (Phase 6.3)

Covers **increment 6.3** in `docs/netcode.md` §9: *"CommandFrames in → server ticks movement →
snapshots out → client predicts + reconciles. No remote players yet. Check: in-browser movement
is server-driven, reconciliation invisible, no rubber-band."*

Written **before** any netcode tuning, per the Definition of Done. Run in a **real windowed
browser** (headless pointer-lock injects spurious yaw).

Only the **local human's movement** is server-authoritative in 6.3. Bots and round rules are
still client-side (they go server-side in 6.5/6.6) — ignore them for this script.

- **Build:**
  1. Start the server: `cargo run -p server` (listens on `ws://127.0.0.1:9876`).
     *If the port is taken (e.g. Blender MCP), run `SERVER_BIND=127.0.0.1:9877 cargo run -p server`
     and use that port in the URL below.*
  2. Start the client: `pnpm dev`, then open the printed URL with `?connect=ws://127.0.0.1:9876`
     appended (e.g. `http://localhost:5173/?connect=ws://127.0.0.1:9876`).
- **Tester:** _____________  **Date:** __________  **Commit:** __________  **Result:** ⬜

## Steps

1. **Connect.** Load the URL with `?connect=`. The browser console prints
   `[net] connected as slot 0`. The server terminal prints `slot 0 joined`.
   - [ ] Pass

2. **Movement is smooth.** Walk forward/back/strafe with WASD. Motion is fluid — no stutter,
   no snapping back a few frames after each step. (Your input is predicted locally and confirmed
   by the server; if reconciliation is working, you never see the correction.)
   - [ ] Pass

3. **Feel is unchanged.** Bhop/air-strafe and counter-strafe feel exactly as in single-player
   (ACC-007). The server runs the *same* movement binary, so this must match.
   - [ ] Pass

4. **No rubber-band on stop.** Sprint into a wall and stop. You do not get yanked backward or
   teleported — you decelerate and stop where you expected.
   - [ ] Pass

5. **Authority survives a reconnect.** Reload the page. The server prints `slot 0 left` then
   `slot 0 joined`; you respawn and can move again.
   - [ ] Pass

6. **Single-player still works.** Open the client with **no** `?connect=`. You play offline
   exactly as before (no console net logs, movement local).
   - [ ] Pass

## If a step fails twice for the same reason

Migrate it down to a T1 test (`tests/harness/server.test.ts` or `src/net/prediction.test.ts`)
per the DoD, rather than re-running the manual script.
