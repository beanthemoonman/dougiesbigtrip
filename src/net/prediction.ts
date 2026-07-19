/**
 * Client-side prediction + reconciliation for the local player (docs/netcode.md
 * §5.1–5.2). The client runs the SAME WASM sim the server runs, so replaying
 * buffered commands after snapping to an authoritative state reproduces the
 * server's result bit-for-bit (barring another player shoving you or a Rapier
 * query divergence — a small, smoothed correction, never a rubber-band).
 *
 * The sim is injected (SimBridge) so this logic is unit-testable without WASM.
 */

import { F_DUCKED, type CommandFrame, type Snapshot } from './protocol';

/** The three sim calls prediction needs, bound to the local player (index 0). */
export interface SimBridge {
  /** sim_tick(0, buttons, yaw) — advance one fixed step. */
  tick(buttons: number, yaw: number): void;
  /** sim_set_player(0, ...) — snap to an authoritative net state. */
  setPlayer(px: number, py: number, pz: number, vx: number, vy: number, vz: number, ducked: boolean): void;
}

interface Pending {
  seq: number;
  buttons: number;
  yaw: number;
}

export interface Predictor {
  /** Our authoritative slot, set from the Welcome. Until set, predict() no-ops the send. */
  ownSlot: number;
  /** serverTick of the newest snapshot seen — rides in each CommandFrame for lag comp. */
  lastAckSnapshot: number;
  /** Predict one local tick: advance the sim, buffer the command, return the frame to send. */
  predict(buttons: number, yaw: number, pitch: number, weapon: number): CommandFrame;
  /** Reconcile against an incoming snapshot: snap own slot to authoritative, replay unacked. */
  reconcile(snap: Snapshot): void;
}

export function createPredictor(sim: SimBridge, ownSlot: number): Predictor {
  let seq = 0;
  let lastAckSnapshot = 0;
  // Unacked commands, oldest first. Bounded implicitly by the snapshot ack rate;
  // on localhost this stays a handful of entries.
  const pending: Pending[] = [];

  const p: Predictor = {
    ownSlot,
    get lastAckSnapshot() {
      return lastAckSnapshot;
    },
    set lastAckSnapshot(v: number) {
      lastAckSnapshot = v;
    },
    predict(buttons, yaw, pitch, weapon): CommandFrame {
      seq += 1;
      sim.tick(buttons, yaw);
      pending.push({ seq, buttons, yaw });
      return {
        seq,
        lastAckSnapshot,
        buttons,
        yaw,
        pitch,
        weapon,
        shot: null,
      };
    },
    reconcile(snap): void {
      if (snap.serverTick > lastAckSnapshot) lastAckSnapshot = snap.serverTick;
      const mine = snap.entities.find((e) => e.slot === p.ownSlot);
      if (!mine) return;
      // Drop everything the server has already consumed.
      while (pending.length > 0 && pending[0]!.seq <= snap.ackSeq) pending.shift();
      // Snap to the authoritative state as-of ackSeq...
      sim.setPlayer(
        mine.pos[0], mine.pos[1], mine.pos[2],
        mine.vel[0], mine.vel[1], mine.vel[2],
        (mine.flags & F_DUCKED) !== 0,
      );
      // ...then replay the commands the server hasn't applied yet.
      for (const c of pending) sim.tick(c.buttons, c.yaw);
    },
  };
  return p;
}
