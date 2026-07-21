# Phase 9 — Game flow: team select, spectator, join gating

Implementation plan for Phase 9 of `plan_to_implement.md`. Read that phase's checklist and
`docs/connect-and-scoreboard.md` (the connect overlay this builds on) first.

Today the player spawns straight into a live world. Phase 9 puts an **entry** in front of the
game: choose a side, spectate, and a full server turns you away cleanly instead of over-filling.
**If the code and this doc disagree, that's a bug in one of them — decide which, in the PR.**

> ## ⚠️ Amendment (roster & capacity) — supersedes the decisions below
>
> Two decisions in this doc were reversed after review; the shipped code follows the amendment,
> and the e2e suite (`tests/e2e/roster.e2e.ts`) is the executable spec.
>
> 1. **Capacity is 6 players + 4 spectators (10 total), not 10 + 7.** `MAX_SLOTS = 6`
>    (3 T + 3 CT, all bot-filled by default → **3v3**). `specCap = ceil(2/3 · 6) = 4`. Server full
>    ⇔ 6 human players **and** 4 spectators. Everywhere below that says "10 slots / 7 spectators /
>    11th player", read "6 / 4 / 7th".
> 2. **Join is instant; leave defers.** A joining player **replaces a bot immediately, mid-round or
>    not** (no more "queue to next `Reset`"). Conversely a player who **leaves** is replaced by a
>    bot **only at the next `Reset`** — the slot sits dead/empty until then (a bot never replaces a
>    player mid-round). The `pending_human` machinery is gone; leave sets the slot dead + botless
>    and the `Reset` block backfills a bot.
>
> Everything else in this doc (menu, spectator cam, two-phase Welcome, Gate 2 handshake refusal,
> per-round reset hygiene) stands as written.

---

## What already exists (reuse, don't rebuild)

| Piece | Where | Phase 9 use |
|---|---|---|
| Free-fly spectator cam | `src/player/spectator.ts` (`moveSpectator`, unit-tested) | The spectate camera — SP and MP, same path. No new movement code. |
| `SPECTATOR = 255` sentinel | `src/net/protocol.ts`, `sim/src/protocol.rs` | Welcome already returns it "when full"; Phase 9 makes it mean **you chose / were forced to spectate**. |
| 10-slot table, bots fill empties, human join evicts a bot | `server/src/main.rs` (`MAX_SLOTS`, `Slot`) | Player slots. Spectators are tracked **separately** (not a slot). |
| Round FSM freezetime→live→over→reset | `server/src/game.rs` (`Phase`, `tick`) | "Spawn on next round" queues against `Reset`; hygiene pass audits per-player reset. |
| Connect overlay + reachability probe | `src/ui/connect.ts`, `main.ts` `connectViaReload` | Gate 1 hangs off the existing pre-dial probe. |

---

## Decisions to lock

| Decision | Choice | Why |
|---|---|---|
| **How a side is chosen** | New client→server `Join{team}` message. On connect the server holds you **connected-but-not-playing** until `Join` arrives. | The server can't assign a side you haven't picked, and MP must be able to defer your spawn to the next round. |
| **What a spectator is** | **Not a player slot.** The server keeps a spectator list alongside the 10 slots. | Keeps `MAX_SLOTS`/bot-fill logic untouched; a spectator holds no body and evicts no bot. |
| **Capacity numbers** | `maxPlayers = MAX_SLOTS = 10`, `specCap = ceil(2/3 · maxPlayers) = 7`. Server full ⇔ all 10 slots human **and** 7 spectators. | Matches the phase spec verbatim. Single source: a `capacity.rs` const, mirrored in a TS const with a shared golden test. |
| **SP vs MP** | **Same UI + same spectator code.** A `NETWORKED` flag gates only the *queue-to-next-round* vs *spawn-now* branch and the capacity gates. | The phase says "same code path as SP" for spectate; honour it — one menu, one cam. |
| **Gate 1 (pre-dial)** | HTTP `GET /status` on the server's WS port → `{players, maxPlayers, spectators, specCap}`. Connect button refuses if full. | Reuses the port; no second listener. `handle_conn` peeks the raw TCP request line and answers `GET /status` with a plain HTTP/1.1 response (Content-Length set) before the WS upgrade. |
| **Gate 2 (handshake)** | Server sends `Bye{reason:"full"}` and closes if capacity is exceeded at accept time. | Count is authoritative; Gate 1 is advisory (stale count / direct URL / race). |

---

## Increment plan (each ends demoable; don't start N+1 until N's check passes)

### 9.0 — SP team menu + gated spawn
Nobody spawns on load. Show a **T / CT / Spectate** menu over a free-look overview camera; the
round loop does not begin until a side is picked. Pick T/CT → spawn on it, bots fill the rest,
round loop starts from freezetime.
- New `src/ui/teammenu.ts` (plain DOM, three buttons — mirror `connect.ts` style).
- `main.ts`: don't spawn the local player at boot; hold in an `overview` state driving
  `moveSpectator` on a fixed overview anchor until a choice lands.
- *Check (T3/manual):* launch → menu, nothing spawned; pick CT → spawn + freezetime clock runs.

### 9.1 — Spectate anytime (SP)
Menu key (or clicking out of the menu) drops you into spectator **regardless of round state**.
Reuse `moveSpectator`; despawn the local body if one exists.
- *Check:* mid-round, hit the menu key → free-fly spectator; reopen menu → can re-pick next round.

### 9.2 — Protocol: `Join`, capacity in `Welcome`, `Bye` reasons
Wire format changes, both ends, with the round-trip + golden-bytes tests that §3 of
`docs/netcode.md` mandates.
- `Join{ team: u8 (0=T,1=CT,2=SPEC) }` client→server.
- `Welcome` gains `{ maxPlayers, players, spectators, specCap }` (so the client can render "teams
  full → Spectate only" without a second query).
- `Bye{ reason }` string already exists (`docs/netcode.md` §3.3) — add the `"full"` reason and
  handle it client-side (surface via `connect.ts` `setError`).
- *Check (T0):* `protocol.test.ts` + `sim/src/protocol.rs` round-trip the new messages; shared
  golden-bytes test passes on both ends.

### 9.3 — MP join flow + team-full rule
On connect to a running game → team menu (driven by `Welcome` counts). Pick a side → server
**queues** you to spawn on the next `Reset`, not mid-round. Click out → spectator (9.1 path).
Both teams full → the only enabled button is Spectate.
- Server: `Join` with a playable team while a round is live → mark the slot `pending`, spawn on
  the next `RoundEvent::Reset`. `Join{SPEC}` → add to spectator list, evict no bot.
- *Check:* second browser joins a live game, waits out the round, spawns next round on its side;
  with both teams full the menu offers only Spectate.

### 9.4 — Capacity gates (both)
- Server: track `spectators.len()`; compute full = players==10 && spectators==specCap.
- **Gate 2:** at accept, if full → `Bye{"full"}` + close before assigning anything.
- **Gate 1:** add `GET /status` JSON on the WS port; the connect button (and `connectViaReload`
  probe) query it and refuse with a message if full, without opening the game socket.
- *Check:* 11th player can only spectate; once 7 spectators are connected a further connection is
  refused at **both** the button and a direct URL load.

### 9.5 — Server state hygiene + reset test
Audit that **all** round state is server-owned and every player is fully reset between rounds:
health, armour, ammo, position, velocity, view-punch, duck state — no carry-over.
- Fix any field that survives `RoundEvent::Reset` in `server/src/main.rs` / `game.rs`.
- **T1:** run two rounds through the headless server harness and assert a clean per-player reset
  (a player left at low health / off-spawn / mid-duck at round end starts the next round pristine).
- *Check:* the T1 is committed and green.

---

## Tests & Definition of Done

| Tier | What |
|---|---|
| **T0** | `Join` / extended `Welcome` / `Bye{"full"}` encode-decode round-trip, both ends; `specCap` const parity (TS ⇔ Rust). |
| **T1** | Two-round per-player reset (9.5). Slot/spectator capacity logic: fill 10 + 7 → next connect refused; a `Join{SPEC}` never evicts a bot. |
| **T2** | Unchanged budgets (< 400 draw calls, < 48 MB initial) still hold with the menu added — the team menu is DOM, near-zero cost; just confirm. |
| **T3** | `tests/acceptance/ACC-017-game-flow.md`, **written before tuning**: the exit test below, run in two browsers, PASS recorded against a commit hash. |

---

## Exit test (ACC-017)

- **SP:** launch → team menu with nothing spawned → pick CT → play; hit the menu key mid-round →
  spectating.
- **MP:** a second browser joins a running game, waits out the round, spawns next round on its
  chosen side; an 11th player can only spectate; once spectators hit the 2/3 cap (7) a further
  connection is refused at **both** the connect button and a direct URL load.

---

## Deferred (named, not forgotten)

- Team auto-balance / scramble — teams are pick-your-side for now; balance when it matters.
- Spectator POV-follow (chase a live player) — free-fly only this phase.
- A lobby/ready-up gate before round 1 — out of scope; the round starts on first pick.
</content>
</invoke>
