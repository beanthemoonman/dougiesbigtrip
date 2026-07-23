# Containerized Deploy (Phase 18)

The Counter Douglas stack ships as three Docker images wired together
with `docker compose`. One command builds everything and starts the
service.

## What's in the box

| Image | What | Port |
|---|---|---|
| `dougys-server` | Rust deathmatch server (64 Hz authoritative sim, bot AI, round FSM) | 9876 |
| `dougys-client` | nginx serving the TypeScript/Vite SPA (includes the WASM sim client-side) | 8080→80 |
| Postgres 16 | Database (named volume `pgdata`) — migrations run on server start | internal |

Only the nginx proxy publishes host ports. The server and database are
internal — the browser talks to the server through the proxy at `/ws`:

```
Browser ──HTTPS──► nginx (client)   :443 (or :80 for plain HTTP)
    │                   │
    └──wss://host/ws────┤  /ws → server:9876    (WebSocket)
                        │  /status → server:9876 (HTTP)
                        │  /api/   → server:9876 (admin, Phase 20)
                        │  /auth/  → Keycloak    (Phase 17.2)
```

## Quick start

```bash
# First run: copy the env template and edit it.
cp .env.example .env
# Edit POSTGRES_PASSWORD and KC_BOOTSTRAP_ADMIN_PASSWORD in .env

docker compose --env-file .env up --build
```

Open `https://localhost:8443` (accept the self-signed cert warning) or
`http://localhost:8080` for plain HTTP. The client auto-detects ws:// vs.
wss:// from the page protocol. The Connect overlay defaults to the proxy
endpoint — no manual server URL needed.

Hit **Connect**. You have a slot as soon as the server acknowledges.
Up to 6 slots (the 7th connection spectates).

## Building images individually

```bash
# Server only
docker build -f Dockerfile.server -t dougys-server .

# Client only
docker build -f Dockerfile.client -t dougys-client .
```

## Server configuration

The server binds on `SERVER_BIND` (default `0.0.0.0:9876`). Other knobs:

```bash
docker compose --env-file .env up --build
# Override env vars in the .env file or pass them inline:
DATABASE_URL=... BOT_COUNT=4 ROUNDS_TO_WIN=8 docker compose --env-file .env up
```

The map (`de_douglas.json`) is compiled into the server binary via
`include_str!` — no separate data volume is needed.

## Database

Postgres 16 runs as the `db` service, internal only (no host port). Data lives
on a named volume (`pgdata`) so it survives `docker compose down`. Credentials
are in `.env` (copy from `.env.example`).

The server applies migrations from `server/migrations/` at startup. When
`DATABASE_URL` is unset, the server starts without persistence (config from env
vars only) — this keeps `cargo run` working for local dev without Postgres.

```bash
# Reset everything (data + containers):
docker compose down -v
```

## Budgets (production build)

- Client dist: ~9 MB uncompressed, ~7 MB wire (gzipped JS/WASM)
- WASM sim: ~280 KB (gzipped)
- Server: ~15 MB statically linked binary

## Requirements

- Docker Engine 24+ with Compose v2
- No pre-installed Rust or Node toolchain needed (Docker builds them)
