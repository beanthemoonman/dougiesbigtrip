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

The SPA connects to the server via WebSocket (`ws://localhost:9876` by
default — type this in the Connect overlay).

## Quick start

```bash
# First run: copy the env template and edit it.
cp .env.example .env
# Edit POSTGRES_PASSWORD and KC_BOOTSTRAP_ADMIN_PASSWORD in .env

docker compose --env-file .env up --build
```

Open `http://localhost:8080`. The Connect overlay appears. Enter the
server URL:

```
ws://localhost:9876
```

Hit **Connect**. You have a slot as soon as the server acknowledges.
Up to 10 slots (the 11th connection spectates).

## Architecture

```
Browser ──HTTP──► nginx (client)     serves index.html + dist/assets/
   │                                        │
   └──WebSocket──► Rust server :9876        │  (direct, or via /ws proxy)
                                            │
                                            ▼
                                   64 Hz game loop owns the
                                   authoritative sim world.
                                   Bots fill empty slots.
```

## Single-port setup (optional)

To serve everything on port 8080 (no separate 9876):

1.  Uncomment the `/ws` location block in `nginx.conf`.
2.  In `docker-compose.yml`, replace `ports: ["9876:9876"]` on the
    server service with `expose: ["9876"]`.
3.  Rebuild and in the Connect overlay use `ws://localhost:8080/ws`.

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
