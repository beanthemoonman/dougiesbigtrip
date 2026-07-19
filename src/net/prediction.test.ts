import { describe, expect, it } from 'vitest';
import { createPredictor, type SimBridge } from './prediction';
import { F_ALIVE, type Snapshot } from './protocol';

/**
 * A trivial deterministic 1-D sim: position += buttons each tick. This is not
 * the real movement — it just has to be a pure function of the input stream so
 * we can prove that (snap to authoritative) + (replay unacked) lands exactly
 * where continuous prediction would have.
 */
function fakeSim(): SimBridge & { pos: number } {
  return {
    pos: 0,
    tick(buttons) {
      this.pos += buttons;
    },
    setPlayer(px) {
      this.pos = px;
    },
  };
}

function snapshot(serverTick: number, ackSeq: number, pos: number): Snapshot {
  return {
    serverTick,
    ackSeq,
    entities: [
      {
        slot: 0,
        flags: F_ALIVE,
        pos: [pos, 0, 0],
        vel: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        health: 100,
        armor: 0,
        weapon: 1,
        ammo: 30,
      },
    ],
    round: { phase: 1, timeLeftMs: 0, scoreT: 0, scoreCt: 0 },
  };
}

describe('prediction', () => {
  it('increments seq and advances the sim on predict', () => {
    const sim = fakeSim();
    const p = createPredictor(sim, 0);
    const a = p.predict(1, 0, 0, 1);
    const b = p.predict(1, 0, 0, 1);
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(sim.pos).toBe(2);
  });

  it('reconcile + replay reproduces the predicted state', () => {
    const sim = fakeSim();
    const p = createPredictor(sim, 0);
    // Predict 5 ticks of +1 → pos 5, seqs 1..5 pending.
    for (let i = 0; i < 5; i++) p.predict(1, 0, 0, 1);
    expect(sim.pos).toBe(5);

    // Server has consumed through seq 3; its authoritative pos at seq 3 is 3.
    // Reconcile should snap to 3, replay seqs 4,5 (+1 each) → back to 5.
    p.reconcile(snapshot(64, 3, 3));
    expect(sim.pos).toBe(5);
  });

  it('a divergent authoritative state corrects then replays forward', () => {
    const sim = fakeSim();
    const p = createPredictor(sim, 0);
    for (let i = 0; i < 4; i++) p.predict(1, 0, 0, 1); // pos 4, seqs 1..4

    // Server says at seq 2 you were actually at pos 10 (shoved). Replay 3,4 → 12.
    p.reconcile(snapshot(64, 2, 10));
    expect(sim.pos).toBe(12);
  });

  it('tracks the newest serverTick for lag-comp acks', () => {
    const sim = fakeSim();
    const p = createPredictor(sim, 0);
    p.reconcile(snapshot(100, 0, 0));
    expect(p.lastAckSnapshot).toBe(100);
    p.reconcile(snapshot(50, 0, 0)); // out-of-order/older — ignored
    expect(p.lastAckSnapshot).toBe(100);
  });

  it('ignores snapshots that do not contain our slot', () => {
    const sim = fakeSim();
    const p = createPredictor(sim, 3); // our slot is 3, snapshot only has slot 0
    p.predict(1, 0, 0, 1);
    p.reconcile(snapshot(10, 1, 99));
    expect(sim.pos).toBe(1); // unchanged — no snap, no replay
  });
});
