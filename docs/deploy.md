# Containerized Deploy (Phase 8)

The Counter Douglas stack ships as two Docker images wired together
with `docker compose`. One command builds everything and starts the
service.

## What's in the box

| Image | What | Port |
|---|---|---|
| `dougys-server` | Rust deathmatch server (64 Hz authoritative sim, bot AI, round FSM) | 9876 |
| `dougys-client` | nginx serving the TypeScript/Vite SPA (includes the WASM sim client-side) | 8080→80 |

The SPA connects to the server via WebSocket (`ws://localhost:9876` by
default — type this in the Connect overlay).

## Quick start

```bash
docker compose up --build
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

The server binds on `SERVER_BIND` (default `0.0.0.0:9876`). Override it:

```bash
docker run -e SERVER_BIND=0.0.0.0:12345 -p 12345:12345 dougys-server
```

The map (`de_douglas.json`) is compiled into the server binary via
`include_str!` — no separate data volume is needed.

## Client configuration

The client's default connect URL is `ws://127.0.0.1:9876`
(`src/ui/connect.ts:9`). You can also start the client with a
`?connect=ws://host:port` query parameter to skip the overlay:

```
http://localhost:8080/?connect=ws://my-server:9876
```

## Budgets (production build)

- Client dist: ~9 MB uncompressed, ~7 MB wire (gzipped JS/WASM)
- WASM sim: ~280 KB (gzipped)
- Server: ~15 MB statically linked binary

## Requirements

- Docker Engine 24+ with Compose v2
- No pre-installed Rust or Node toolchain needed (Docker builds them)
