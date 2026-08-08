/**
 * E2E regression: a client's SHOT reaches the authoritative server and registers
 * on another player. This is the exact thing that was broken — the client shipped
 * `shot: null` every tick and resolved hits locally against phantom bots, so two
 * connected clients were playing separate games (movement synced, combat did not).
 *
 * Two humans join the SAME team (identical spawn; the server has no friendly-fire
 * gate, so a T can hit a T — see server/src/main.rs target search). After the bots
 * disperse from spawn, the shooter fires a CommandFrame carrying a shot aimed at
 * the co-located target. We assert the server emits EV_KILL{slot: target, by:
 * shooter} — a kill that can ONLY come from a client shot the server resolved.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeSnapshot,
  encodeCommand,
  EV_KILL,
  F_ALIVE,
  type CommandFrame,
} from '../../src/net/protocol';
import { connect, joinTeam, startServer, serverUrl, SERVER_AVAILABLE } from './harness';
import type { ChildProcess } from 'node:child_process';

const BIND = '127.0.0.1:9898';
const WS_URL = serverUrl(BIND);

/** feet → eye/chest offset for the shot origin. Within 1.5 m of the target's
 *  feet so the server's hit-radius check (dist² < 2.25) passes, and within the
 *  server's ±5 m eye-height sanity band. */
const CHEST = 1.0;

const idle = (seq: number): CommandFrame => ({
  seq,
  lastAckSnapshot: 0,
  buttons: 0,
  yaw: 0,
  pitch: 0,
  weapon: 1,
  shot: null,
});

describe.skipIf(!SERVER_AVAILABLE)('server resolves a client shot (6.6 hitreg)', () => {
  let proc: ChildProcess | null = null;
  beforeAll(async () => { proc = await startServer(BIND); });
  afterAll(() => { proc?.kill(); });

  it('a client shot kills another player via server-side hitreg', { timeout: 18000 }, async () => {
    const shooter = await connect(WS_URL);
    const target = await connect(WS_URL);
    const sJoin = await joinTeam(shooter, 0); // team T
    const tJoin = await joinTeam(target, 0);  // team T (same spawn as shooter)
    const shooterSlot = sJoin.welcome!.yourSlot;
    const targetSlot = tJoin.welcome!.yourSlot;
    expect(shooterSlot).not.toBe(targetSlot);

    let seq = 0;
    let liveSnaps = 0;
    let killed = false;
    const deadline = Date.now() + 16000;

    // Drive off the shooter's snapshot stream. Keep the target idle (stays at
    // spawn, stays alive). Once the round is Live and the bots have had ~1 s to
    // leave spawn, fire a shot every tick until the target dies to our slot.
    while (Date.now() < deadline) {
      const snap = decodeSnapshot(await shooter.next(15000));
      if (!snap) continue;

      // Confirm the kill was ours: only a server-resolved client shot produces it.
      if (snap.events.some((e) => e.tag === EV_KILL && e.slot === targetSlot && e.by === shooterSlot)) {
        killed = true;
        break;
      }

      seq += 1;
      target.ws.send(encodeCommand(idle(seq))); // target holds position

      if (snap.round.phase !== 1) continue; // only Live
      liveSnaps += 1;
      if (liveSnaps < 64) { // ~1 s: let co-located bots path away from spawn
        shooter.ws.send(encodeCommand(idle(seq)));
        continue;
      }

      const me = snap.entities.find((e) => e.slot === shooterSlot);
      const you = snap.entities.find((e) => e.slot === targetSlot);
      if (!me || !you || (you.flags & F_ALIVE) === 0) {
        shooter.ws.send(encodeCommand(idle(seq)));
        continue;
      }

      // Aim from the shooter's chest at the target's chest. Co-located → the ray
      // origin is inside the target capsule and the server's solid raycast returns
      // a toi=0 hit; separated → it travels to the target. Either way the hit
      // point lands within 1.5 m of the target's feet.
      const eye: [number, number, number] = [me.pos[0], me.pos[1] + CHEST, me.pos[2]];
      let dir: [number, number, number] = [
        you.pos[0] - me.pos[0],
        you.pos[1] - me.pos[1],
        you.pos[2] - me.pos[2],
      ];
      const len = Math.hypot(dir[0], dir[1], dir[2]);
      dir = len < 0.01 ? [1, 0, 0] : [dir[0] / len, dir[1] / len, dir[2] / len];

      shooter.ws.send(encodeCommand({ ...idle(seq), shot: { eyePos: eye, dir } }));
    }

    shooter.close();
    target.close();
    expect(killed).toBe(true);
  });
});
