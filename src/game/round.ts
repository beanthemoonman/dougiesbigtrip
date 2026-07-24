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
  | 'went-live'   // freezetime ended: unfreeze players
  | 'round-over'  // a winner was decided; score already updated
  | 'match-over'  // a winner was decided AND that team reached roundsToWin
  | 'reset';      // a fresh round began (freezetime): respawn everyone

export interface RoundConfig {
  readonly freezetime: number; // s, players frozen
  readonly roundTime: number; // s, live time limit
  readonly endDelay: number; // s, result shown before next round
}

export type MapId = 'de_douglas';

export interface MatchConfig extends RoundConfig {
  readonly map: MapId;
  readonly botCount: number;
  readonly roundsToWin: number;
}

export const DEFAULT_ROUND: RoundConfig = { freezetime: 3, roundTime: 115, endDelay: 5 };

export const DEFAULT_MATCH: MatchConfig = {
  ...DEFAULT_ROUND,
  map: 'de_douglas',
  botCount: 6,
  roundsToWin: 16,
};

/** botCount floors at 2 so the count can always split one bot per side — at 0 or 1
 *  a team starts empty and `decideWinner` ends every round on its first tick.
 *  It ceilings at 6 = the server's slot capacity (`MAX_SLOTS` in server/src/main.rs);
 *  keep the two in step, or the panel offers counts the server exits on. */
export const LIMITS = { botCount: [2, 6], roundsToWin: [1, 30] } as const;

const VALID_MAPS: readonly MapId[] = ['de_douglas'];

/** Match-over from raw scores — used by the networked client, which gets scores from
 *  snapshots and `roundsToWin` from Welcome (0 = pre-Phase-16 server, so never over). */
export function isMatchOver(scoreT: number, scoreCt: number, roundsToWin: number): boolean {
  return roundsToWin > 0 && (scoreT >= roundsToWin || scoreCt >= roundsToWin);
}

export interface RoundState {
  phase: Phase;
  /** Seconds left in the current phase. */
  timer: number;
  /** 1-based round number. */
  round: number;
  score: { t: number; ct: number };
  /** Winner of the round currently being shown in `over`, else null. */
  winner: 'T' | 'CT' | null;
  /** True when a team has reached roundsToWin and the match is showing the result. */
  matchOver: boolean;
  /** The team that won the match, set when matchOver is first set. */
  matchWinner: 'T' | 'CT' | null;
}

export function createRoundState(cfg: RoundConfig = DEFAULT_ROUND): RoundState {
  return {
    phase: 'freezetime',
    timer: cfg.freezetime,
    round: 1,
    score: { t: 0, ct: 0 },
    winner: null,
    matchOver: false,
    matchWinner: null,
  };
}

/**
 * Advance the round by `dt`, given how many players are alive per team.
 * Returns the transition event (or 'none'). Win rules (bomb-less): a team is
 * eliminated → the other wins; live timer expires → CT wins (defender default).
 *
 * When a round ends and the winning team's score reaches `cfg.roundsToWin`,
 * returns `'match-over'` instead of `'round-over'`. After the end delay the
 * match resets with zeroed scores.
 */
export function tickRound(
  state: RoundState,
  cfg: MatchConfig,
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
        if (state.score[win === 'T' ? 't' : 'ct'] >= cfg.roundsToWin) {
          state.matchOver = true;
          state.matchWinner = win;
          return 'match-over';
        }
        return 'round-over';
      }
      return 'none';
    }

    case 'over':
      if (state.timer <= 0) {
        state.phase = 'freezetime';
        state.timer = cfg.freezetime;
        if (state.matchOver) {
          state.score.t = 0;
          state.score.ct = 0;
          state.round = 1;
          state.matchOver = false;
          state.matchWinner = null;
        } else {
          state.round++;
        }
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

/**
 * Validate a partial match config against the spec (see docs/plan-post-1.0-config-auth.md).
 * Missing fields are filled from DEFAULT_MATCH. Fails with one error per invalid field.
 * Used by SP, server, and the admin endpoint — one implementation, three callers.
 */
export function validateMatchConfig(
  partial: Partial<MatchConfig>,
): { ok: true; value: MatchConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const value = { ...DEFAULT_MATCH, ...partial };

  if (
    !Number.isInteger(value.botCount) ||
    value.botCount < LIMITS.botCount[0] ||
    value.botCount > LIMITS.botCount[1]
  ) {
    errors.push(`botCount must be an integer between ${LIMITS.botCount[0]} and ${LIMITS.botCount[1]}`);
  }

  if (
    !Number.isInteger(value.roundsToWin) ||
    value.roundsToWin < LIMITS.roundsToWin[0] ||
    value.roundsToWin > LIMITS.roundsToWin[1]
  ) {
    errors.push(`roundsToWin must be an integer between ${LIMITS.roundsToWin[0]} and ${LIMITS.roundsToWin[1]}`);
  }

  if (!(VALID_MAPS as readonly string[]).includes(value.map)) {
    errors.push(`unknown map: ${value.map}`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}
