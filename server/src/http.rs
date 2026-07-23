//! HTTP admin API — Phase 20.1.
//!
//! Axum router for GET/PUT /api/config, GET /status.
//! Replaces the hand-rolled /status peek (the game WS server still handles
//! its own TCP listener on the game port).

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use axum::{
    Router,
    extract::State,
    http::{StatusCode, HeaderMap},
    Json,
    response::IntoResponse,
    routing::get,
};
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::db;
use crate::ServerConfig;

const MAX_SLOTS: usize = 6;
const MAX_SPECTATORS: usize = 4;

/// Thin wrapper around the game-loop-owned atomic counters.
pub struct ServerCounters {
    active_humans: &'static AtomicU8,
    spectators: &'static AtomicU8,
}

impl ServerCounters {
    pub fn new(
        active_humans: &'static AtomicU8,
        spectators: &'static AtomicU8,
    ) -> Self {
        Self { active_humans, spectators }
    }

    pub fn active_humans(&self) -> u8 {
        self.active_humans.load(Ordering::Relaxed)
    }

    pub fn spectators(&self) -> u8 {
        self.spectators.load(Ordering::Relaxed)
    }
}

/// The subset of config exposed over the API.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigPayload {
    #[serde(rename = "botCount")]
    pub bot_count: usize,
    #[serde(rename = "roundsToWin")]
    pub rounds_to_win: u8,
    pub map: String,
}

/// Shared state held by the axum router.
#[derive(Clone)]
pub struct ApiState {
    pub config: Arc<tokio::sync::RwLock<ServerConfig>>,
    pub pool: Option<sqlx::PgPool>,
    pub counters: Arc<ServerCounters>,
}

pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/api/config", get(get_config).put(put_config))
        .route("/status", get(get_status))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------
async fn get_config(State(state): State<ApiState>) -> impl IntoResponse {
    let config = state.config.read().await;
    Json(ConfigPayload {
        bot_count: config.bot_count,
        rounds_to_win: config.rounds_to_win,
        map: config.map.clone(),
    })
}

// ---------------------------------------------------------------------------
// PUT /api/config
// ---------------------------------------------------------------------------
async fn put_config(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(payload): Json<ConfigPayload>,
) -> impl IntoResponse {
    // Admin gate: only role_admin.
    if !state.config.read().await.auth_config.required {
        // Auth not required — allow anyone (dev mode).
    } else {
        let token = headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        match token {
            Some(t) => {
                let auth = &state.config.read().await.auth_config;
                match auth::validate_token(t, auth).await {
                    Ok(user) if user.is_admin => { /* allowed */ }
                    Ok(_) => {
                        return (StatusCode::FORBIDDEN, "admin role required").into_response();
                    }
                    Err(e) => {
                        return (StatusCode::UNAUTHORIZED, format!("invalid token: {e}")).into_response();
                    }
                }
            }
            None => {
                return (StatusCode::UNAUTHORIZED, "missing Authorization header").into_response();
            }
        }
    }

    // Validate the payload against the same config bounds.
    let current = state.config.read().await;
    let result = crate::validate_config(
        current.bind.clone(),
        current.api_bind.clone(),
        payload.bot_count,
        payload.rounds_to_win,
        payload.map.clone(),
        current.freezetime_ms,
        current.round_time_ms,
        current.end_delay_ms,
        current.auth_config.clone(),
    );
    drop(current);

    match result {
        Ok(new_config) => {
            // Persist to the database (if available).
            if let Some(ref pool) = state.pool {
                let _ = db::update_config(
                    pool,
                    new_config.bot_count as i32,
                    &new_config.map,
                    new_config.rounds_to_win as i32,
                )
                .await;
            }

            // Update the shared config so the game loop picks it up next match.
            let mut c = state.config.write().await;
            c.bot_count = new_config.bot_count;
            c.rounds_to_win = new_config.rounds_to_win;
            c.map = new_config.map.clone();

            let resp = ConfigPayload {
                bot_count: c.bot_count,
                rounds_to_win: c.rounds_to_win,
                map: c.map.clone(),
            };

            Json(resp).into_response()
        }
        Err(errors) => {
            (StatusCode::BAD_REQUEST, errors.join("; ")).into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------
async fn get_status(State(state): State<ApiState>) -> impl IntoResponse {
    let config = state.config.read().await;
    let json = serde_json::json!({
        "players": state.counters.active_humans(),
        "maxPlayers": MAX_SLOTS,
        "spectators": state.counters.spectators(),
        "specCap": MAX_SPECTATORS,
        "botCount": config.bot_count,
        "roundsToWin": config.rounds_to_win,
        "map": config.map,
    });
    (StatusCode::OK, Json(json))
}

/// Spawn the axum HTTP server on the given bind address.
pub async fn serve(bind: std::net::SocketAddr, state: ApiState) {
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(bind).await.expect("api bind");
    println!("HTTP API listening on http://{}", bind);
    axum::serve(listener, app).await.unwrap();
}

