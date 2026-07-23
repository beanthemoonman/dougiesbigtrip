# Containerized Deploy (Phase 18)

The Counter Douglas stack ships as three Docker images wired together
with `docker compose`. One command builds everything and starts the
service.

## What's in the box

| Image | What | Port |
|---|---|---|
| `dougys-server` | Rust deathmatch server (64 Hz authoritative sim, bot AI, round FSM) | internal |
| `dougys-client` | nginx serving the TypeScript/Vite SPA + reverse proxy (TLS) | 8080→80, 8443→443 |
| Keycloak 26 | Auth (Google OAuth broker, JWT issuer) — `KC_DB_SCHEMA=keycloak` | internal |
| Postgres 16 | Database (named volume `pgdata`) — two schemas, `app` + `keycloak` | internal |

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
endpoint on the origin you loaded the page from (`wss://localhost:8443/ws`,
`ws://localhost:8080/ws`) — no manual server URL needed. Under `pnpm dev` the
default stays `ws://127.0.0.1:9876`, since the vite dev server proxies nothing.

Hit **Connect**. You have a slot as soon as the server acknowledges.
Up to 6 slots (the 7th connection spectates).

## TLS certificates

`Dockerfile.client` bakes a self-signed `/CN=localhost` cert into the image so
the stack has working TLS with no setup. **The private key is inside the image
layer — dev only.** For a real deployment, mount your certs over the same paths
(uncomment the `volumes` block on the `client` service in `docker-compose.yml`):

```
./certs/server.crt → /etc/nginx/certs/server.crt
./certs/server.key → /etc/nginx/certs/server.key
```

The nginx location blocks are shared between the `:80` and `:443` servers via
`nginx-locations.conf`, included by both — edit routes there, not in
`nginx.conf`.

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

## Auth (Keycloak + Google)

Keycloak 26 runs as the `auth` service, reached at `/auth/` through the proxy.
On first start it imports the committed realm
(`auth/counter-douglas-realm.json`) and creates its schema in the `db` container.

The realm defines a public OIDC client (`counter-douglas-spa`) and a Google
identity provider. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are read from
the environment (set them in `.env`).

**Obtaining Google OAuth credentials:**

1. Go to the [Google Cloud Console](https://console.cloud.google.com).
2. Create a project (or use an existing one).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
4. Application type: **Web application**.
5. Authorised redirect URI:
   ```
   https://<your-host>/auth/realms/counter-douglas/broker/google/endpoint
   ```
   (For local dev with the self-signed cert it's
   `https://localhost:8443/auth/realms/counter-douglas/broker/google/endpoint`.)
6. Copy the **Client ID** and **Client Secret** into your `.env` file.

**Granting admin (`role_admin`):**

No self-service admin grant. After the first login, an existing admin assigns
the `role_admin` realm role in the Keycloak admin console at
`/auth/admin/counter-douglas/console/`.

## Budgets (production build)

- Client dist: ~9 MB uncompressed, ~7 MB wire (gzipped JS/WASM)
- WASM sim: ~280 KB (gzipped)
- Server: ~15 MB statically linked binary

## Requirements

- Docker Engine 24+ with Compose v2
- No pre-installed Rust or Node toolchain needed (Docker builds them)
