//! Bot AI module — data model, perception, aiming, and FSM.
//! Phase E.2 — moved from server/src/ai.rs into sim/ for WASM-share.

pub mod aim;
pub mod bot;
pub mod brain;
pub mod perception;

pub use aim::hash01;
pub use bot::{Bot, BotMode, CautionPhase, SearchState};
pub use brain::tick_bot;
