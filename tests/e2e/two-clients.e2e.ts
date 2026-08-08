/**
 * E2E: two clients on the same server can SEE EACH OTHER, and a client joining
 * mid-round adopts the server's round instead of starting a fresh one.
 *
 * These are the two symptoms of "multiplayer isn't working". Unlike the other
 * e2e suites this one does not hand-roll the client's view of the world: it
 * feeds every raw snapshot through the REAL client modules —
 * `decodeSnapshot` (src/net/protocol.ts) and `createInterpolationBuffer()`
 * (src/net/interpolation.ts) — which is exactly what session.ts:1346 calls to
 * drive the remote player meshes. So a pass here means the whole
 * server → wire → decode → interpolate chain resolves the peer; anything still
 * broken after that is in the three.js plumbing in session.ts, not here.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeCommand, type CommandFrame } from '../../src/net/protocol';
import { createInterpolationBuffer } from '../../src/net/interpolation';
import { connect, joinTeam, startServer, serverUrl, SERVER_AVAILABLE, type Client } from './harness';
import type { ChildProcess } from 'node:child_process';

const BIND = '127.0.0.1:9897'; // server-loop uses :9899, combat/roster :9898
const WS_URL = serverUrl(BIND);

const FORWARD = 1 << 0;
/** FAST_ROUND_ENV round length (harness.ts) — case 2 needs the clock to have run down. */
const ROUND_MS = 10000;

const cmd = (seq: number, buttons = 0): CommandFrame => ({
  seq,
  lastAckSnapshot: 0,
  buttons,
  yaw: 0,
  pitch: 0,
  weapon: 1,
  shot: null,
});

describe.skipIf(!SERVER_AVAILABLE)('two clients see each other', () => {
  let proc: ChildProcess | null = null;
  beforeAll(async () => { proc = await startServer(BIND); });
  afterAll(() => { proc?.kill(); });

  it("each client's interpolation resolves the other as a live, moving, correctly-teamed entity", { timeout: 18000 }, async () => {
    const a = await connect(WS_URL);
    const b = await connect(WS_URL);
    const aSlot = (await joinTeam(a, 0)).welcome!.yourSlot; // T
    const bSlot = (await joinTeam(b, 1)).welcome!.yourSlot; // CT
    expect(aSlot).not.toBe(bSlot);

    const aBuf = createInterpolationBuffer();
    const bBuf = createInterpolationBuffer();

    // What A's client believes about B, and vice versa.
    let aSeesB: { alive: boolean; teamCt: boolean } | null = null;
    let bSeesA: { alive: boolean; teamCt: boolean } | null = null;
    let bFirstPos: [number, number, number] | null = null;
    let bMoved = 0;

    let seq = 0;
    const deadline = Date.now() + 16000;
    while (Date.now() < deadline) {
      seq += 1;
      // B walks forward, A holds still. Both keep sending so ack_seq advances.
      a.ws.send(encodeCommand(cmd(seq)));
      b.ws.send(encodeCommand(cmd(seq, FORWARD)));

      const aSnap = decodeSnapshot(await a.next(15000));
      const bSnap = decodeSnapshot(await b.next(15000));
      if (!aSnap || !bSnap) continue;
      aBuf.push(aSnap);
      bBuf.push(bSnap);
      if (aSnap.round.phase !== 1) continue; // only Live: the server ignores buttons otherwise

      const bAsSeenByA = aBuf.interpolate(aSlot).find((r) => r.slot === bSlot);
      if (bAsSeenByA) {
        aSeesB = { alive: bAsSeenByA.alive, teamCt: bAsSeenByA.teamCt };
        bFirstPos ??= bAsSeenByA.pos;
        bMoved = Math.hypot(bAsSeenByA.pos[0] - bFirstPos[0], bAsSeenByA.pos[2] - bFirstPos[2]);
      }
      const aAsSeenByB = bBuf.interpolate(bSlot).find((r) => r.slot === aSlot);
      if (aAsSeenByB) bSeesA = { alive: aAsSeenByB.alive, teamCt: aAsSeenByB.teamCt };

      if (aSeesB && bSeesA && bMoved > 0.5) break;
    }

    a.close();
    b.close();

    // A sees B: present, alive, on CT.
    expect(aSeesB).not.toBeNull();
    expect(aSeesB!.alive).toBe(true);
    expect(aSeesB!.teamCt).toBe(true);
    // B sees A: present, alive, on T.
    expect(bSeesA).not.toBeNull();
    expect(bSeesA!.alive).toBe(true);
    expect(bSeesA!.teamCt).toBe(false);
    // And A sees B's movement, not a frozen statue at spawn.
    expect(bMoved).toBeGreaterThan(0.5);
  });

  it('a client joining mid-round adopts the round in progress, not a fresh one', { timeout: 18000 }, async () => {
    const a = await connect(WS_URL);
    await joinTeam(a, 0);

    // Burn at least 1 s off A's live round clock before B dials in.
    let aRound: { phase: number; timeLeftMs: number; scoreT: number; scoreCt: number } | null = null;
    const deadline = Date.now() + 14000;
    while (Date.now() < deadline) {
      const snap = decodeSnapshot(await pump(a));
      if (!snap) continue;
      if (snap.round.phase === 1 && snap.round.timeLeftMs < ROUND_MS - 1000) {
        aRound = snap.round;
        break;
      }
    }
    expect(aRound, 'server never reached a live round with time burned off').not.toBeNull();

    const b = await connect(WS_URL);
    await joinTeam(b, 1);
    const bSnap = decodeSnapshot(await pump(b));

    a.close();
    b.close();

    expect(bSnap).not.toBeNull();
    // B's very FIRST snapshot already shows a round in progress: same phase and
    // score as A, with the clock run down — not a fresh round of its own.
    //
    // Deliberately no cross-client timeLeftMs comparison: a ws client's queue lags
    // the 64 Hz stream by seconds, so A's "latest" read is not contemporaneous with
    // B's. The mid-round claim is what matters and it is queue-independent.
    expect(bSnap!.round.phase).toBe(1);
    expect(bSnap!.round.timeLeftMs).toBeLessThan(ROUND_MS - 1000);
    expect(bSnap!.round.scoreT).toBe(aRound!.scoreT);
    expect(bSnap!.round.scoreCt).toBe(aRound!.scoreCt);
  });
});

/** Read the next message, keeping ack_seq advancing with an idle command. */
async function pump(client: Client): Promise<Uint8Array> {
  client.ws.send(encodeCommand(cmd(0)));
  return client.next(15000);
}
