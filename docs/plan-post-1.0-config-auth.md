# Post-1.0 Plan — Phases 16–20 (Configuration, Auth, Persistence, Screens)

Detailed breakdown of `plan_to_implement.md` Phases 16–20. Each phase is split into numbered
increments; an increment is a single commit-sized unit with its own tests and its own exit check.

**Read first:** `CLAUDE.md` (Definition of Done, test tiers), `docs/testing.md`, `docs/deploy.md`.

## Where the code actually stands today (survey, 2026-07-23)

| Thing 16–20 needs | Current state | Implication |
|---|---|---|
| Round config | `src/game/round.ts` → `RoundConfig {freezetime, roundTime, endDelay}`, `DEFAULT_ROUND` | Extend this type. It is already the "typed config object" Phase 16 asks for. |
| Rounds-to-win | **Does not exist.** `RoundState.score` counts up forever; no match end. | Phase 16.1 must add match-end. This is new game logic, not plumbing. |
| SP bot count | Hardcoded 6-element `botDefs` array in `src/main.ts` (~line 878) | Make it generated from a count + spawn ring, not a literal list. |
| Map choice | `de_douglas` hardcoded (`import` URLs in `main.ts`, `include_str!` in `server/src/main.rs`) | "Multiple maps" is **out of scope** per the plan. Map stays a *validated single-value enum* — the knob exists, the list has one entry. Do not build a map loader. |
| Server knobs | `MAX_SLOTS: usize = 6`, `SEED`, consts in `server/src/main.rs` | Move to a runtime `ServerConfig` struct. `MAX_SLOTS` is used to size arrays → becomes a cap, with runtime count ≤ cap. |
| Server address (MP) | `src/ui/connect.ts` (`DEFAULT_WS_URL`, `?connect=` param) + `src/core/settings.ts` (`DEFAULT_SERVER_ADDRESS/PORT`) | Phase 16's "choose a server" is ~90 % done. Only wiring remains. |
| Server env config | `SERVER_BIND` via `std::env::var` (`main.rs:764`) | The env-var pattern is established; extend it, don't invent a config file. |
| HTTP surface on server | `GET /status` handled by peeking the TCP stream before the WS upgrade (`main.rs:631`) | This hand-rolled peek is fine for one route. Phases 18/20 need `GET/PUT /config` → **that** is when a real HTTP router (axum) earns its place. |
| Proxy | `nginx.conf` with a **commented-out** `/ws` proxy block; `docker-compose.yml` exposes server :9876 directly | Phase 17's proxy task is largely uncommenting + TLS + a Keycloak upstream. |
| Persistence | None. No DB, no ORM, no migrations. | Greenfield. |
| Auth | None. Any WS connection may join. | Greenfield. |
| Settings UI | `src/core/settings.ts` — plain-DOM panel, 3 sliders | Phase 19's Settings screen is a restructure of this, not a rewrite. |

Two consequences that change the plan's shape:

1. **Phase 16 is not pure plumbing.** Rounds-to-win is genuinely missing, so 16 carries a real
   gameplay increment (T0 + T1 tests, per the DoD table for "Movement/round math").
2. **Phase 20 is nearly free if Phase 18 is done right.** Admin screen = one form over the
   `/config` endpoint. Cost is concentrated in 17 and 18.

---

## Cross-cutting decisions (make these once, here)

- **No new frontend framework.** `CLAUDE.md` says plain DOM. Screens in Phase 19 are DOM
  builders in `src/ui/`, same style as `connect.ts` / `teammenu.ts`.
- **DB: PostgreSQL 16, one instance, two schemas** (`app`, `keycloak`). Keycloak needs Postgres
  anyway; running a second store for three tables is waste.
- **DB access: `sqlx` with `query!` macros + plain `.sql` migration files.** No ORM, no Diesel
  schema codegen. Three tables do not justify it.
- **Config source of truth ordering:** compiled defaults → env vars → DB row (once Phase 18
  lands). Later wins. The DB row is written only by admins.
- **Token validation: verify the Keycloak JWT signature locally against the realm JWKS.** No
  introspection round-trip per connect. Cache the JWKS, refetch on unknown `kid`.
- **Auth is server-enforced only.** The client hiding the admin button is cosmetic; every
  admin-scoped endpoint re-checks `role_admin` from the token. Stated explicitly because it is
  the one thing in 17–20 that is a security boundary, not a convenience.
- **Local dev must keep working without the stack.** `pnpm dev` (single-player) and a bare
  `cargo run` server must not require Keycloak or Postgres. Gate both behind
  `AUTH_REQUIRED=false` / `DATABASE_URL` being unset. Non-negotiable, or every future change
  costs a `docker compose up`.

---

# Phase 16 — Configuration (1 week)

Goal: match parameters become data, validated at every boundary, chosen locally for SP and
authoritatively by the server for MP. No new services.

### 16.1 — Match config type + rounds-to-win *(the real work)*

Extend `src/game/round.ts`:

```ts
export interface MatchConfig extends RoundConfig {
  readonly map: MapId;          // 'de_douglas' — union of one, for now
  readonly botCount: number;    // total bots, split across teams
  readonly roundsToWin: number; // match ends when a team reaches this
}
export const LIMITS = { botCount: [2, 6], roundsToWin: [1, 30] } as const;
```

`botCount` ceilings at **6**: that is `MAX_SLOTS`, the server's compile-time slot array
(`server/src/main.rs`). A higher client-side ceiling only produces configs the server
rejects at startup. Raising it means raising `MAX_SLOTS` (and `MAX_SPECTATORS`, and giving
the server real per-slot spawn positions — it currently stacks every bot on one anchor).

`botCount` floors at **2**, not 0: the count splits `floor(n/2)` CT / rest T, so at 0 or 1
one team starts empty and `decideWinner` ends the round on its first tick — the match would
burn through `roundsToWin` in a second. Two is the smallest count that fills both sides.

- [ ] `validateMatchConfig(partial): MatchConfig` — clamps/rejects out-of-bounds, returns
      `{ok, value}` or `{ok:false, errors}`. Single function, used by SP, server, and (later)
      the admin endpoint. One implementation, three callers.
- [ ] `RoundState` gains `matchOver: boolean` + `matchWinner: 'T'|'CT'|null`; `tickRound`
      returns a new `'match-over'` event when a side's score hits `roundsToWin`.
- [ ] Match-over behaviour: show the result, then reset scores and start a fresh match after
      `endDelay` (matches the existing 5 s restart behaviour from Phase 13).

**Tests (T0 + T1, written first):**
- `round.test.ts`: score reaching `roundsToWin` emits `match-over` exactly once; a match that
  ends resets `score` and `round`; validator rejects `botCount: 99`, `roundsToWin: 0`, unknown
  map, and non-integers.
- T1: a committed trace in `tests/traces/` driving a 2-round-to-win match to completion; the
  snapshot sequence is identical across two seeded runs.
- Golden values derive from this doc's `LIMITS`, not from code output.

**Exit:** `pnpm test` green; a 2-round match ends and restarts in-game.

### 16.2 — SP reads config at match start

- [ ] Replace the literal `botDefs` array in `src/main.ts` with
      `spawnRing(team, count, origin)` — derives N spawn points per side from the existing
      CT/T spawn anchors. Same six positions at `botCount: 6`, so nothing regresses.
- [ ] Match start takes a `MatchConfig`; bot count, rounds-to-win, and (nominally) map flow from it.
- [ ] Temporary selection surface: extend the existing settings panel with a "New match"
      section (bot count, rounds-to-win). Phase 19 replaces this with the real entry screen —
      mark it `// ponytail: placeholder UI, superseded by Phase 19 entry screen`.

**Tests:** T2 — spawning N bots keeps `renderer.info.render.calls < 400` at `botCount` max.
T3 — a step added to a new `ACC-022-configuration.md`.

**Exit:** start SP with 2 bots / 3 rounds-to-win and with 10 bots / 16, both honoured.

### 16.3 — Server-side config

- [ ] `ServerConfig` struct in `server/src/`, built from compiled defaults ← env vars
      (`BOT_COUNT`, `ROUNDS_TO_WIN`, `MAP`, existing `SERVER_BIND`). Validated with the same
      bounds as 16.1 (duplicated in Rust — two languages, one spec doc; a shared WASM validator
      is not worth the build complexity for four fields).
- [ ] `MAX_SLOTS` becomes a compile-time **capacity** (arrays sized by it); the runtime roster
      size comes from config and must be ≤ it. Reject a config that exceeds capacity at startup
      with a clear error, not a panic at slot-assign time.
- [ ] `GET /status` reports the effective config (so a client can display it pre-join).
- [ ] Server sends the effective `roundsToWin` in the `Welcome` frame; the client displays the
      server's value rather than its local one. (Phase 6's lesson, per commit `8070065`: round
      state is derived from the server, never the local FSM.)

**Tests:** Rust unit tests for the env→config→validate path (including rejection cases); a
`tests/e2e/` case asserting `Welcome.roundsToWin` matches the server's env-configured value.

### 16.4 — MP client targets a chosen server

- [ ] Connect overlay ↔ `Settings` reconciled: one source of the default address
      (`src/core/settings.ts`), `connect.ts` reads it. Currently both declare defaults.
- [ ] `?connect=` URL param keeps working; validate the URL scheme (`ws:`/`wss:` only) before use.

**Phase 16 exit test (ACC-022):** SP matches with differing bot counts and rounds-to-win behave
as configured; an MP client pointed at a server started with `BOT_COUNT=4 ROUNDS_TO_WIN=3`
observes 4 bots and a match ending at 3.

---

# Phase 17 — Auth (1 week)

Google login brokered through Keycloak. **Ships as a pair with Phase 18** — Keycloak cannot start
without its database, so do 18.1 (Postgres up) before 17.2.

**Compose delta.** The stack today is two services, `server` and `client` (plus the nginx image
inside `client`). Phases 17–18 take it to four: `+ auth` (Keycloak, here) and `+ db` (Postgres,
18.1). Both are new containers to write, not existing ones to configure, and the host-port
surface shrinks to the proxy alone. Every task below that says "service in compose" means an
edit to `docker-compose.yml` in this repo.

### 17.1 — Reverse proxy + TLS

- [ ] Promote nginx from "serves the SPA" to the single ingress: `/` → client, `/ws` → server
      (uncomment the existing block), `/auth/` → Keycloak, `/api/` → server HTTP.
- [ ] TLS termination. Local dev: a self-signed cert baked into the compose stack, with an
      `http`-only override for people who don't want it. Prod: whatever certs the deploy target
      supplies, mounted in.
- [ ] Server and Keycloak stop publishing host ports (`expose:` only). Only the proxy is reachable.
- [ ] Client default WS URL becomes same-origin `wss://<host>/ws` when served over HTTPS.
      Keep the manual override for direct-connect dev.
- [ ] Update `docs/deploy.md` and the `docker-compose.yml` header comment (both currently
      document the direct-to-:9876 flow).

**Test (T2/e2e):** a scripted `curl`/Playwright check that all four routes answer through the
proxy and that :9876 is not reachable from the host.

### 17.2 — Keycloak service + Google broker

- [ ] **New `auth` container** in `docker-compose.yml`: official Keycloak image, `expose:` only,
      `depends_on: db: {condition: service_healthy}`, `KC_DB=postgres` pointed at the 18.1 `db`
      service, realm-export JSON mounted read-only, behind `/auth/`. Start-up mode matters —
      `start-dev` locally, `start --optimized` in the prod override; the dev mode disables
      hostname/HTTPS checks that prod must keep.
- [ ] Realm `counter-douglas` provisioned from a **committed realm-export JSON** imported at
      startup — not hand-clicked in the admin console. Contains: the public client for the SPA,
      the `role_admin` realm role, and the Google identity-provider stub.
- [ ] Google OAuth client id/secret injected by env, never committed. Document obtaining them in
      `docs/deploy.md`; the realm import references `${GOOGLE_CLIENT_ID}` style placeholders.
- [ ] `role_admin` mapped into the token (realm-roles claim) and granted manually to the first
      admin — no self-service admin grant, ever.

### 17.3 — Client login flow

- [ ] Authorization Code + PKCE against Keycloak, public client, no secret in the browser.
      Use `keycloak-js` (the official adapter) rather than hand-rolling PKCE — this is the one
      place a dependency beats fifty lines, because the failure mode is a security hole.
- [ ] Token held in memory only. `CLAUDE.md` forbids assuming web storage; that constraint
      happens to be the safer choice here too. Session survival across reload = a silent
      re-auth against Keycloak, not a stored token.
- [ ] Expose `auth.name`, `auth.sub`, `auth.isAdmin`, `auth.token()` for Phases 19–20.

### 17.4 — Server-side token validation *(the security boundary)*

- [ ] Client sends the access token in the `Join` message (or the WS subprotocol header —
      whichever the existing handshake accommodates with the smaller diff).
- [ ] Server verifies **signature, `exp`, `iss`, and `aud`** against the cached realm JWKS.
      Rejecting on signature alone is not enough; all four or it is not validation.
- [ ] Unauthenticated / invalid-token connections are closed with a distinct close code the
      client can surface ("session expired — sign in again").
- [ ] `role_admin` read from the verified claims. **Never** from anything the client asserts.
- [ ] `AUTH_REQUIRED=false` (default in dev) skips validation and treats every connection as an
      anonymous non-admin. Prod compose sets it `true`. One env var, one branch, at the single
      entry point — not a pluggable auth-provider abstraction.

**Tests:** Rust unit tests over the validator with fixture tokens — valid, expired, wrong
issuer, wrong audience, bad signature, missing role, present role. These are cheap, fast, and
the only thing standing between the game and an unauthenticated admin. An e2e case: a connect
with no token is refused when `AUTH_REQUIRED=true`.

**Exit test:** fresh Google sign-in lands authenticated; a `role_admin` user is recognised
server-side and a non-admin is not — asserted from server logs/API, not from UI state.

---

# Phase 18 — Persistence (½–1 week)

### 18.1 — Postgres + migrations *(do this before 17.2)*

- [ ] **New `db` container** in `docker-compose.yml`: Postgres image, `expose:` only (not
      host-published), credentials from env/`.env`, and a `pg_isready` health check — `auth` and
      `server` both gate their start on it, and Keycloak crash-loops against a Postgres that is
      accepting connections but not yet ready.
- [ ] **Named volume** for `/var/lib/postgresql/data`. Anonymous or bind-mounted and the realm,
      every user row, and the persisted server config die with the container. This volume is the
      only stateful thing in the stack; `docs/deploy.md` gets a line on backing it up.
- [ ] Two schemas: `keycloak` (owned by Keycloak) and `app` (ours). Separate DB users; the app
      user has no rights on the Keycloak schema.
- [ ] `server/migrations/*.sql`, applied on server start via `sqlx::migrate!`. Forward-only.

Schema — the whole of it:

```sql
create table app.users (
  sub         text primary key,          -- Keycloak subject
  display_name text not null,
  email       text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create table app.server_config (
  id           int primary key default 1 check (id = 1),  -- single row
  bot_count    int  not null,
  map          text not null,
  rounds_to_win int not null,
  updated_at   timestamptz not null default now(),
  updated_by   text references app.users(sub)
);
```

`check (id = 1)` is the lazy way to get "exactly one config row" enforced by the database rather
than by application code that must remember.

### 18.2 — Config load/save

- [ ] On start: run migrations, read `app.server_config`; if absent, insert the env/default
      config. DB value wins over env from then on.
- [ ] The loaded config passes through the **same validator** from 16.3 — a bad row in the DB
      must not be more trusted than a bad env var.
- [ ] `DATABASE_URL` unset → skip the DB entirely, use env config, log it once. Keeps bare
      `cargo run` working.

### 18.3 — Users upsert

- [ ] On successful authenticated connect: `insert … on conflict (sub) do update set
      display_name, email, last_seen`. One statement, no read-then-write race.

**Exit test:** `docker compose down && up` — server config survives, a returning user's row
shows an updated `last_seen`, Keycloak sessions/realm persist.

---

# Phase 19 — Entry & Settings screens (1 week)

Plain DOM, `src/ui/`, same idiom as `connect.ts`. One shared "screen" helper (show/hide + a
container) — that is the only abstraction this phase gets.

### 19.1 — Screen shell + routing

- [ ] `src/ui/screens.ts`: a tiny state machine over `entry | settings | admin | in-game`, driven
      by explicit calls. No router library, no history API. It is four states.
- [ ] Pointer-lock/input is released when any screen is visible and restored on return.

### 19.2 — Entry screen

- [ ] Title **"Counter Douglas"**.
- [ ] Top-right `Hello, {name} ▾` → Settings, Logout (and Admin when `auth.isAdmin`, added in 20).
      Name comes from the verified token claims; falls back to "Guest" when `AUTH_REQUIRED=false`.
- [ ] **Singleplayer** → the 16.2 config form → starts the SP match.
- [ ] **Multi-player** → the 16.4 server-address flow → connect.
- [ ] Delete the 16.2 placeholder settings-panel section in this increment; it exists only to be
      replaced.

### 19.3 — Settings screen

- [ ] Left-nav: **Graphics**, **Game**, **Bindings**.
- [ ] Graphics: FOV (from the existing `Settings`), plus whatever render toggles already exist.
- [ ] Game: sensitivity, volume (existing).
- [ ] Bindings: read out the current key map and allow rebinding via `src/core/input.ts`. If
      input has no remap support today, this increment adds a binding table there — scope it
      before committing to the week.

**Tests:** T0 over the screen state machine and the config form's validation wiring (it must
call the 16.1 validator, not re-check bounds itself). T3 `ACC-023-screens.md`.

---

# Phase 20 — Admin screen (½ week)

### 20.1 — Config API

- [ ] `GET /api/config` (any authenticated user — the client shows the server's settings) and
      `PUT /api/config` (**`role_admin` only**, checked from the verified token).
- [ ] `PUT` validates via the 16.1/16.3 validator, writes `app.server_config`, sets `updated_by`,
      and applies the new config **at the next match boundary**, not mid-round.
- [ ] This is where the server grows a real HTTP router (axum) and the hand-rolled `GET /status`
      peek in `main.rs:631` folds into it. Two routes justify it; one did not.

### 20.2 — Admin screen

- [ ] Form over the three knobs; loads from `GET`, saves via `PUT`, shows the server's rejection
      messages rather than duplicating validation logic client-side.
- [ ] Entry-screen menu item appears only when `auth.isAdmin`.
- [ ] **Test that a non-admin's `PUT` is refused by the server** with the client's own hiding
      disabled. The hidden button is not the control; the 403 is.

**Exit test:** an admin changes bot count / rounds-to-win, it persists across a restart and takes
effect next match; a non-admin gets no menu item and a 403 on a direct `PUT`.

---

## Sequencing

```
16.1 → 16.2 → 16.3 → 16.4        (independent, ship first)
18.1 → 17.1 → 17.2 → 17.3 → 17.4 → 18.2 → 18.3
                                    ↓
                                  19.1 → 19.2 → 19.3
                                    ↓
                                  20.1 → 20.2
```

18.1 leads because Keycloak needs the database. Everything in 19 needs 17.3 for the user's name;
everything in 20 needs 17.4 for the role and 18.2 for durability.

## Risks specific to 16–20

| Risk | Mitigation |
|---|---|
| Keycloak realm config drifts from what is committed | Realm export JSON is the source of truth, imported at start. Console changes that are not exported do not exist. |
| Auth makes local dev require the full stack | `AUTH_REQUIRED=false` + unset `DATABASE_URL` are first-class paths, tested in CI, not afterthoughts. |
| Token validation looks done but only checks the signature | Fixture-token unit tests for `exp`/`iss`/`aud`/`kid` are part of 17.4's DoD, not a follow-up. |
| Phase 19 quietly becomes a UI framework project | Plain DOM is a `CLAUDE.md` non-negotiable. One `screens.ts` helper, four states, no router. |
| Config bounds diverge between TS and Rust | `LIMITS` in this doc is the spec. If they diverge, the doc decides — and the DoD's "doc is the spec" rule applies. |
| "Multiple maps" leaks in via the map knob | Map stays a one-value validated enum until someone actually builds a second map. |

## Out of scope (still)

Buy menu / economy, bomb plant-defuse, multiple maps, matchmaking, per-user stats or
leaderboards, social features, admin actions beyond the three config knobs (no kick/ban).
