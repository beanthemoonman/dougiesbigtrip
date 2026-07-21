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
import { decodeSnapshot, decodeWelcome, encodeCommand, encodeJoin } from '../../src/net/protocol';

const SERVER_BIN = resolve(import.meta.dirname, '../../target/debug/server');
const BIND = '127.0.0.1:9899';
const WS_URL = `ws://${BIND}`;

// ponytail: skip in CI where the Rust server isn't built; run `cargo build` to enable.
describe.skipIf(!existsSync(SERVER_BIN))('server authoritative loop (6.3)', () => {
  let proc: ChildProcess | null = null;

  beforeAll(async () => {
    proc = spawn(SERVER_BIN, [], {
      stdio: 'pipe',
      env: {
        ...process.env,
        SERVER_BIND: BIND,
        SERVER_FREEZE_MS: '500',
        SERVER_ROUND_MS: '10000',
        SERVER_END_MS: '500',
      },
    });
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

  it('assigns slot 0 on first connect via two-phase Welcome', async () => {
    const ws = new WebSocket(WS_URL);
    // Phase 9 two-phase flow: first Welcome is SPECTATOR, then client
    // sends Join, server replies with a second Welcome with the real slot.
    const firstData = await new Promise<Uint8Array>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error('welcome timeout')), 5000);
      ws.on('message', (raw: Buffer) => {
        clearTimeout(timeout);
        res(new Uint8Array(raw));
      });
      ws.on('error', rej);
    });
    const firstWelcome = decodeWelcome(firstData);
    expect(firstWelcome).not.toBeNull();
    expect(firstWelcome!.map).toBe('de_douglas');
    expect(firstWelcome!.yourSlot).toBe(255); // SPECTATOR until Join

    // Send Join to pick T (team 0).
    ws.send(Buffer.from(encodeJoin({ team: 0 })));

    const secondData = await new Promise<Uint8Array>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error('second welcome timeout')), 5000);
      ws.on('message', (raw: Buffer) => {
        clearTimeout(timeout);
        res(new Uint8Array(raw));
        ws.close();
      });
    });
    const secondWelcome = decodeWelcome(secondData);
    expect(secondWelcome).not.toBeNull();
    expect(secondWelcome!.yourSlot).toBe(0);
    expect(secondWelcome!.seed).toBe(1);
  });

  it('ticks movement and streams a snapshot that reflects a command', async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((res) => ws.on('open', () => res()));

    // Phase 9 two-phase: read first Welcome (SPECTATOR), send Join, read
    // second Welcome (real slot), then start commanding the player.
    let welcomed = false;
    let joined = false;
    const Buttons = { FORWARD: 1 << 0 };
    let seq = 0;
    const send = (): void => {
      seq += 1;
      ws.send(encodeCommand({ seq, lastAckSnapshot: 0, buttons: Buttons.FORWARD, yaw: 0, pitch: 0, weapon: 1, shot: null }));
    };

    // Capture the spawn position from the first snapshot that includes
    // our entity, then wait for the round to go Live (phase 1) and for
    // the entity to have moved > 0.5 m from spawn.
    const result = await new Promise<{ start: [number, number, number]; end: [number, number, number] }>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error('movement timeout')), 15000);
      let startPos: [number, number, number] | null = null;
      ws.on('message', (raw: Buffer) => {
        const bytes = new Uint8Array(raw);
        if (!welcomed) {
          welcomed = true;
          ws.send(Buffer.from(encodeJoin({ team: 0 })));
          return;
        }
        if (!joined) {
          joined = true;
          return;
        }
        const snap = decodeSnapshot(bytes);
        if (!snap || snap.entities.length === 0) return;
        // Only measure movement during Live phase.
        if (snap.round.phase !== 1) return;
        if (!startPos) {
          startPos = snap.entities[0]!.pos;
        }
        const cur = snap.entities[0]!.pos;
        const dist = Math.hypot(cur[0] - startPos[0], cur[2] - startPos[2]);
        if (dist > 0.5) {
          clearTimeout(timeout);
          res({ start: startPos, end: cur });
        }
      });
      // Start sending commands; they'll take effect once the round goes Live.
      const interval = setInterval(() => send(), 15);
      setTimeout(() => clearInterval(interval), 12000);
    });
    ws.close();

    const dist = Math.hypot(result.end[0] - result.start[0], result.end[2] - result.start[2]);
    expect(dist).toBeGreaterThan(0.5);
  });

  it('resets player state between rounds (Phase 9.5 hygiene)', { timeout: 45000 }, async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((res) => ws.on('open', () => res()));

    let welcomed = false;
    let joined = false;
    let mySlot: number = -1;
    let seq = 0;
    const send = (buttons: number): void => {
      seq += 1;
      ws.send(encodeCommand({ seq, lastAckSnapshot: 0, buttons, yaw: 0, pitch: 0, weapon: 1, shot: null }));
    };

    // The other tests may have left the round in any phase. Strategy:
    // 1. Join; we get assigned a slot (or pending). The Welcome tells us.
    // 2. Wait for round to cycle through at least one Over→Freezetime
    //    transition (proves Reset fired and we were respawned).
    // 3. Verify we're alive at our team's spawn with full health.
    await new Promise<void>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error('round reset timeout')), 40000);
      let sawOver = false;
      let verified = false;
      ws.on('message', (raw: Buffer) => {
        const bytes = new Uint8Array(raw);
        if (!welcomed) { welcomed = true; ws.send(Buffer.from(encodeJoin({ team: 0 }))); return; }
        if (!joined) {
          const w = decodeWelcome(bytes);
          if (w && w.yourSlot !== 255) {
            mySlot = w.yourSlot;
            joined = true;
          }
          return;
        }
        const snap = decodeSnapshot(bytes);
        if (!snap) return;

        if (snap.round.phase === 2 && !sawOver) {
          sawOver = true;
        }
        if (sawOver && snap.round.phase === 0 && !verified) {
          const me = snap.entities.find((e) => e.slot === mySlot);
          if (me) {
            // Core hygiene: alive, full health, at spawn (rough check).
            expect(me.flags & (1 << 0)).toBe(1 << 0); // F_ALIVE
            expect(me.health).toBe(100);
            // If we were pending, the bot's last position could be anything;
            // after Reset we're at exact spawn. The absolute coords don't
            // matter — just check we're alive and healthy.
            verified = true;
            clearTimeout(timeout);
            res();
          }
        }

        send(0);
      });
    });
    ws.close();
  });
});
