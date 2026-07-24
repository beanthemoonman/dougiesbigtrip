//! Server-authoritative round FSM. Ticks every sim frame (64 Hz), drives
//! freezetime → live → over → reset. When the server handles round state, the
//! client rounds down the snapshot `timeLeftMs` to display the clock.

use sim::constants::FIXED_DT;

pub const DEFAULT_FREEZETIME_MS: u32 = 3_000;
pub const DEFAULT_ROUND_MS: u32 = 115_000;
pub const DEFAULT_END_MS: u32 = 5_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Phase {
    Freezetime,
    Live,
    Over,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RoundEvent {
    None,
    WentLive,
    RoundOver,
    MatchOver,
    Reset,
}

#[derive(Debug, Clone, Copy)]
pub struct State {
    pub phase: Phase,
    pub time_left_ms: u32,
    pub round_number: u32,
    pub score_t: u16,
    pub score_ct: u16,
    pub winner: Option<char>,
    pub rounds_to_win: u8,
    pub match_over: bool,
    pub match_winner: Option<char>,
    // Timing — set once from ServerConfig, not read from env every new().
    freezetime_ms: u32,
    round_time_ms: u32,
    end_delay_ms: u32,
}

impl State {
    pub fn new(rounds_to_win: u8, freezetime_ms: u32, round_time_ms: u32, end_delay_ms: u32) -> Self {
        Self {
            phase: Phase::Freezetime,
            time_left_ms: freezetime_ms,
            round_number: 1,
            score_t: 0,
            score_ct: 0,
            winner: None,
            rounds_to_win,
            match_over: false,
            match_winner: None,
            freezetime_ms,
            round_time_ms,
            end_delay_ms,
        }
    }

    pub fn phase_value(&self) -> u8 {
        match self.phase {
            Phase::Freezetime => 0,
            Phase::Live => 1,
            Phase::Over => 2,
        }
    }

    /// Check if a side's score after a round win reaches the match target.
    fn match_over_this_round(&self, score: u16) -> bool {
        score >= self.rounds_to_win as u16
    }
}

/// Advance the round by one sim frame. Returns the transition event.
/// `t_alive` / `ct_alive` are the current alive counts (post-combat).
pub fn tick(state: &mut State, t_alive: usize, ct_alive: usize) -> RoundEvent {
    let dt_ms = (FIXED_DT * 1000.0) as u32;
    state.time_left_ms = state.time_left_ms.saturating_sub(dt_ms);

    match state.phase {
        Phase::Freezetime => {
            if state.time_left_ms == 0 {
                state.phase = Phase::Live;
                state.time_left_ms = state.round_time_ms;
                return RoundEvent::WentLive;
            }
            RoundEvent::None
        }
        Phase::Live => {
            let winner = decide_winner(state.time_left_ms, t_alive, ct_alive);
            if let Some(w) = winner {
                state.phase = Phase::Over;
                state.time_left_ms = state.end_delay_ms;
                state.winner = Some(w);
                if w == 'T' {
                    state.score_t += 1;
                    if state.match_over_this_round(state.score_t) {
                        state.match_over = true;
                        state.match_winner = Some('T');
                        return RoundEvent::MatchOver;
                    }
                } else {
                    state.score_ct += 1;
                    if state.match_over_this_round(state.score_ct) {
                        state.match_over = true;
                        state.match_winner = Some('C');
                        return RoundEvent::MatchOver;
                    }
                }
                return RoundEvent::RoundOver;
            }
            RoundEvent::None
        }
        Phase::Over => {
            if state.time_left_ms == 0 {
                state.phase = Phase::Freezetime;
                state.time_left_ms = state.freezetime_ms;
                state.winner = None;
                if state.match_over {
                    state.match_over = false;
                    state.match_winner = None;
                    state.score_t = 0;
                    state.score_ct = 0;
                    state.round_number = 1;
                    // Still a Reset: the game loop respawns everyone on this event.
                    return RoundEvent::Reset;
                }
                state.round_number += 1;
                return RoundEvent::Reset;
            }
            RoundEvent::None
        }
    }
}

fn decide_winner(time_left_ms: u32, t_alive: usize, ct_alive: usize) -> Option<char> {
    if ct_alive == 0 && t_alive > 0 {
        return Some('T');
    }
    if t_alive == 0 && ct_alive > 0 {
        return Some('C');
    }
    if t_alive == 0 && ct_alive == 0 {
        return Some('C'); // mutual → defenders
    }
    if time_left_ms == 0 {
        return Some('C'); // time expired → defenders
    }
    None
}

#[cfg(test)]
mod fsm_tests {
    use super::*;

    fn std_cfg() -> State {
        State::new(16, DEFAULT_FREEZETIME_MS, DEFAULT_ROUND_MS, DEFAULT_END_MS)
    }

    #[test]
    fn starts_in_freezetime() {
        let s = std_cfg();
        assert_eq!(s.phase, Phase::Freezetime);
        assert!(!s.match_over);
    }

    #[test]
    fn match_over_at_rounds_to_win() {
        let mut s = State::new(1, 0, 1000, 10); // freezetime=0, round=1000ms, end=10ms
        // Tick through freezetime (already at 0 → went-live)
        assert_eq!(tick(&mut s, 1, 1), RoundEvent::WentLive);
        // Kill all T → CT wins, match over since rounds_to_win=1
        assert_eq!(tick(&mut s, 0, 1), RoundEvent::MatchOver);
        assert!(s.match_over);
        assert_eq!(s.match_winner, Some('C'));
        assert_eq!(s.score_ct, 1);
        // Tick through Over phase (one tick drops 10ms below dt_ms → 0)
        assert_eq!(tick(&mut s, 0, 1), RoundEvent::Reset); // match reset still respawns
        assert!(!s.match_over);
        assert_eq!(s.score_ct, 0);
        assert_eq!(s.score_t, 0);
        assert_eq!(s.round_number, 1);
    }

    #[test]
    fn normal_round_transition_does_not_match_over() {
        let mut s = std_cfg(); // rounds_to_win=16
        // Advance far enough to enter Live phase
        let mut ev = RoundEvent::None;
        // freezetime is 3000ms; dt_ms = 16 per tick → ~188 ticks to reach 0
        // We use a capped loop to be safe.
        for _ in 0..300 {
            ev = tick(&mut s, 5, 5);
            if ev != RoundEvent::None { break; }
        }
        assert_eq!(ev, RoundEvent::WentLive, "should have gone live");
        // CT wins by eliminating all T — round_over, not match_over
        let mut ev = tick(&mut s, 0, 1);
        assert_eq!(ev, RoundEvent::RoundOver);
        assert!(!s.match_over);
        assert_eq!(s.score_ct, 1);
        // Tick through Over phase (5000ms / 16ms ≈ 313 ticks)
        for _ in 0..400 {
            ev = tick(&mut s, 1, 0);
            if ev != RoundEvent::None { break; }
        }
        assert_eq!(ev, RoundEvent::Reset);
        assert!(!s.match_over);
        assert_eq!(s.round_number, 2);
        assert_eq!(s.score_ct, 1);
    }

    #[test]
    fn match_over_is_emitted_only_on_winning_round() {
        let mut s = State::new(2, 0, 100, 10); // rounds_to_win=2
        // Round 1: enter Live, kill T → CT wins (not yet match-over)
        assert_eq!(tick(&mut s, 1, 2), RoundEvent::WentLive); // freezetime==0
        assert_eq!(tick(&mut s, 0, 1), RoundEvent::RoundOver); // T dead, CT alive → CT wins
        assert!(!s.match_over);
        assert_eq!(s.score_ct, 1);
        // Tick through Over
        assert_eq!(tick(&mut s, 0, 0), RoundEvent::Reset);
        // Round 2: CT wins again → match over
        assert_eq!(tick(&mut s, 1, 1), RoundEvent::WentLive);
        assert_eq!(tick(&mut s, 0, 1), RoundEvent::MatchOver); // T dead, CT alive → CT wins
        assert!(s.match_over);
        assert_eq!(s.score_ct, 2);
    }
}
