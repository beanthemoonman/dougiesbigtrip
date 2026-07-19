/**
 * Integration test: start the Rust deathmatch server, connect via WebSocket,
 * and verify the Welcome round-trip. This is the 6.0 exit test.
 *
 * Tests end-to-end: cargo build → server listen → WS handshake → Welcome decode.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeWelcome, SPECTATOR } from '../../src/net/protocol';

const SERVER_BIN = resolve(import.meta.dirname, '../../target/debug/server');
const WS_URL = 'ws://127.0.0.1:9876';

describe('server WS echo + Welcome round-trip', () => {
  let proc: ChildProcess | null = null;

  beforeAll(async () => {
    proc = spawn(SERVER_BIN, [], { stdio: 'pipe' });
    // Wait for the server to bind.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('server start timeout')), 10000);
      proc!.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('listening')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      proc!.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      proc!.on('exit', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`server exited with code ${code}`));
        }
      });
    });
  });

  afterAll(() => {
    proc?.kill();
  });

  it('receives a valid Welcome on connect', async () => {
    const ws = new WebSocket(WS_URL);
    const data = await new Promise<Uint8Array>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('welcome timeout')), 5000);
      ws.on('message', (raw: Buffer) => {
        clearTimeout(timeout);
        resolve(new Uint8Array(raw));
        ws.close();
      });
      ws.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });

    const welcome = decodeWelcome(data);
    expect(welcome).not.toBeNull();
    expect(welcome!.map).toBe('de_douglas');
    expect(welcome!.yourSlot).toBe(SPECTATOR); // first connect = spectate
    expect(welcome!.seed).toBe(1);
    expect(welcome!.serverTick).toBe(0);
  });

  it('echoes binary messages', async () => {
    const ws = new WebSocket(WS_URL);

    // Consume the Welcome first.
    await new Promise<void>((resolve) => {
      ws.on('message', () => resolve());
    });

    // Send a binary message; the server echoes it.
    const sent = new Uint8Array([42, 99, 255]);
    ws.send(sent);

    const reply = await new Promise<Uint8Array>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('echo timeout')), 5000);
      ws.on('message', (raw: Buffer) => {
        clearTimeout(timeout);
        resolve(new Uint8Array(raw));
        ws.close();
      });
    });

    expect(Buffer.from(reply)).toEqual(Buffer.from(sent));
  });
});
