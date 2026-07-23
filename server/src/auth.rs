//! Keycloak JWT validation — Phase 17.4.
//!
//! Verifies access-token signature against the realm JWKS (cached), checks
//! `exp`/`iss`/`aud`, and extracts `sub`/`name`/`is_admin`.  When
//! `AUTH_REQUIRED` is false every connection is an anonymous non-admin —
//! validation is never called.
//!
//! See docs/plan-post-1.0-config-auth.md §17.4 and the cross-cutting decision
//! "token validation" at the top of that doc.

use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

// ---------------------------------------------------------------------------
// JWKS cache
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct JwkKey {
    kid: String,
    kty: String,
    alg: Option<String>,
    n: String,
    e: String,
}

#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

/// How long a fetched JWKS is trusted before we refresh it.
const JWKS_TTL: Duration = Duration::from_secs(900);
/// Minimum gap between refetches, so a token with a bogus `kid` can't be used
/// to hammer Keycloak with one JWKS request per connection attempt.
const JWKS_REFETCH_COOLDOWN: Duration = Duration::from_secs(60);

struct JwksCacheInner {
    /// kid → pre-built DecodingKey (so we don't rebuild on every validation).
    keys: HashMap<String, DecodingKey>,
    fetched_at: Instant,
}

static JWKS: LazyLock<RwLock<Option<JwksCacheInner>>> = LazyLock::new(|| RwLock::new(None));

async fn fetch_jwks(url: &str) -> Result<JwksCacheInner, String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("jwks fetch failed: {e}"))?;
    let jwks: JwksResponse = resp
        .json()
        .await
        .map_err(|e| format!("jwks parse failed: {e}"))?;

    let mut keys = HashMap::new();
    for k in &jwks.keys {
        let dk = DecodingKey::from_rsa_components(&k.n, &k.e)
            .map_err(|e| format!("bad jwk key {}: {e}", k.kid))?;
        keys.insert(k.kid.clone(), dk);
    }
    if keys.is_empty() {
        return Err("jwks returned no keys".into());
    }
    Ok(JwksCacheInner { keys, fetched_at: Instant::now() })
}

/// Look up the decoding key for `kid`, refetching the JWKS if the cache is
/// cold, past its TTL, or missing that kid (Keycloak rotated its signing key).
///
/// ponytail: the refetch happens inline on the caller's task, so a rotation
/// stalls one game tick for as long as the JWKS request takes. Move it to a
/// background refresh task if that stall ever shows up in a tick histogram.
async fn key_for_kid(kid: &str, config: &AuthConfig) -> Result<DecodingKey, String> {
    {
        let guard = JWKS.read().await;
        if let Some(cache) = guard.as_ref() {
            if cache.fetched_at.elapsed() < JWKS_TTL {
                if let Some(key) = cache.keys.get(kid) {
                    return Ok(key.clone());
                }
            }
        }
    }

    // Cache is cold, stale, or doesn't know this kid → refetch under the write
    // lock, which also serialises concurrent misses into a single request.
    let mut guard = JWKS.write().await;
    if let Some(cache) = guard.as_ref() {
        if cache.fetched_at.elapsed() < JWKS_REFETCH_COOLDOWN {
            return cache
                .keys
                .get(kid)
                .cloned()
                .ok_or_else(|| format!("kid '{kid}' not in jwks"));
        }
    }
    let fresh = fetch_jwks(&config.jwks_url).await?;
    let key = fresh.keys.get(kid).cloned();
    *guard = Some(fresh);
    key.ok_or_else(|| format!("kid '{kid}' not in jwks"))
}

// ---------------------------------------------------------------------------
// Claims & validated token
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct RealmAccess {
    roles: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct Claims {
    sub: Option<String>,
    name: Option<String>,
    preferred_username: Option<String>,
    exp: usize,
    iss: Option<String>,
    aud: Option<serde_json::Value>, // can be string or array
    realm_access: Option<RealmAccess>,
}

/// The result of a successful token validation.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ValidatedUser {
    pub sub: String,
    pub name: Option<String>,
    pub is_admin: bool,
}

/// Auth configuration sourced from env vars.
#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub required: bool,
    pub issuer: String,
    pub audience: String,
    pub jwks_url: String,
}

/// `AUTH_REQUIRED` is opt-in: anything but `true`/`1` — including unset — means
/// the dev path where every connection is an anonymous non-admin.
fn parse_required(v: Option<&str>) -> bool {
    matches!(v, Some("true") | Some("1"))
}

impl AuthConfig {
    pub fn from_env() -> Self {
        let required = parse_required(std::env::var("AUTH_REQUIRED").ok().as_deref());

        // Issuer: the realm's issuer URL. Default for the compose stack is
        // constructed from KC_HOSTNAME, which nginx proxies at /auth.
        let issuer = std::env::var("AUTH_ISSUER").unwrap_or_else(|_| {
            // When KC_HOSTNAME is set, derive issuer from it. Otherwise
            // default to the compose-internal URL (auth:8080 with /auth).
            let host = std::env::var("KC_HOSTNAME").unwrap_or_else(|_| {
                "https://localhost:8443/auth".into()
            });
            // KC_HOSTNAME may end with /auth; strip it before appending.
            let base = host.strip_suffix("/auth").unwrap_or(&host);
            format!("{base}/auth/realms/counter-douglas")
        });

        // JWKS URL: where to fetch the realm's public keys.
        let jwks_url = std::env::var("AUTH_JWKS_URL").unwrap_or_else(|_| {
            "http://auth:8080/auth/realms/counter-douglas/protocol/openid-connect/certs".into()
        });

        // Audience: the client ID in the realm. The access token's `aud`
        // claim may contain this.
        let audience = std::env::var("AUTH_AUDIENCE")
            .unwrap_or_else(|_| "counter-douglas-spa".into());

        Self { required, issuer, audience, jwks_url }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Signature/claim checks applied to every token. Kept separate so the policy
/// is testable without a live JWKS — `aud` in particular, where accepting the
/// realm-wide `account` audience would let a token minted for any other client
/// in the realm through.
fn validation_for(config: &AuthConfig) -> Validation {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[&config.issuer]);
    validation.set_audience(&[&config.audience]);
    validation.leeway = 30;
    validation
}

/// Map verified claims onto the user record. Pure — signature and `exp`/`iss`/
/// `aud` have already been checked by the time this runs.
fn user_from_claims(claims: Claims) -> Result<ValidatedUser, String> {
    let sub = claims.sub.ok_or_else(|| "token missing sub".to_string())?;
    let name = claims.name.or(claims.preferred_username);
    let is_admin = claims
        .realm_access
        .as_ref()
        .map(|ra| ra.roles.iter().any(|r| r == "role_admin"))
        .unwrap_or(false);
    Ok(ValidatedUser { sub, name, is_admin })
}

/// Validate a JWT access token against the Keycloak realm.
///
/// Reads the cached JWKS, refetching it when the cache is cold, stale, or the
/// realm has rotated its signing key (see `key_for_kid`).
///
/// Returns `Err(reason)` for any failure — expired, bad signature, wrong
/// issuer, wrong audience, missing `sub`.  The caller sends a `Bye` with
/// the reason and closes the connection.
pub async fn validate_token(token: &str, config: &AuthConfig) -> Result<ValidatedUser, String> {
    let header = decode_header(token).map_err(|e| format!("invalid token header: {e}"))?;
    let kid = header.kid.ok_or_else(|| "token missing kid".to_string())?;
    let decoding_key = key_for_kid(&kid, config).await?;

    let token_data = decode::<Claims>(token, &decoding_key, &validation_for(config))
        .map_err(|e| format!("token validation failed: {e}"))?;

    user_from_claims(token_data.claims)
}

/// Prefetch the realm JWKS at startup. Not required for correctness —
/// `validate_token` fetches on demand — but it keeps the first authenticated
/// join off the network path. Safe to call unconditionally.
pub async fn prefetch_jwks(config: &AuthConfig) {
    if !config.required {
        return;
    }
    match fetch_jwks(&config.jwks_url).await {
        Ok(cache) => {
            let mut guard = JWKS.write().await;
            *guard = Some(cache);
            println!("jwks prefetched from {}", config.jwks_url);
        }
        Err(e) => {
            eprintln!("jwks prefetch failed: {e} — will retry on the first join");
        }
    }
}

// ---------------------------------------------------------------------------
// Tests — fixture tokens
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(sub: Option<&str>, name: Option<&str>, uname: Option<&str>, roles: &[&str]) -> Claims {
        Claims {
            sub: sub.map(str::to_string),
            name: name.map(str::to_string),
            preferred_username: uname.map(str::to_string),
            exp: 0,
            iss: None,
            aud: None,
            realm_access: Some(RealmAccess {
                roles: roles.iter().map(|r| r.to_string()).collect(),
            }),
        }
    }

    fn cfg() -> AuthConfig {
        AuthConfig {
            required: true,
            issuer: "https://example/auth/realms/counter-douglas".into(),
            audience: "counter-douglas-spa".into(),
            jwks_url: "http://auth:8080/certs".into(),
        }
    }

    #[test]
    fn role_admin_grants_admin() {
        let u = user_from_claims(claims(Some("u1"), Some("Doug"), None, &["role_admin"])).unwrap();
        assert_eq!(u.sub, "u1");
        assert_eq!(u.name.as_deref(), Some("Doug"));
        assert!(u.is_admin);
    }

    #[test]
    fn other_roles_do_not_grant_admin() {
        let u = user_from_claims(claims(Some("u2"), None, None, &["role_player", "admin"])).unwrap();
        assert!(!u.is_admin);
    }

    #[test]
    fn missing_realm_access_is_not_admin() {
        let mut c = claims(Some("u3"), None, None, &[]);
        c.realm_access = None;
        assert!(!user_from_claims(c).unwrap().is_admin);
    }

    #[test]
    fn name_falls_back_to_preferred_username() {
        let u = user_from_claims(claims(Some("u4"), None, Some("dougy"), &[])).unwrap();
        assert_eq!(u.name.as_deref(), Some("dougy"));
    }

    #[test]
    fn missing_sub_is_rejected() {
        assert!(user_from_claims(claims(None, Some("Doug"), None, &[])).is_err());
    }

    // The validation policy itself — these are the checks a bad config would
    // silently drop, so assert them rather than trusting the constructor.

    #[test]
    fn validation_requires_rs256() {
        assert_eq!(validation_for(&cfg()).algorithms, vec![Algorithm::RS256]);
    }

    #[test]
    fn validation_pins_issuer_and_expiry() {
        let v = validation_for(&cfg());
        assert!(v.validate_exp);
        assert_eq!(
            v.iss,
            Some(["https://example/auth/realms/counter-douglas".to_string()].into_iter().collect())
        );
    }

    #[test]
    fn validation_accepts_only_the_configured_audience() {
        // Regression: accepting Keycloak's realm-wide "account" audience would
        // admit tokens minted for any other client in the realm.
        let v = validation_for(&cfg());
        let aud = v.aud.expect("audience must be validated");
        assert_eq!(aud, ["counter-douglas-spa".to_string()].into_iter().collect());
    }

    #[test]
    fn auth_required_is_opt_in() {
        // Unset is the documented dev path; only an explicit true/1 enables it.
        assert!(!parse_required(None));
        assert!(!parse_required(Some("")));
        assert!(!parse_required(Some("false")));
        assert!(parse_required(Some("true")));
        assert!(parse_required(Some("1")));
    }
}
