# Connect UI + Tab Scoreboard (Phase 6.7)

Two plain-DOM overlays, per the "no React for a crosshair" rule (CLAUDE.md). Nothing here
is netcode mechanics — it's the join surface and the K/D readout. The connection transport
(`src/net/connection.ts`, `Welcome` decode) already exists from 6.0.

## Scope

1. **Connect overlay** — a text input prefilled with the default server URL, a Connect button,
   and a status line. Shown on load, hidden once connected.
2. **Scoreboard** — held-Tab shows a two-column (T | CT) table of players with kills/deaths,
   3 per side by default.

Depends on 6.6: per-player K/D accumulates from the `kill(slot, by)` snapshot events. Until
those decode, the board renders zeros — the UI is still "done" and demoable against a default
roster.

## 1. Connect overlay — `src/ui/connect.ts`

- One `<input>` prefilled with the default `ws://127.0.0.1:9876` (mirrors the server `BIND` in
  `server/src/main.rs`). Constant lives in `src/net/connection.ts` as `DEFAULT_WS_URL`, imported
  both places — single source of truth.
- Connect button calls `connection.connect(input.value)`.
- Status line is bound to `connection.state`: `connecting…` / `error.reason` / hidden on
  `connected`.
- Visibility: mounted visible on load; hide when `state.status === 'connected'`; re-show on
  `disconnected` / `error`. Polled in the existing loop (no new event bus).
- Single-player path untouched — the overlay is only wired when the client is in server mode.

~40 lines. No router, no menu framework, no settings persistence (`no localStorage`, CLAUDE.md).

## 2. Scoreboard — `src/ui/scoreboard.ts`

Data model (plain object, no class):

```ts
interface PlayerScore {
  slot: number;
  team: 'T' | 'CT';
  name: string;
  kills: number;
  deaths: number;
}
```

- **Default roster:** 6 entries, `team = slot < 3 ? 'T' : 'CT'`, names `"Bot 1".."Bot 6"`.
  This is what makes it 3v3 on screen without any server change.
- **Render:** pure `render(el: HTMLElement, players: PlayerScore[])` — two columns, 3 rows each,
  sorted by kills descending. Idempotent; called whenever the roster changes.
- **Hold-to-show:** `keydown Tab` → show + `preventDefault()`; `keyup Tab` → hide. CS behaviour.

## 3. K/D feed

- **Multiplayer (Phase 21): server-authoritative.** Each `Slot` on the server owns a `kills`/`deaths`
  tally; the kill resolver increments `victim.deaths` and `killer.kills`. Both ride every
  `Snapshot` entity (`EntityState.kills`/`deaths`), so all clients render the identical board — no
  client-side accumulation. `session.ts` builds the MP roster straight off the latest snapshot's
  entities (team from `F_TEAM_CT`, alive from `F_ALIVE`). Occupied-but-dead players are included in
  the snapshot (see `build_snapshot`) so the board shows everyone mid-respawn; truly-empty slots
  (human left, no bot yet) are excluded.
- **Single-player: tallied locally.** No server, so `session.ts` counts at the kill sites —
  `humanKills`/`humanDeaths` for the local player, `Enemy.kills`/`deaths` per bot.

## 4. Player names on the wire (Phase 21)

- The player picks a handle in the Multi-player popup (prefilled with the signed-in display name,
  editable, ≤24 chars). It rides the `?name=` param across the connect reload, then goes out in the
  `Join` message (`Join.name`, alongside the auth token).
- The server stores it as `Slot.display_name` (falling back to the JWT name, then `"player"`) and
  sends it in every `Snapshot` entity (`EntityState.name`). An empty name = a bot; the client
  renders `"Bot N"`. `Join` and `EntityState` changed in lockstep in `src/net/protocol.ts` **and**
  `sim/src/protocol.rs` — the on-the-wire contract.

## Definition of Done (HUD / UI rows from CLAUDE.md)

- [ ] **T0:** `scoreboard.render()` with a known roster → 6 rows, correct columns, sorted by
      kills desc. (The only non-trivial logic; one vitest.)
- [ ] **T2:** overlays are DOM only — no draw calls, no scene/asset budget impact. Assert no new
      `renderer.info.render.calls`.
- [ ] **T3:** `tests/acceptance/ACC-011-connect-scoreboard.md`, written before tuning: page loads
      to the connect overlay → default URL connects → overlay hides → hold Tab shows 3v3 with
      names and K/D → release hides it.
- [ ] `pnpm typecheck` green, no new `any`.

## Deferred (named, not forgotten)

- Names on the wire — `ponytail:` default to `"Bot N"`; add the protocol field when the demo
  goes public.
- Reconnect / server browser / multiple saved servers — one default URL is enough for the demo.
- Spectator-mode scoreboard styling — same table, no special-casing until it's needed.
