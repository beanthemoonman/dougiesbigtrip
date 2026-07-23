//! HTTP admin API — Phase 20.1.
//!
//! Axum router for GET/PUT /api/config, GET /status, on its own port
//! (`API_BIND`). The game WS server keeps its own TCP listener on the game
//! port, including the hand-rolled `GET /status` peek there (an e2e Gate 1
//! pre-dial check depends on it); both now read the same shared config.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use axum::{
    Router,
    extract::State,
    http::{StatusCode, HeaderMap},
    Json,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::db;
use crate::ServerConfig;
use crate::{ACTIVE_HUMANS, SPECTATOR_COUNT};

const MAX_SLOTS: usize = 6;
const MAX_SPECTATORS: usize = 4;

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
    /// True only when auth is disabled *and* the API is bound to loopback —
    /// i.e. a developer running `cargo run` on their own box. Off-box binds
    /// always require an admin JWT, so a stack that forgot `AUTH_REQUIRED=true`
    /// does not hand out an open config-write endpoint. Computed in `main`.
    pub open_admin: bool,
}

pub fn router(state: ApiState) -> Router {
    // No CORS layer: the admin UI reaches this API same-origin (nginx proxies
    // /api/ in production, the vite dev server proxies it in development).
    Router::new()
        .route("/api/config", get(get_config).put(put_config))
        .route("/status", get(get_status))
        .with_state(state)
}

/// Admin gate shared by both /api/config handlers. `Ok(())` = allowed.
///
/// Never holds the config read guard across the (network-touching) token
/// validation: `auth_config` is cloned out and the guard dropped first. Tokio's
/// `RwLock` is write-preferring, so a guard held across a slow JWKS fetch would
/// stall the game loop's own `config.read()` on the player-join path.
async fn require_admin(state: &ApiState, headers: &HeaderMap) -> Result<(), Response> {
    if state.open_admin {
        return Ok(());
    }
    let auth = state.config.read().await.auth_config.clone();
    if !auth.required {
        return Err((
            StatusCode::FORBIDDEN,
            "admin API needs AUTH_REQUIRED=true when bound off-loopback",
        )
            .into_response());
    }

    let token = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, "missing Authorization header").into_response()
        })?;

    match auth::validate_token(token, &auth).await {
        Ok(user) if user.is_admin => Ok(()),
        Ok(_) => Err((StatusCode::FORBIDDEN, "admin role required").into_response()),
        Err(e) => Err((StatusCode::UNAUTHORIZED, format!("invalid token: {e}")).into_response()),
    }
}

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------
async fn get_config(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    if let Err(resp) = require_admin(&state, &headers).await {
        return resp;
    }
    let config = state.config.read().await;
    Json(ConfigPayload {
        bot_count: config.bot_count,
        rounds_to_win: config.rounds_to_win,
        map: config.map.clone(),
    })
    .into_response()
}

// ---------------------------------------------------------------------------
// PUT /api/config
// ---------------------------------------------------------------------------
async fn put_config(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(payload): Json<ConfigPayload>,
) -> Response {
    if let Err(resp) = require_admin(&state, &headers).await {
        return resp;
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

    let new_config = match result {
        Ok(c) => c,
        Err(errors) => return (StatusCode::BAD_REQUEST, errors.join("; ")).into_response(),
    };

    // Persist first: a 200 must mean the change survives a restart.
    if let Some(ref pool) = state.pool
        && let Err(e) = db::update_config(
            pool,
            new_config.bot_count as i32,
            &new_config.map,
            new_config.rounds_to_win as i32,
        )
        .await
    {
        eprintln!("admin config persist failed: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "failed to persist config").into_response();
    }

    // Update the shared config; the game loop applies it at the next round reset.
    let mut c = state.config.write().await;
    c.bot_count = new_config.bot_count;
    c.rounds_to_win = new_config.rounds_to_win;
    c.map = new_config.map.clone();

    Json(ConfigPayload {
        bot_count: c.bot_count,
        rounds_to_win: c.rounds_to_win,
        map: c.map.clone(),
    })
    .into_response()
}

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------
async fn get_status(State(state): State<ApiState>) -> impl IntoResponse {
    let config = state.config.read().await;
    let json = serde_json::json!({
        "players": ACTIVE_HUMANS.load(Ordering::Relaxed),
        "maxPlayers": MAX_SLOTS,
        "spectators": SPECTATOR_COUNT.load(Ordering::Relaxed),
        "specCap": MAX_SPECTATORS,
        "botCount": config.bot_count,
        "roundsToWin": config.rounds_to_win,
        "map": config.map,
    });
    (StatusCode::OK, Json(json))
}

/// Serve the HTTP API. Returns on bind/serve failure instead of panicking a
/// detached task — the caller logs it and the game server stays up.
pub async fn serve(bind: std::net::SocketAddr, state: ApiState) {
    let listener = match tokio::net::TcpListener::bind(bind).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("HTTP API disabled: cannot bind {bind}: {e}");
            return;
        }
    };
    println!("HTTP API listening on http://{bind}");
    if let Err(e) = axum::serve(listener, router(state)).await {
        eprintln!("HTTP API stopped: {e}");
    }
}

#[cfg(test)]
mod gate_tests {
    use super::*;
    use crate::auth::AuthConfig;

    /// `open_admin=false` + auth disabled must REFUSE, not fall through open.
    /// This is the whole reason `open_admin` exists: a stack that forgot
    /// `AUTH_REQUIRED=true` used to expose an unauthenticated config write.
    fn state(open_admin: bool) -> ApiState {
        let cfg = crate::validate_config(
            "127.0.0.1:9876".into(),
            "0.0.0.0:9877".into(),
            6,
            16,
            "de_douglas".into(),
            5000,
            60000,
            3000,
            AuthConfig {
                required: false,
                issuer: String::new(),
                audience: String::new(),
                jwks_url: String::new(),
            },
        )
        .expect("valid config");
        ApiState {
            config: Arc::new(tokio::sync::RwLock::new(cfg)),
            pool: None,
            open_admin,
        }
    }

    #[tokio::test]
    async fn auth_off_and_bound_off_loopback_is_refused() {
        let res = require_admin(&state(false), &HeaderMap::new()).await;
        let resp = res.expect_err("must refuse");
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn auth_off_on_loopback_is_allowed() {
        assert!(require_admin(&state(true), &HeaderMap::new()).await.is_ok());
    }

    #[tokio::test]
    async fn auth_on_without_header_is_unauthorized() {
        let st = state(false);
        st.config.write().await.auth_config.required = true;
        let resp = require_admin(&st, &HeaderMap::new()).await.expect_err("must refuse");
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}
