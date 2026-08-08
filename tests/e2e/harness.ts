/**
 * Shared harness for websocket end-to-end tests against the Rust deathmatch
 * server. These tests spawn the real `target/debug/server` binary, connect over
 * a WebSocket, and assert on the wire protocol — so they exercise the whole
 * server-authoritative loop (round FSM, slot/bot roster, capacity gates) the way
 * a real client does.
 *
 * They are kept OUT of the default `pnpm test` unit pool (see `vitest.e2e.config.ts`)
 * because a single server thread starves under 35-way parallel unit load and the
 * wall-clock round timing flakes. Run them isolated with `pnpm test:e2e`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { decodeWelcome, encodeJoin, TAG_WELCOME, type Welcome } from '../../src/net/protocol';

/** Message tag byte (TAG_WELCOME / TAG_SNAP / TAG_BYE / …). */
export function tagOf(bytes: Uint8Array): number {
  return bytes[0] ?? -1;
}

// `.exe` on Windows, or existsSync() misses the binary and every suite silently
// skipIf()s itself — which is exactly how the e2e suite went unnoticed-red.
export const SERVER_BIN = resolve(
  import.meta.dirname,
  `../../target/debug/server${process.platform === 'win32' ? '.exe' : ''}`,
);
/** True when the Rust server has been built; e2e tests `skipIf` this is false. */
export const SERVER_BUILT = existsSync(SERVER_BIN);

/**
 * Point the e2e suite at an already-running server instead of spawning the local
 * `target/debug/server`. Set `E2E_SERVER_URL` (e.g. `ws://localhost:9876`) to run
 * against a dockerized dev server:
 *
 *   docker compose -f docker-compose.e2e.yml up -d --build
 *   E2E_SERVER_URL=ws://localhost:9876 pnpm test:e2e
 *
 * The e2e compose starts the server with the same fast-round env as a local
 * spawn (see FAST_ROUND_ENV / docker-compose.e2e.yml) so timing-sensitive tests
 * behave identically. Per-test `env` passed to startServer() cannot be injected
 * into a running container, so if you point at some OTHER server, start it with
 * those knobs yourself.
 */
export const EXTERNAL_SERVER_URL: string | null = process.env.E2E_SERVER_URL ?? null;
export const EXTERNAL = EXTERNAL_SERVER_URL !== null;

/** True when e2e can run: the binary is built, or we target an external server. */
export const SERVER_AVAILABLE = SERVER_BUILT || EXTERNAL;

/** WS URL for a test: the external dev server if configured, else the local bind. */
export function serverUrl(bind: string): string {
  return EXTERNAL_SERVER_URL ?? `ws://${bind}`;
}

export const SPECTATOR_SLOT = 255;

/** Fast-round env so a full freeze→live→over→reset cycle takes ~11 s, not ~2 min. */
export const FAST_ROUND_ENV = {
  SERVER_FREEZE_MS: '500',
  SERVER_ROUND_MS: '10000',
  SERVER_END_MS: '500',
} as const;

/**
 * Spawn the server on `bind`, resolving once it logs "listening". Returns the
 * child process; call `.kill()` in `afterAll`. Each test file uses its own port
 * so files never collide (they also run one-at-a-time under the e2e config).
 */
export async function startServer(bind: string, env: Record<string, string> = {}): Promise<ChildProcess | null> {
  // External mode: the server is already running (docker compose up -d) — nothing
  // to spawn or tear down. Tests connect via serverUrl() instead of ws://bind.
  if (EXTERNAL) return null;
  const proc = spawn(SERVER_BIN, [], {
    stdio: 'pipe',
    env: { ...process.env, SERVER_BIND: bind, ...FAST_ROUND_ENV, ...env },
  });
  await new Promise<void>((res, rej) => {
    const timeout = setTimeout(() => rej(new Error('server start timeout')), 10000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timeout);
        res();
      }
    });
    proc.on('error', (e) => {
      clearTimeout(timeout);
      rej(e);
    });
    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        rej(new Error(`server exited with code ${code}`));
      }
    });
  });
  return proc;
}

/** A connected websocket plus a listener queue so tests can await messages. */
export interface Client {
  ws: WebSocket;
  /** Resolves with the next raw message, or rejects after `ms`. */
  next(ms?: number): Promise<Uint8Array>;
  /** Close the socket. Resolves once it has actually closed — await it when the
   *  next assertion depends on the server having freed the slot, or capacity
   *  tests race their own leftovers. */
  close(): Promise<void>;
}

/** Open a websocket to `url` and wrap it with a promise-based message queue. */
export async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const queue: Uint8Array[] = [];
  const waiters: ((m: Uint8Array) => void)[] = [];
  // Attach the message handler BEFORE awaiting 'open'. A fast server (localhost /
  // docker) sends the connect-Welcome in the same TCP segment as the handshake,
  // so `ws` emits 'open' then 'message' synchronously — registering the listener
  // after the open await would drop that first message and hang the next() for it.
  ws.on('message', (raw: Buffer) => {
    const bytes = new Uint8Array(raw);
    const w = waiters.shift();
    if (w) w(bytes);
    else queue.push(bytes);
  });
  await new Promise<void>((res, rej) => {
    ws.on('open', () => res());
    ws.on('error', rej);
  });
  return {
    ws,
    next(ms = 5000): Promise<Uint8Array> {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise<Uint8Array>((res, rej) => {
        const timeout = setTimeout(() => rej(new Error('message timeout')), ms);
        waiters.push((m) => {
          clearTimeout(timeout);
          res(m);
        });
      });
    },
    close(): Promise<void> {
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      const closed = new Promise<void>((res) => ws.once('close', () => res()));
      ws.close();
      return closed;
    },
  };
}

export interface JoinResult {
  /** The initial SPECTATOR Welcome the server sends on connect. */
  connectWelcome: Welcome;
  /** Second Welcome if a player slot was assigned; null when spectating. */
  welcome: Welcome | null;
  /** True when the client ended up a spectator (team 2, team full, or refused). */
  spectator: boolean;
}

/**
 * Run the Phase 9 two-phase join: read the SPECTATOR Welcome, send `Join{team}`
 * (0=T, 1=CT, 2=Spectate), then read what comes back. A player slot yields a
 * second Welcome; spectating (explicit, team-full, or refused) yields no Welcome —
 * the server just starts streaming snapshots — so we detect it by the next
 * message NOT being a Welcome.
 */
export async function joinTeam(client: Client, team: number): Promise<JoinResult> {
  // 15 s, not the 5 s default: Join is serviced by the 64 Hz game loop, which with
  // a full 10-bot roster and a dozen concurrent test clients can take seconds to
  // get to it. A short timeout here just turns load into a spurious failure.
  const connectWelcome = decodeWelcome(await client.next(15000));
  if (!connectWelcome) throw new Error('no initial Welcome');
  client.ws.send(Buffer.from(encodeJoin({ team })));
  const next = await client.next(15000);
  if (tagOf(next) === TAG_WELCOME) {
    const welcome = decodeWelcome(next);
    if (welcome && welcome.yourSlot !== SPECTATOR_SLOT) {
      return { connectWelcome, welcome, spectator: false };
    }
  }
  return { connectWelcome, welcome: null, spectator: true };
}
