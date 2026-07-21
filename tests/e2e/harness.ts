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

export const SERVER_BIN = resolve(import.meta.dirname, '../../target/debug/server');
/** True when the Rust server has been built; e2e tests `skipIf` this is false. */
export const SERVER_BUILT = existsSync(SERVER_BIN);

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
export async function startServer(bind: string, env: Record<string, string> = {}): Promise<ChildProcess> {
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
  close(): void;
}

/** Open a websocket to `url` and wrap it with a promise-based message queue. */
export async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  await new Promise<void>((res, rej) => {
    ws.on('open', () => res());
    ws.on('error', rej);
  });
  const queue: Uint8Array[] = [];
  const waiters: ((m: Uint8Array) => void)[] = [];
  ws.on('message', (raw: Buffer) => {
    const bytes = new Uint8Array(raw);
    const w = waiters.shift();
    if (w) w(bytes);
    else queue.push(bytes);
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
    close(): void {
      ws.close();
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
  const connectWelcome = decodeWelcome(await client.next());
  if (!connectWelcome) throw new Error('no initial Welcome');
  client.ws.send(Buffer.from(encodeJoin({ team })));
  const next = await client.next();
  if (tagOf(next) === TAG_WELCOME) {
    const welcome = decodeWelcome(next);
    if (welcome && welcome.yourSlot !== SPECTATOR_SLOT) {
      return { connectWelcome, welcome, spectator: false };
    }
  }
  return { connectWelcome, welcome: null, spectator: true };
}
