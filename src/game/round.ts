/**
 * Round loop: freezetime → live → over → (reset) → freezetime. Pure state +
 * timers, ticked at the fixed rate; the engine reads `phase` to gate movement
 * (frozen in freezetime) and firing, and reacts to the returned event to
 * respawn / unfreeze. No buy menu — loadouts are fixed (cut scope, plan Phase 4).
 */

export type Phase = 'freezetime' | 'live' | 'over';

/** What just happened on a tick — the engine's cue to act. */
export type RoundEvent =
  | 'none'
  | 'went-live' // freezetime ended: unfreeze players
  | 'round-over' // a winner was decided; score already updated
  | 'reset'; // a fresh round began (freezetime): respawn everyone

export interface RoundConfig {
  readonly freezetime: number; // s, players frozen
  readonly roundTime: number; // s, live time limit
  readonly endDelay: number; // s, result shown before next round
}

export const DEFAULT_ROUND: RoundConfig = { freezetime: 3, roundTime: 115, endDelay: 5 };

export interface RoundState {
  phase: Phase;
  /** Seconds left in the current phase. */
  timer: number;
  /** 1-based round number. */
  round: number;
  score: { t: number; ct: number };
  /** Winner of the round currently being shown in `over`, else null. */
  winner: 'T' | 'CT' | null;
}

export function createRoundState(cfg: RoundConfig = DEFAULT_ROUND): RoundState {
  return {
    phase: 'freezetime',
    timer: cfg.freezetime,
    round: 1,
    score: { t: 0, ct: 0 },
    winner: null,
  };
}

/**
 * Advance the round by `dt`, given how many players are alive per team.
 * Returns the transition event (or 'none'). Win rules (bomb-less): a team is
 * eliminated → the other wins; live timer expires → CT wins (defender default).
 */
export function tickRound(
  state: RoundState,
  cfg: RoundConfig,
  tAlive: number,
  ctAlive: number,
  dt: number,
): RoundEvent {
  state.timer -= dt;

  switch (state.phase) {
    case 'freezetime':
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = cfg.roundTime;
        return 'went-live';
      }
      return 'none';

    case 'live': {
      const win = decideWinner(state.timer, tAlive, ctAlive);
      if (win) {
        state.phase = 'over';
        state.timer = cfg.endDelay;
        state.winner = win;
        if (win === 'T') state.score.t++;
        else state.score.ct++;
        return 'round-over';
      }
      return 'none';
    }

    case 'over':
      if (state.timer <= 0) {
        state.phase = 'freezetime';
        state.timer = cfg.freezetime;
        state.round++;
        state.winner = null;
        return 'reset';
      }
      return 'none';
  }
}

/** The winner this tick, or null if the round is still live. */
function decideWinner(timeLeft: number, tAlive: number, ctAlive: number): 'T' | 'CT' | null {
  if (ctAlive <= 0 && tAlive > 0) return 'T';
  if (tAlive <= 0 && ctAlive > 0) return 'CT';
  if (tAlive <= 0 && ctAlive <= 0) return 'CT'; // mutual elimination → defenders
  if (timeLeft <= 0) return 'CT'; // time expired, no objective → defenders hold
  return null;
}
