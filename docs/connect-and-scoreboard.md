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

- Kills accumulate **client-side** from `Snapshot.events`: `kill(slot, by)` → `players[by].kills++`,
  `players[slot].deaths++`. No new wire field for K/D.
- The accumulator is fed where snapshots are decoded (6.6). Before that exists, the roster is the
  static default and the board reads zeros — acceptable, flagged, not blocking.

## 4. Known wire-format gaps (not this phase)

| Gap | Why deferred |
|---|---|
| **Player names on the wire** | `Welcome`/`Snapshot` carry no name field. Default to `"Bot N"`. Real names need a field added to `src/net/protocol.ts` **and** `sim/src/protocol.rs` in lockstep — a protocol change, not UI. |
| **Genuine 3v3 server** | The stub server sends `SPECTATOR` and holds no slots. Real 3v3 = server-side `MAX_PLAYERS = 6` + team split in the slot manager (6.4). The board renders whatever roster it's handed; the default roster fakes 3v3 for the demo. |

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
