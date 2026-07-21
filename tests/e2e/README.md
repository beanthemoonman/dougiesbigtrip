# End-to-end tests (`tests/e2e/`)

These spawn the **real Rust server** (`target/debug/server`) and drive it over a
WebSocket, asserting on the wire protocol exactly as a browser client would. They
cover the server-authoritative loop and the Phase 9 team/bot roster rules
end-to-end — round FSM, slot/bot bookkeeping, capacity gating.

## Running

```bash
cargo build --manifest-path server/Cargo.toml   # build the server binary first
pnpm test:e2e                                    # runs tests/e2e/**/*.e2e.ts
```

If the binary is absent the suites `skipIf` themselves (so CI without a Rust
toolchain stays green). File suffix is `.e2e.ts`, **not** `.test.ts`, so the
default `pnpm test` unit pool never picks them up.

## Why a separate runner (`vitest.e2e.config.ts`)

A single server thread starves under the 35-way parallel unit pool and the
wall-clock round timing flakes (a ~40 s reset-cycle test times out). The e2e
config runs **one file at a time, one fork** (`fileParallelism: false`,
`singleFork`). Each file also binds its own port, so nothing collides.

The round clock is sped up via env (`SERVER_FREEZE_MS`/`ROUND_MS`/`END_MS` in
`harness.ts`) so a full freeze→live→over→reset cycle is ~11 s.

## Files

| File | Covers |
|---|---|
| `harness.ts` | Server spawn, a promise-queue WebSocket `Client`, two-phase `joinTeam`. |
| `server-loop.e2e.ts` | Slot-0 assignment, movement→snapshot, per-round player reset (Phase 9.5 hygiene). |
| `roster.e2e.ts` | 3v3 default, instant mid-round join, leave→bot-next-round, team-full→spectate, Welcome capacity (6 players / 4 spectators), server-full refusal. |

## Roster rules under test (Phase 9)

- Each team has **3 bots by default** (3v3, all 6 player slots bot-filled).
- A joining player **replaces a bot instantly**, mid-round or not.
- A player who leaves is replaced by a bot **only next round** — never mid-round
  (the slot sits dead/empty until the reset backfills it).
- Teams are hard-capped at 3; the 4th on a full team is forced to spectate.
- Capacity = **6 players + 4 spectators** (`specCap = ceil(2/3 · 6)`); beyond
  that the server refuses the connection with a `Bye{reason:"full"}`.

> Note: the server also exposes a `GET /status` HTTP endpoint for the pre-dial
> capacity gate, which now returns a well-formed JSON response
> (`{players,maxPlayers,spectators,specCap}`) consumable by curl/undici. The
> client still reads live capacity from the `Welcome` message, so the roster
> suite asserts capacity via the Welcome; `/status` is covered by its own e2e
> case.
