/**
 * E2E: the Phase 6.3 server-authoritative loop over a real WebSocket —
 *   Welcome (slot 0 on first join) → CommandFrames → Snapshot that reflects the
 *   command → clean per-player reset between rounds (Phase 9.5 hygiene).
 *
 * Ported from the old `tests/harness/server.test.ts`; see `tests/e2e/README.md`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeCommand } from '../../src/net/protocol';
import { connect, joinTeam, startServer, SERVER_BUILT, type Client } from './harness';
import type { ChildProcess } from 'node:child_process';

const BIND = '127.0.0.1:9899';
const WS_URL = `ws://${BIND}`;

describe.skipIf(!SERVER_BUILT)('server authoritative loop (6.3)', () => {
  let proc: ChildProcess | null = null;
  beforeAll(async () => { proc = await startServer(BIND); });
  afterAll(() => { proc?.kill(); });

  it('assigns slot 0 on first connect via two-phase Welcome', async () => {
    const client = await connect(WS_URL);
    const { connectWelcome, welcome } = await joinTeam(client, 0);
    expect(connectWelcome.map).toBe('de_douglas');
    expect(connectWelcome.yourSlot).toBe(255); // SPECTATOR until Join
    expect(welcome).not.toBeNull();
    expect(welcome!.yourSlot).toBe(0);
    expect(welcome!.seed).toBe(1);
    client.close();
  });

  it('ticks movement and streams a snapshot that reflects a command', async () => {
    const client = await connect(WS_URL);
    await joinTeam(client, 0);
    // Fire FORWARD every 15 ms; commands take effect once the round goes Live.
    let seq = 0;
    const interval = setInterval(() => {
      seq += 1;
      client.ws.send(encodeCommand({ seq, lastAckSnapshot: 0, buttons: 1 << 0, yaw: 0, pitch: 0, weapon: 1, shot: null }));
    }, 15);

    let startPos: [number, number, number] | null = null;
    let moved = 0;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const snap = decodeSnapshot(await client.next(15000));
      if (!snap || snap.entities.length === 0 || snap.round.phase !== 1) continue;
      const cur = snap.entities[0]!.pos;
      if (!startPos) startPos = cur;
      moved = Math.hypot(cur[0] - startPos[0], cur[2] - startPos[2]);
      if (moved > 0.5) break;
    }
    clearInterval(interval);
    client.close();
    expect(moved).toBeGreaterThan(0.5);
  });

  it('resets player state between rounds (Phase 9.5 hygiene)', { timeout: 45000 }, async () => {
    const client = await connect(WS_URL);
    const { welcome } = await joinTeam(client, 0);
    const mySlot = welcome!.yourSlot;

    // Wait for an Over (phase 2) → Freezetime (phase 0) transition, proving a
    // Reset fired, then assert we came back alive with full health at spawn.
    let sawOver = false;
    const deadline = Date.now() + 40000;
    let ok = false;
    while (Date.now() < deadline) {
      const snap = decodeSnapshot(await pump(client));
      if (!snap) continue;
      if (snap.round.phase === 2) sawOver = true;
      if (sawOver && snap.round.phase === 0) {
        const me = snap.entities.find((e) => e.slot === mySlot);
        if (me) {
          expect(me.flags & (1 << 0)).toBe(1 << 0); // F_ALIVE
          expect(me.health).toBe(100);
          ok = true;
          break;
        }
      }
    }
    client.close();
    expect(ok).toBe(true);
  });
});

/** Read the next message, keeping ack_seq advancing with an idle command. */
async function pump(client: Client): Promise<Uint8Array> {
  client.ws.send(encodeCommand({ seq: 0, lastAckSnapshot: 0, buttons: 0, yaw: 0, pitch: 0, weapon: 1, shot: null }));
  return client.next(15000);
}
