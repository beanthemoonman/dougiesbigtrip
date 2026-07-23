import { describe, expect, it } from 'vitest';
import { createRoundState, DEFAULT_MATCH, tickRound, validateMatchConfig, type MatchConfig } from './round';

// T0/T1: the round state machine. Deterministic timers, no world.
const CFG: MatchConfig = { freezetime: 3, roundTime: 10, endDelay: 2, map: 'de_douglas', botCount: 6, roundsToWin: 16 };
const DT = 1 / 64;

/** Tick until `event` fires (or `maxTicks`), returning the tick count. */
function runUntil(
  state: ReturnType<typeof createRoundState>,
  cfg: MatchConfig,
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
    expect(DEFAULT_MATCH.freezetime).toBeGreaterThan(0);
    expect(DEFAULT_MATCH.roundTime).toBeGreaterThan(DEFAULT_MATCH.freezetime);
    expect(DEFAULT_MATCH.roundsToWin).toBeGreaterThan(1);
    expect(DEFAULT_MATCH.botCount).toBeGreaterThan(0);
  });
});

describe('match-over', () => {
  it('emits match-over when a side reaches roundsToWin', () => {
    const cfg: MatchConfig = { ...CFG, roundsToWin: 2 };
    const s = createRoundState();
    runUntil(s, cfg, 1, 1, 'went-live');
    tickRound(s, cfg, 1, 0, DT); // T wins round 1, score 1-0
    expect(s.score).toEqual({ t: 1, ct: 0 });
    runUntil(s, cfg, 1, 1, 'reset');
    runUntil(s, cfg, 1, 1, 'went-live');
    const ev = tickRound(s, cfg, 1, 0, DT); // T wins round 2, score 2-0 → match over
    expect(ev).toBe('match-over');
    expect(s.matchOver).toBe(true);
    expect(s.matchWinner).toBe('T');
  });

  it('emits match-over exactly once — subsequent ticks stay in over', () => {
    const cfg: MatchConfig = { ...CFG, roundsToWin: 1 };
    const s = createRoundState();
    runUntil(s, cfg, 1, 1, 'went-live');
    expect(tickRound(s, cfg, 1, 0, DT)).toBe('match-over');
    // Extra ticks in the same 'over' phase do not fire again.
    expect(tickRound(s, cfg, 1, 0, DT)).toBe('none');
    expect(tickRound(s, cfg, 1, 0, DT)).toBe('none');
  });

  it('match-over resets scores and round on restart', () => {
    const cfg: MatchConfig = { ...CFG, roundsToWin: 1 };
    const s = createRoundState();
    runUntil(s, cfg, 1, 1, 'went-live');
    tickRound(s, cfg, 1, 0, DT); // T wins → match-over
    expect(s.matchOver).toBe(true);
    expect(s.score.t).toBe(1);
    runUntil(s, cfg, 1, 1, 'reset');
    expect(s.phase).toBe('freezetime');
    expect(s.round).toBe(1);
    expect(s.score).toEqual({ t: 0, ct: 0 });
    expect(s.matchOver).toBe(false);
    expect(s.matchWinner).toBeNull();
  });
});

describe('validateMatchConfig', () => {
  it('accepts a valid config, filling defaults', () => {
    const r = validateMatchConfig({ botCount: 4, roundsToWin: 8 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.botCount).toBe(4);
      expect(r.value.roundsToWin).toBe(8);
      expect(r.value.map).toBe('de_douglas');
    }
  });

  it('rejects botCount out of upper bounds', () => {
    const r = validateMatchConfig({ botCount: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('botCount'))).toBe(true);
  });

  // A count below 2 leaves one side empty, so every round ends on its first tick.
  it('rejects botCount below the lower bound', () => {
    for (const botCount of [0, 1]) {
      const r = validateMatchConfig({ botCount });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.includes('botCount'))).toBe(true);
    }
  });

  it('rejects roundsToWin of 0 (below lower bound)', () => {
    const r = validateMatchConfig({ roundsToWin: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('roundsToWin'))).toBe(true);
  });

  it('rejects unknown map', () => {
    const r = validateMatchConfig({ map: 'de_dust2' as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('map'))).toBe(true);
  });

  it('rejects non-integer botCount', () => {
    const r = validateMatchConfig({ botCount: 3.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('botCount'))).toBe(true);
  });
});
