/**
 * Integration test: start the Rust deathmatch server, connect via WebSocket,
 * and verify the Phase 6.3 authoritative loop end-to-end:
 *   Welcome (slot 0 on first connect) → send CommandFrames → receive a Snapshot
 *   whose entity[0] has moved in the commanded direction.
 *
 * Runs on an isolated port via SERVER_BIND so it doesn't collide with the
 * default 9876 (which the dev environment's Blender MCP also uses).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeSnapshot, decodeWelcome, encodeCommand } from '../../src/net/protocol';

const SERVER_BIN = resolve(import.meta.dirname, '../../target/debug/server');
const BIND = '127.0.0.1:9899';
const WS_URL = `ws://${BIND}`;

// ponytail: skip in CI where the Rust server isn't built; run `cargo build` to enable.
describe.skipIf(!existsSync(SERVER_BIN))('server authoritative loop (6.3)', () => {
  let proc: ChildProcess | null = null;

  beforeAll(async () => {
    proc = spawn(SERVER_BIN, [], { stdio: 'pipe', env: { ...process.env, SERVER_BIND: BIND } });
    await new Promise<void>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error('server start timeout')), 10000);
      proc!.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('listening')) {
          clearTimeout(timeout);
          res();
        }
      });
      proc!.on('error', (e) => {
        clearTimeout(timeout);
        rej(e);
      });
      proc!.on('exit', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          rej(new Error(`server exited with code ${code}`));
        }
      });
    });
  });

  afterAll(() => {
    proc?.kill();
  });

  it('assigns slot 0 on first connect', async () => {
    const ws = new WebSocket(WS_URL);
    const data = await new Promise<Uint8Array>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error('welcome timeout')), 5000);
      ws.on('message', (raw: Buffer) => {
        clearTimeout(timeout);
        res(new Uint8Array(raw));
        ws.close();
      });
      ws.on('error', rej);
    });
    const welcome = decodeWelcome(data);
    expect(welcome).not.toBeNull();
    expect(welcome!.map).toBe('de_douglas');
    expect(welcome!.yourSlot).toBe(0);
    expect(welcome!.seed).toBe(1);
  });

  it('ticks movement and streams a snapshot that reflects a command', async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((res) => ws.on('open', () => res()));

    // First message is the Welcome; the rest are Snapshots.
    let welcomed = false;
    const startPos = await new Promise<[number, number, number]>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error('first snapshot timeout')), 5000);
      ws.on('message', (raw: Buffer) => {
        const bytes = new Uint8Array(raw);
        if (!welcomed) {
          welcomed = true;
          return; // Welcome
        }
        const snap = decodeSnapshot(bytes);
        if (snap && snap.entities.length > 0) {
          clearTimeout(timeout);
          res(snap.entities[0]!.pos);
        }
      });
    });

    // Drive forward (yaw toward +x) for ~40 ticks and watch the entity move.
    const Buttons = { FORWARD: 1 << 0 };
    let seq = 0;
    const send = (): void => {
      seq += 1;
      ws.send(encodeCommand({ seq, lastAckSnapshot: 0, buttons: Buttons.FORWARD, yaw: 0, pitch: 0, weapon: 1, shot: null }));
    };
    const moved = await new Promise<[number, number, number]>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error('movement timeout')), 5000);
      let ticks = 0;
      const interval = setInterval(() => {
        send();
        ticks += 1;
        if (ticks > 60) clearInterval(interval);
      }, 15);
      ws.on('message', (raw: Buffer) => {
        const snap = decodeSnapshot(new Uint8Array(raw));
        if (snap && snap.entities.length > 0 && snap.ackSeq > 20) {
          clearTimeout(timeout);
          clearInterval(interval);
          res(snap.entities[0]!.pos);
        }
      });
    });
    ws.close();

    // The player should have translated appreciably from the spawn.
    const dist = Math.hypot(moved[0] - startPos[0], moved[2] - startPos[2]);
    expect(dist).toBeGreaterThan(0.5);
  });
});
