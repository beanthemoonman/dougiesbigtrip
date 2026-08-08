import { describe, expect, it } from 'vitest';
import { createInterpolationBuffer } from './interpolation';
import { F_ALIVE, F_TEAM_CT, type Snapshot } from './protocol';

const RENDER_DT = 1 / 120;

function snap(tick: number, entities: { slot: number; pos: [number, number, number]; vel: [number, number, number]; yaw: number; pitch: number; flags?: number }[]): Snapshot {
  return {
    serverTick: tick,
    ackSeq: 0,
    entities: entities.map((e) => ({
      slot: e.slot,
      flags: e.flags ?? (F_ALIVE | (e.slot % 2 === 1 ? F_TEAM_CT : 0)),
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
    })),
    round: { phase: 1, timeLeftMs: 60000, scoreT: 0, scoreCt: 0 },
    events: [],
    impactEvents: [],
    roster: [],
  };
}

describe('interpolation', () => {
  it('returns empty before two snapshots', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    expect(buf.interpolate(0, RENDER_DT)).toEqual([]);
  });

  it('interpolates remote entity position between two snapshots', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [10, 0, 0], vel: [1, 0, 0], yaw: 0, pitch: 0 }]));
    buf.push(snap(106, [{ slot: 1, pos: [16, 0, 0], vel: [1, 0, 0], yaw: 0, pitch: 0 }]));
    const result = buf.interpolate(0, RENDER_DT);
    expect(result.length).toBe(1);
    expect(result[0]!.slot).toBe(1);
    expect(result[0]!.alive).toBe(true);
  });

  it('lerps yaw the short way across the ±π wrap', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 3.0, pitch: 0 }]));
    buf.push(snap(112, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: -3.0, pitch: 0 }]));
    const yaw = buf.interpolate(0, RENDER_DT)[0]!.yaw;
    expect(Math.abs(yaw)).toBeGreaterThan(3.1);
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
    const result = buf.interpolate(0, RENDER_DT);
    expect(result.length).toBe(1);
    expect(result[0]!.slot).toBe(1);
  });

  it('returns alive flag correctly', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    buf.push(snap(106, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    const result = buf.interpolate(0, RENDER_DT);
    expect(result[0]!.alive).toBe(true);
  });

  it('returns teamCt from flags', () => {
    const buf = createInterpolationBuffer();
    buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    buf.push(snap(106, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    const result = buf.interpolate(0, RENDER_DT);
    expect(result[0]!.teamCt).toBe(true);

    const buf2 = createInterpolationBuffer();
    buf2.push(snap(100, [{ slot: 2, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    buf2.push(snap(106, [{ slot: 2, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
    const r2 = buf2.interpolate(0, RENDER_DT);
    expect(r2[0]!.teamCt).toBe(false);
  });

  // --- Phase A additions ---

  describe('Phase A: render clock produces advancing positions with consecutive 64 Hz snapshots', () => {
    it('returns different positions across render frames (the decisive test)', () => {
      const buf = createInterpolationBuffer();
      for (let t = 100; t <= 120; t++) {
        buf.push(snap(t, [{ slot: 1, pos: [t * 0.1, 0, 0], vel: [0.1, 0, 0], yaw: 0, pitch: 0 }]));
      }
      // With the fractional render clock advancing by dt*TICK_RATE each frame,
      // successive calls return lerp'd positions at different fractional ticks.
      const r0 = buf.interpolate(0, RENDER_DT);
      const r1 = buf.interpolate(0, RENDER_DT);
      expect(r0.length).toBeGreaterThanOrEqual(1);
      expect(r1.length).toBeGreaterThanOrEqual(1);
      // They must differ because the render clock advanced between calls.
      const p0x = r0[0]!.pos[0];
      const p1x = r1[0]!.pos[0];
      expect(p1x).not.toBe(p0x);
    });

    it('positions advance monotonically over many render frames', () => {
      const buf = createInterpolationBuffer();
      for (let t = 100; t <= 200; t++) {
        buf.push(snap(t, [{ slot: 1, pos: [t * 0.1, 0, 0], vel: [0.1, 0, 0], yaw: 0, pitch: 0 }]));
      }
      let lastX = -Infinity;
      for (let f = 0; f < 10; f++) {
        const r = buf.interpolate(0, RENDER_DT);
        const x = r[0]!.pos[0]!;
        expect(x).toBeGreaterThanOrEqual(lastX - 0.001); // allow tiny float drift backward
        lastX = x;
      }
    });
  });

  describe('Phase A: buffer hardening', () => {
    it('ignores duplicate serverTick', () => {
      const buf = createInterpolationBuffer();
      buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.push(snap(100, [{ slot: 1, pos: [99, 99, 99], vel: [0, 0, 0], yaw: 0, pitch: 0 }])); // dup, should be ignored
      buf.push(snap(101, [{ slot: 1, pos: [1, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.push(snap(106, [{ slot: 1, pos: [6, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      const result = buf.interpolate(0, RENDER_DT);
      expect(result.length).toBe(1);
      expect(result[0]!.pos[1]).not.toBe(99);
    });

    it('ignores out-of-order snapshot', () => {
      const buf = createInterpolationBuffer();
      buf.push(snap(105, [{ slot: 1, pos: [5, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.push(snap(101, [{ slot: 1, pos: [99, 99, 99], vel: [0, 0, 0], yaw: 0, pitch: 0 }])); // late, should be ignored
      buf.push(snap(106, [{ slot: 1, pos: [6, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.push(snap(112, [{ slot: 1, pos: [12, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      const result = buf.interpolate(0, RENDER_DT);
      expect(result.length).toBe(1);
      expect(result[0]!.pos[0]).not.toBe(99);
    });

    it('reset() clears buffer so stale ticks are not inherited', () => {
      const buf = createInterpolationBuffer();
      buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.push(snap(106, [{ slot: 1, pos: [6, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.reset();
      expect(buf.interpolate(0, RENDER_DT)).toEqual([]);
      buf.push(snap(200, [{ slot: 2, pos: [20, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.push(snap(206, [{ slot: 2, pos: [26, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      const result = buf.interpolate(0, RENDER_DT);
      expect(result.length).toBe(1);
      expect(result[0]!.slot).toBe(2);
    });
  });

  describe('Phase A: entity present only in sHi is returned', () => {
    it('returns entity that appears only in the newer snapshot', () => {
      const buf = createInterpolationBuffer();
      buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.push(snap(112, [
        { slot: 1, pos: [12, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 },
        { slot: 2, pos: [5, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 },
      ]));
      const result = buf.interpolate(0, RENDER_DT);
      const slots = result.map((r) => r.slot).sort();
      expect(slots).toContain(1);
      expect(slots).toContain(2);
    });
  });

  describe('Phase A: alive flag reads from the same side as position (hi, fallback lo)', () => {
    it('alive flips on the same frame position does when death arrives mid-span', () => {
      const buf = createInterpolationBuffer();
      const aliveFlags = F_ALIVE | F_TEAM_CT;
      buf.push(snap(100, [
        { slot: 1, pos: [10, 0, 0], vel: [1, 0, 0], yaw: 0, pitch: 0, flags: aliveFlags },
      ]));
      buf.push(snap(106, [
        { slot: 1, pos: [16, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, flags: F_TEAM_CT },
      ]));
      const result = buf.interpolate(0, RENDER_DT);
      // alive comes from hi (which has F_ALIVE cleared) — same side as position
      expect(result[0]!.alive).toBe(false);
    });
  });

  describe('Phase A: vel is carried on RemoteEntity', () => {
    it('exposes entity velocity from the wire', () => {
      const buf = createInterpolationBuffer();
      buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [4.5, -0.2, 1.3], yaw: 0, pitch: 0 }]));
      buf.push(snap(106, [{ slot: 1, pos: [6, 0, 0], vel: [4.5, -0.2, 1.3], yaw: 0, pitch: 0 }]));
      const result = buf.interpolate(0, RENDER_DT);
      expect(result[0]!.vel).toEqual([4.5, -0.2, 1.3]);
    });
  });

  describe('Phase A: snap threshold for teleports/respawns', () => {
    it('takes hi position when the span exceeds 2 m (respawn)', () => {
      const buf = createInterpolationBuffer();
      buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.push(snap(106, [{ slot: 1, pos: [50, 0, 50], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      const result = buf.interpolate(0, RENDER_DT);
      // Snap threshold fires (> 2 m), takes hi directly — not lerped
      expect(result[0]!.pos[0]).toBe(50);
      expect(result[0]!.pos[2]).toBe(50);
    });

    it('lerps when the span is under 2 m', () => {
      const buf = createInterpolationBuffer();
      buf.push(snap(100, [{ slot: 1, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      buf.push(snap(106, [{ slot: 1, pos: [1.5, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      const result = buf.interpolate(0, RENDER_DT);
      // Under 2 m, the lerp runs — position is between sLo and sHi
      expect(result[0]!.pos[0]).toBeGreaterThan(0);
      expect(result[0]!.pos[0]).toBeLessThan(1.5);
    });
  });

  describe('Phase A: the render clock is closed-loop', () => {
    // A free-running clock drifts past the newest snapshot, every frame then
    // falls through to "hold the newest", and remotes step again — the exact
    // defect interpolation exists to fix. Feed snapshots and frames at
    // mismatched rates and assert the clock stays locked behind the server.
    it('tracks the server under clock drift without freezing frames', () => {
      const buf = createInterpolationBuffer();
      let tick = 100;
      for (; tick < 110; tick++) buf.push(snap(tick, [{ slot: 1, pos: [tick, 0, 0], vel: [1, 0, 0], yaw: 0, pitch: 0 }]));

      let lastX = -Infinity;
      let frozenFrames = 0;
      const total = 360; // 3 s at 120 fps
      for (let f = 0; f < total; f++) {
        // Server runs ~2% slow relative to the render clock.
        if (f % 2 === 0 && f % 100 !== 0) {
          buf.push(snap(tick, [{ slot: 1, pos: [tick, 0, 0], vel: [1, 0, 0], yaw: 0, pitch: 0 }]));
          tick++;
        }
        const x = buf.interpolate(0, RENDER_DT)[0]!.pos[0]!;
        if (x === lastX) frozenFrames++;
        lastX = x;
      }
      expect(frozenFrames).toBe(0);
      // The clock must remain BEHIND the newest snapshot — that delay is the
      // buffer interpolation runs on.
      expect(buf.renderTick).toBeLessThan(tick - 1);
    });

    it('holds at the newest snapshot when the stream stalls', () => {
      const buf = createInterpolationBuffer();
      for (let t = 100; t <= 109; t++) {
        buf.push(snap(t, [{ slot: 1, pos: [t, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      }
      // No further pushes: 200 frames of stall.
      for (let f = 0; f < 200; f++) buf.interpolate(0, RENDER_DT);
      expect(buf.renderTick).toBeLessThanOrEqual(109);
      const x = buf.interpolate(0, RENDER_DT)[0]!.pos[0]!;
      expect(x).toBeCloseTo(109, 5);
    });

    it('does not overshoot across a dropped snapshot', () => {
      const buf = createInterpolationBuffer();
      // Tick 106 is missing, so 105 -> 107 is a span of 2.
      for (let t = 100; t <= 109; t++) {
        if (t === 106) continue;
        buf.push(snap(t, [{ slot: 1, pos: [t, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 }]));
      }
      // pos.x === tick, so a correct lerp puts the entity at x ~= renderTime on
      // every frame. The old `renderFrac + (renderTick - lo)/span` formula sent
      // it ~50% past the right-hand snapshot inside the gap.
      let worstErr = 0;
      for (let f = 0; f < 200; f++) {
        const x = buf.interpolate(0, RENDER_DT)[0]!.pos[0]!;
        worstErr = Math.max(worstErr, Math.abs(x - buf.renderTick));
      }
      expect(worstErr).toBeLessThan(1.05);
    });
  });
});
