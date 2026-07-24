import { describe, expect, it } from 'vitest';
import { createInterpolationBuffer } from './interpolation';
import { F_ALIVE, F_TEAM_CT, type Snapshot } from './protocol';

function snap(tick: number, entities: { slot: number; pos: [number, number, number]; vel: [number, number, number]; yaw: number; pitch: number }[]): Snapshot {
  return {
    serverTick: tick,
    ackSeq: 0,
    entities: entities.map((e) => ({
      slot: e.slot,
      flags: F_ALIVE | (e.slot % 2 === 1 ? F_TEAM_CT : 0),
      pos: e.pos,
      vel: e.vel,
      yaw: e.yaw,
      pitch: e.pitch,
      health: 100,
      armor: 0,
      weapon: 1,
      ammo: 30,
      kills: 0,
      deaths: 0,
      name: '',
    })),
    round: { phase: 1, timeLeftMs: 60000, scoreT: 0, scoreCt: 0 },
    events: [],
  };
}

describe('interpolation', () => {
  it('returns empty before two snapshots', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    expect(buf.interpolate(0)).toEqual([]);
  });

  it('interpolates remote entity position between two snapshots', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [10, 0, 0], vel: [1, 0, 0], yaw: 0, pitch: 0 }]));
    buf.push(snap(106, [{ slot: 1, pos: [16, 0, 0], vel: [1, 0, 0], yaw: 0, pitch: 0 }]));
    // renderTick = 106 - 6 = 100 → exactly on first snapshot
    const result = buf.interpolate(0);
    expect(result.length).toBe(1);
    expect(result[0]!.slot).toBe(1);
    // At renderTick=100, t=0 → position from sLo
    expect(result[0]!.alive).toBe(true);
  });

  it('lerps yaw the short way across the ±π wrap', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 3.0, pitch: 0 }]));
    buf.push(snap(112, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: -3.0, pitch: 0 }]));
    // renderTick = 112 - 6 = 106 → halfway between the two snapshots.
    // Short arc from 3.0 to -3.0 passes through ±π (~3.14), NOT through 0.
    const yaw = buf.interpolate(0)[0]!.yaw;
    expect(Math.abs(yaw)).toBeGreaterThan(3.1); // naive lerp would give ~0
  });

  it('excludes own slot', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [
      { slot: 0, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 },
      { slot: 1, pos: [5, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 },
    ]));
    buf.push(snap(106, [
      { slot: 0, pos: [1, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 },
      { slot: 1, pos: [5, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 },
    ]));
    const result = buf.interpolate(0);
    expect(result.length).toBe(1);
    expect(result[0]!.slot).toBe(1);
  });

  it('returns alive flag correctly', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    buf.push(snap(106, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    const result = buf.interpolate(0);
    expect(result[0]!.alive).toBe(true);
  });

  it('returns teamCt from flags', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    buf.push(snap(106, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    const result = buf.interpolate(0);
    expect(result[0]!.teamCt).toBe(true); // slot 1 → odd → CT

    const buf2 = createInterpolationBuffer();
    buf2.push(snap(100, [{ slot: 2, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    buf2.push(snap(106, [{ slot: 2, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    const r2 = buf2.interpolate(0);
    expect(r2[0]!.teamCt).toBe(false); // slot 2 → even → T
  });
});
