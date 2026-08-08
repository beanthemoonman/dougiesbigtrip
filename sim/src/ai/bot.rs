//! Bot data model: Bot struct, BotMode enum, SearchState, and tuning constants.
//! Phase E.2 — extracted from server/src/ai.rs into sim/ for WASM-share.

pub(crate) const SIGHT_RANGE: f64 = 40.0;
pub(crate) const SIGHT_HALF_FOV_COS: f64 = 0.258819; // cos(75°)
pub(crate) const WAYPOINT_RADIUS: f64 = 0.6;
pub(crate) const TURN_RATE: f64 = 6.0; // rad/s — normal difficulty
pub(crate) const REACTION_TIME: f64 = 0.5; // s
pub(crate) const LOSE_MEMORY: f64 = 4.0; // s

/// How many ticks a node stays "recently visited" for the search-spread bonus.
pub(crate) const VISIT_RECENCY_TICKS: u32 = 64 * 8; // ~8 s at 64 Hz

/// Weights for the search-goal selection metric. Bots spread out from teammates
/// and avoid nodes that were recently visited by anyone on the team.
/// Same-pole repulsion: every teammate pushes on nearby nodes as 1/(1+d). Was a
/// "distance to nearest teammate" bonus, which always crowned the one globally
/// farthest node — every bot then ran the identical route to it.
pub(crate) const W_REPEL: f64 = 60.0;
pub(crate) const W_RECENCY: f64 = 2.0;
/// Deterministic per-pick jitter, ~3x the tactical spread: tactical nodes stay
/// favoured, but low-weight ones still come up so routes vary run to run.
pub(crate) const W_RANDOM: f64 = 80.0;
/// Per-node tactical weight multiplier. Curve/flank nodes are high, spine/killbox
/// nodes are low.
pub(crate) const W_TACTICAL: f64 = 10.0;
/// Penalty per teammate who already has this node as their active path goal.
/// Gently encourages bots to pick different nodes rather than converging.
pub(crate) const W_GOAL_CONFLICT: f64 = 20.0;

/// Caution: bots in search mode pause to scan every few seconds instead of
/// rushing between nodes. Move for ~2.5 s, then stop ± scan for ~1.5 s.
pub(crate) const CAUTION_MOVE_TICKS: u32 = 64 * 5 / 2;  // 2.5 s
pub(crate) const CAUTION_PAUSE_TICKS: u32 = 64 * 3 / 2; // 1.5 s
/// Per-bot tick variation so bots don't pause in lockstep.
pub(crate) const CAUTION_JITTER: u32 = 64; // ±1 s variation

/// Slow-scan yaw rate during caution pauses (rad/s).
pub(crate) const SCAN_RATE: f64 = 1.0;

/// Fire gate: both yaw and pitch must be within this (rad) of target before shooting.
pub(crate) const FIRE_TOL: f64 = 0.05;

/// Aim error radius (m) — per-acquisition offset cube half-extent. Normal difficulty.
pub(crate) const ERROR_RADIUS: f64 = 0.3;

/// Bot aim spread angular half-extent (rad), matches BOT_AIM_SPREAD in TS.
pub const BOT_AIM_SPREAD: f64 = 0.06;

/// Unsticking. Breakable props are not in the nav graph, so a hop can run
/// straight through a crate. Rather than teach nav about props, detect
/// "pressing FORWARD, going nowhere" and strafe out of it, like a human does.
/// Below this per-tick horizontal displacement (m) the bot counts as blocked.
pub(crate) const STUCK_STEP: f64 = 0.015;
pub(crate) const STUCK_TICKS: u32 = 24;
pub(crate) const SIDESTEP_TICKS: u32 = 32;
/// Two failed sidesteps in a row → treat the goal as unreachable and re-pick.
pub(crate) const STUCK_STRIKES: u32 = 2;

/// In search mode, bots walk at a reduced duty cycle (press FORWARD only 3 of
/// every 4 ticks) so they move at roughly 50-60% of their normal ground speed.
pub(crate) const SEARCH_DUTY_ON: u32 = 3;
pub(crate) const SEARCH_DUTY_PERIOD: u32 = 4;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BotMode {
    Search,
    Engage,
    Reposition,
    Dead,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CautionPhase {
    Moving,
    Pausing,
}

pub struct Bot {
    pub mode: BotMode,
    pub yaw: f64,
    pub aim_yaw: f64,
    pub aim_pitch: f64,
    pub target_slot: Option<usize>,
    pub last_known: Option<nalgebra::Vector3<f64>>,
    pub reaction_timer: f64,
    pub lost_timer: f64,
    /// Time until the bot may fire its weapon again (seconds). Decremented each
    /// tick; the loop in main.rs synthesises a Shot only when this reaches zero.
    pub fire_cooldown: f64,
    /// Graph node the bot is currently walking toward (the next hop in a path).
    pub path_goal_node: usize,
    /// Graph node the bot is currently at (nearest node to its position last frame).
    pub current_node: usize,
    pub caution_timer: u32,
    pub caution_phase: CautionPhase,
    /// Deterministic per-bot tick offset for de-synchronising caution timers.
    pub tick_offset: u32,
    /// Stuck detector: position last tick + how long we've been going nowhere.
    pub last_x: f64,
    pub last_z: f64,
    pub stuck_ticks: u32,
    pub sidestep_ticks: u32,
    /// Buttons::LEFT or Buttons::RIGHT while sidestepping, 0 otherwise.
    pub sidestep_dir: u16,
    pub stuck_strikes: u32,
    /// Per-acquisition aim error offset (m) in world space, added to target position.
    /// Set once on target acquisition and held until the target is lost.
    pub error_offset: nalgebra::Vector3<f64>,
    /// Set by brain each tick: true when reaction done AND aim is on-target.
    /// Consumed by the fire loop in main.rs (resets after synthesising a Shot).
    pub should_fire: bool,
    /// Smoothed navmesh route to `path_goal_node`, world-space waypoints.
    /// Empty means "no route computed yet, or the mesh had none" — the brain
    /// then falls back to a nav-graph hop.
    pub path: Vec<[f32; 3]>,
    /// Index of the waypoint in `path` currently being walked toward.
    pub path_idx: usize,
    /// The goal the cached `path` was computed for. When this stops matching
    /// `path_goal_node` the route is stale and gets recomputed.
    pub path_for_node: usize,
}

impl Bot {
    pub fn new(start_node: usize, tick_offset: u32) -> Self {
        let base_move = CAUTION_MOVE_TICKS + (tick_offset % CAUTION_JITTER);
        Self {
            mode: BotMode::Search,
            yaw: 0.0,
            aim_yaw: 0.0,
            aim_pitch: 0.0,
            target_slot: None,
            last_known: None,
            reaction_timer: 0.0,
            lost_timer: 0.0,
            fire_cooldown: 0.0,
            path_goal_node: start_node,
            current_node: start_node,
            caution_timer: base_move,
            caution_phase: CautionPhase::Moving,
            tick_offset,
            last_x: f64::MAX,
            last_z: f64::MAX,
            stuck_ticks: 0,
            sidestep_ticks: 0,
            sidestep_dir: 0,
            stuck_strikes: 0,
            error_offset: nalgebra::Vector3::zeros(),
            should_fire: false,
            path: Vec::new(),
            path_idx: 0,
            path_for_node: usize::MAX, // no route yet
        }
    }
}

/// Shared search state across all bots: per-node last-visited tick.
/// Maps a node index → server tick when any bot last arrived at it.
pub struct SearchState {
    pub last_visited: Vec<u32>,
}

impl SearchState {
    pub fn new(node_count: usize) -> Self {
        Self { last_visited: vec![0; node_count] }
    }
}
