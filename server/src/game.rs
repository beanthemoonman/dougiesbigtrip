//! Server-authoritative round FSM. Ticks every sim frame (64 Hz), drives
//! freezetime → live → over → reset. When the server handles round state, the
//! client rounds down the snapshot `timeLeftMs` to display the clock.

use sim::constants::FIXED_DT;

const DEFAULT_FREEZETIME_MS: u32 = 3_000;
const DEFAULT_ROUND_MS: u32 = 115_000;
const DEFAULT_END_MS: u32 = 5_000;

fn freezetime_ms() -> u32 {
    std::env::var("SERVER_FREEZE_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_FREEZETIME_MS)
}

fn round_time_ms() -> u32 {
    std::env::var("SERVER_ROUND_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_ROUND_MS)
}

fn end_delay_ms() -> u32 {
    std::env::var("SERVER_END_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_END_MS)
}

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
}

impl State {
    pub fn new() -> Self {
        Self {
            phase: Phase::Freezetime,
            time_left_ms: freezetime_ms(),
            round_number: 1,
            score_t: 0,
            score_ct: 0,
            winner: None,
        }
    }

    pub fn phase_value(&self) -> u8 {
        match self.phase {
            Phase::Freezetime => 0,
            Phase::Live => 1,
            Phase::Over => 2,
        }
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
                state.time_left_ms = round_time_ms();
                return RoundEvent::WentLive;
            }
            RoundEvent::None
        }
        Phase::Live => {
            let winner = decide_winner(state.time_left_ms, t_alive, ct_alive);
            if let Some(w) = winner {
                state.phase = Phase::Over;
                state.time_left_ms = end_delay_ms();
                state.winner = Some(w);
                if w == 'T' {
                    state.score_t += 1;
                } else {
                    state.score_ct += 1;
                }
                return RoundEvent::RoundOver;
            }
            RoundEvent::None
        }
        Phase::Over => {
            if state.time_left_ms == 0 {
                state.phase = Phase::Freezetime;
                state.time_left_ms = freezetime_ms();
                state.round_number += 1;
                state.winner = None;
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
