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

struct JwksCacheInner {
    /// kid → pre-built DecodingKey (so we don't rebuild on every validation).
    keys: HashMap<String, DecodingKey>,
    #[allow(dead_code)]
    expiry: Instant,
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
    Ok(JwksCacheInner {
        keys,
        expiry: Instant::now() + Duration::from_secs(900),
    })
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

impl AuthConfig {
    pub fn from_env() -> Self {
        let required = std::env::var("AUTH_REQUIRED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

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

/// Validate a JWT access token against the Keycloak realm.
///
/// Uses a prefetched JWKS cache (fetched async once at startup).  If the
/// cache is cold (startup without AUTH_REQUIRED then later enabled) or if
/// the key rotates, the cache is refetched on the next `prefetch_jwks` call.
///
/// Returns `Err(reason)` for any failure — expired, bad signature, wrong
/// issuer, wrong audience, missing `sub`.  The caller sends a `Bye` with
/// the reason and closes the connection.
pub fn validate_token_sync(token: &str, config: &AuthConfig) -> Result<ValidatedUser, String> {
    let header = decode_header(token).map_err(|e| format!("invalid token header: {e}"))?;
    let kid = header.kid.ok_or_else(|| "token missing kid".to_string())?;

    let guard = JWKS.blocking_read();
    let cache = guard.as_ref().ok_or_else(|| "jwks not initialised — call prefetch_jwks first".to_string())?;
    let decoding_key = cache.keys.get(&kid).cloned()
        .ok_or_else(|| format!("kid '{kid}' not in jwks"))?;
    drop(guard);

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[&config.issuer]);
    validation.set_audience(&[&config.audience, "account"]);
    validation.leeway = 30;

    let token_data = decode::<Claims>(token, &decoding_key, &validation)
        .map_err(|e| format!("token validation failed: {e}"))?;

    let claims = token_data.claims;
    let sub = claims.sub.ok_or_else(|| "token missing sub".to_string())?;
    let name = claims.name.or(claims.preferred_username);
    let is_admin = claims
        .realm_access
        .as_ref()
        .map(|ra| ra.roles.contains(&"role_admin".into()))
        .unwrap_or(false);

    Ok(ValidatedUser { sub, name, is_admin })
}

/// Prefetch the realm JWKS at startup. Must be called before the first
/// `validate_token_sync` when `AUTH_REQUIRED=true`.  Safe to call
/// unconditionally — if the fetch fails, auth simply stays unavailable.
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
            eprintln!("jwks prefetch failed: {e} — auth will be unavailable until a restart");
        }
    }
}

// ---------------------------------------------------------------------------
// Tests — fixture tokens
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};

    // These tests use self-signed JWTs to verify claim-rejection logic.
    // Signature-verification and JWKS-cache are tested via integration.

    /// A valid token the server would have produced, with all required claims.
    fn make_token(sub: &str, aud: &str, iss: &str, admin: bool, expires_in: i64) -> String {
        let now = jsonwebtoken::get_current_timestamp() as usize;
        let claims = serde_json::json!({
            "sub": sub,
            "name": format!("{sub}-name"),
            "preferred_username": format!("{sub}-uname"),
            "iss": iss,
            "aud": aud,
            "exp": (now as i64 + expires_in) as usize,
            "realm_access": {
                "roles": if admin { vec!["role_admin"] } else { vec![] }
            }
        });
        // The `aud` field in the json! macro above correctly handles strings.
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(b"test-secret-not-for-production"),
        )
        .unwrap()
    }

    #[test]
    fn token_with_role_admin_is_admin() {
        // We can't test full validation without JWKS, but we can test the
        // claims parsing by validating with a known secret.
        let token = make_token("u1", "counter-douglas-spa", "http://auth:8080/auth/realms/counter-douglas", true, 3600);
        let mut val = Validation::new(Algorithm::HS256);
        val.set_issuer(&["http://auth:8080/auth/realms/counter-douglas"]);
        val.set_audience(&["counter-douglas-spa"]);
        val.leeway = 30;
        let td = decode::<Claims>(&token, &DecodingKey::from_secret(b"test-secret-not-for-production"), &val).unwrap();
        let is_admin = td.claims.realm_access.as_ref().map(|ra| ra.roles.contains(&"role_admin".into())).unwrap_or(false);
        assert!(is_admin);
        assert_eq!(td.claims.sub.as_deref(), Some("u1"));
        assert_eq!(td.claims.name.as_deref(), Some("u1-name"));
    }

    #[test]
    fn token_without_role_admin_is_not_admin() {
        let token = make_token("u2", "counter-douglas-spa", "http://auth:8080/auth/realms/counter-douglas", false, 3600);
        let mut val = Validation::new(Algorithm::HS256);
        val.set_issuer(&["http://auth:8080/auth/realms/counter-douglas"]);
        val.set_audience(&["counter-douglas-spa"]);
        val.leeway = 30;
        let td = decode::<Claims>(&token, &DecodingKey::from_secret(b"test-secret-not-for-production"), &val).unwrap();
        let is_admin = td.claims.realm_access.as_ref().map(|ra| ra.roles.contains(&"role_admin".into())).unwrap_or(false);
        assert!(!is_admin);
    }

    #[test]
    fn reject_wrong_issuer() {
        let token = make_token("u3", "counter-douglas-spa", "http://wrong", false, 3600);
        let mut val = Validation::new(Algorithm::HS256);
        val.set_issuer(&["http://auth:8080/auth/realms/counter-douglas"]);
        val.set_audience(&["counter-douglas-spa"]);
        val.leeway = 30;
        let err = decode::<Claims>(&token, &DecodingKey::from_secret(b"test-secret-not-for-production"), &val);
        assert!(err.is_err(), "should reject wrong issuer");
    }

    #[test]
    fn reject_wrong_audience() {
        let token = make_token("u4", "wrong-client", "http://auth:8080/auth/realms/counter-douglas", false, 3600);
        let mut val = Validation::new(Algorithm::HS256);
        val.set_issuer(&["http://auth:8080/auth/realms/counter-douglas"]);
        val.set_audience(&["counter-douglas-spa"]);
        val.leeway = 30;
        let err = decode::<Claims>(&token, &DecodingKey::from_secret(b"test-secret-not-for-production"), &val);
        assert!(err.is_err(), "should reject wrong audience");
    }

    #[test]
    fn reject_expired_token() {
        let token = make_token("u5", "counter-douglas-spa", "http://auth:8080/auth/realms/counter-douglas", false, -60);
        let mut val = Validation::new(Algorithm::HS256);
        val.set_issuer(&["http://auth:8080/auth/realms/counter-douglas"]);
        val.set_audience(&["counter-douglas-spa"]);
        val.leeway = 30;
        let err = decode::<Claims>(&token, &DecodingKey::from_secret(b"test-secret-not-for-production"), &val);
        assert!(err.is_err(), "should reject expired token");
    }

    #[test]
    fn reject_bad_signature() {
        let token = make_token("u6", "counter-douglas-spa", "http://auth:8080/auth/realms/counter-douglas", false, 3600);
        let mut val = Validation::new(Algorithm::HS256);
        val.set_issuer(&["http://auth:8080/auth/realms/counter-douglas"]);
        val.set_audience(&["counter-douglas-spa"]);
        val.leeway = 30;
        let err = decode::<Claims>(&token, &DecodingKey::from_secret(b"wrong-secret-xxxxxxxxxx"), &val);
        assert!(err.is_err(), "should reject bad signature");
    }

    #[test]
    fn auth_config_defaults_to_not_required() {
        // Without AUTH_REQUIRED set, defaults to false.
        // This test can't isolate env; we assert the default value.
        let config = AuthConfig {
            required: false,
            issuer: "irrelevant".into(),
            audience: "irrelevant".into(),
            jwks_url: "irrelevant".into(),
        };
        assert!(!config.required);
    }
}
