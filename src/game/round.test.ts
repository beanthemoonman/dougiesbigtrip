import { describe, expect, it } from 'vitest';
import { createRoundState, DEFAULT_ROUND, tickRound, type RoundConfig } from './round';

// T0/T1: the round state machine. Deterministic timers, no world.
const CFG: RoundConfig = { freezetime: 3, roundTime: 10, endDelay: 2 };
const DT = 1 / 64;

/** Tick until `event` fires (or `maxTicks`), returning the tick count. */
function runUntil(
  state: ReturnType<typeof createRoundState>,
  cfg: RoundConfig,
  t: number,
  ct: number,
  event: string,
  maxTicks = 64 * 60,
): number {
  for (let i = 1; i <= maxTicks; i++) {
    if (tickRound(state, cfg, t, ct, DT) === event) return i;
  }
  throw new Error(`event ${event} never fired`);
}

describe('round loop', () => {
  it('starts in freezetime and goes live after the freeze', () => {
    const s = createRoundState(CFG);
    expect(s.phase).toBe('freezetime');
    const ticks = runUntil(s, CFG, 1, 1, 'went-live');
    expect(ticks).toBeGreaterThanOrEqual(Math.floor(CFG.freezetime / DT));
    expect(s.phase).toBe('live');
    expect(s.timer).toBeCloseTo(CFG.roundTime, 1);
  });

  it('T wins by eliminating CT; score updates once', () => {
    const s = createRoundState(CFG);
    runUntil(s, CFG, 1, 1, 'went-live');
    const ev = tickRound(s, CFG, /*t*/ 1, /*ct*/ 0, DT); // CT wiped
    expect(ev).toBe('round-over');
    expect(s.winner).toBe('T');
    expect(s.score).toEqual({ t: 1, ct: 0 });
    // Staying in 'over' doesn't keep incrementing.
    tickRound(s, CFG, 1, 0, DT);
    expect(s.score).toEqual({ t: 1, ct: 0 });
  });

  it('CT wins when the live timer expires', () => {
    const s = createRoundState(CFG);
    runUntil(s, CFG, 1, 1, 'went-live');
    runUntil(s, CFG, 1, 1, 'round-over'); // nobody dies → time runs out
    expect(s.winner).toBe('CT');
    expect(s.score).toEqual({ t: 0, ct: 1 });
  });

  it('resets into the next round after the end delay, and respawns (event)', () => {
    const s = createRoundState(CFG);
    runUntil(s, CFG, 1, 1, 'went-live');
    tickRound(s, CFG, 1, 0, DT); // T wins → over
    runUntil(s, CFG, 1, 1, 'reset');
    expect(s.phase).toBe('freezetime');
    expect(s.round).toBe(2);
    expect(s.winner).toBeNull();
    expect(s.timer).toBeCloseTo(CFG.freezetime, 5);
  });

  it('default config is sane', () => {
    expect(DEFAULT_ROUND.freezetime).toBeGreaterThan(0);
    expect(DEFAULT_ROUND.roundTime).toBeGreaterThan(DEFAULT_ROUND.freezetime);
  });
});
