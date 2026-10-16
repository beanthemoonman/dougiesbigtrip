# AGENTS.md — server/

Supplements the root `AGENTS.md`; read that first. This covers only what is specific to `server/`.

## What this is

The authoritative deathmatch server: a Rust binary (`server`, edition 2024, tokio) that links the
`sim` crate **natively** — the same movement/hitbox/damage/bot code the client runs as WASM. One
64 Hz game-loop task owns the `SimWorld` and the slot table (10 slots, 5 T + 5 CT, bots fill empty
ones; up to 4 spectators). Clients speak the binary protocol in `sim/src/protocol.rs` over
WebSocket; the server broadcasts a full `Snapshot` every tick.

## Layout

| File | Responsibility |
|---|---|
| `src/main.rs` | Env config (`build_config` / pure `validate_config`), DB bootstrap + migrations, `game_loop` (tick, bots via `sim::ai::tick_bot`, hitscan via `sim::shapecast::ray_cast` + `sim::hitbox::hitbox_ray` + `sim::damage::compute_damage`, `build_snapshot`), `handle_conn` (WS read/write tasks, plus a raw `GET /status` peek on the game port). |
| `src/game.rs` | Round FSM: freezetime → live → over → reset, winner decision. Pure, ticked at `FIXED_DT`. |
| `src/auth.rs` | Keycloak JWT validation (JWKS cached 15 min, `iss`/`aud`/`exp`), `AuthConfig::from_env`. Bypassed entirely when `AUTH_REQUIRED` is false. |
| `src/http.rs` | axum admin API on `API_BIND`: `GET/PUT /api/config` (admin-gated), `GET /status`. |
| `src/db.rs` | Runtime `sqlx::query` calls (no compile-time `query!` macros): load/insert/update `app.server_config`, upsert `app.users`. |
| `migrations/` | sqlx migrations, embedded at compile time by `sqlx::migrate!("./migrations")`. `001_initial.sql` creates schema `app`. |

## Commands

```bash
cargo build -p server                 # debug binary: target/debug/server(.exe) at the workspace root
cargo run -p server                   # ws://127.0.0.1:9876, admin API 127.0.0.1:9877, no DB
cargo test -p server                  # inline unit tests (config, auth, round FSM, http gate, bot enemy filter)
pnpm test:e2e                         # real-server WS suites in tests/e2e/ (needs the binary above)
docker build -f Dockerfile.server -t dougys-server .   # context MUST be repo root (needs sim/ + assets/maps/)
```

CI does not build or test the server. Run `cargo test -p server` and the e2e suite yourself.
If e2e reports green with zero tests, the binary was not found — see `tests/e2e/README.md`.

## Configuration (env)

`SERVER_BIND` (default `127.0.0.1:9876`; the Docker image sets `0.0.0.0:9876`), `API_BIND`
(`127.0.0.1:9877`), `BOT_COUNT` (10, valid 2–10), `ROUNDS_TO_WIN` (16, valid 1–30), `MAP` (only
`de_douglas`), `SERVER_FREEZE_MS` / `SERVER_ROUND_MS` / `SERVER_END_MS` (3000 / 115000 / 5000;
e2e shortens them), `DATABASE_URL` (optional), `AUTH_REQUIRED`, `AUTH_ISSUER`, `KC_HOSTNAME`,
`AUTH_JWKS_URL`, `AUTH_AUDIENCE`. Invalid config exits at startup.

## Invariants & gotchas

- **Simulation belongs in `sim/`, not here.** Anything the client must predict or replay
  (movement, hitboxes, damage, bot decisions, nav) goes in the sim crate so both ends run the
  same code. The server only orchestrates: slots, rounds, hit resolution, networking, persistence.
- **Determinism.** Wall-clock is only the tokio `interval(FIXED_DT)` driving the tick; inside a
  tick use tick counts and the fixed `SEED` (sent to clients in `Welcome`), never `Instant`/rand.
- **Wire format changes span three places:** `sim/src/protocol.rs`, `src/net/protocol.ts`, and
  the call sites here. Keep `PROTOCOL_VERSION` in sync.
- **Constants mirrored from the client** (e.g. `DUCKED_SCALE = 0.9144 / 1.8288`, `MAX_SLOTS`
  vs. client `LIMITS.botCount`) must match the TS side or hitboxes/rosters disagree.
- **Map/nav are compiled in** via `include_str!` (`main.rs`) and through `sim`. After editing
  `assets/maps/*` or re-running `pnpm nav:bake`, rebuild the server.
- **DB is optional.** No `DATABASE_URL` → env-only config. Unreachable DB → warn and continue.
  Reachable DB with a failed migration → exit(1). Existing migrations are immutable; add
  `00N_*.sql` instead of editing applied ones.
- **Admin API is open** (no token) only when `AUTH_REQUIRED=false` **and** `API_BIND` is loopback.
  Don't widen the default `API_BIND`.
- **Don't hold the shared config `RwLock` across awaits** (e.g. JWKS fetch): it is
  write-preferring and stalls the game loop (see `http.rs::require_admin`).
- **Lag compensation is not implemented.** Hit reg uses current-tick positions, despite
  `docs/netcode.md` §5.4/§6 describing a rewind buffer. That doc's §6 file tree (`loop.rs`,
  `net/`, `game/lagcomp.rs`…) is the original plan, not the current layout.

## Related docs

`docs/netcode.md`, `docs/deploy.md` (compose, Postgres, Keycloak), `docs/connect-and-scoreboard.md`,
`docs/plan-post-1.0-config-auth.md` (auth/config phases 17–20), `tests/e2e/README.md`.
