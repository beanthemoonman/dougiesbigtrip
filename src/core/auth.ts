/**
 * Keycloak auth adapter — Authorization Code + PKCE (S256), public client,
 * token in memory only.
 *
 * Session survives reload via `check-sso` (silent re-auth against the
 * Keycloak SSO cookie). No token is persisted to localStorage/sessionStorage,
 * both because `CLAUDE.md` forbids assuming web storage and because it is the
 * safer choice.
 *
 * Phase 17.3 — exposes state for the Phase 19 entry screen and Phase 17.4
 * server-side token validation.
 */
import Keycloak from 'keycloak-js';

// ---------------------------------------------------------------------------
// Pure helpers — testable without Keycloak or a browser
// ---------------------------------------------------------------------------

/** Extract the display name from the parsed token claims. */
export function displayNameFromToken(parsed?: { name?: string; preferred_username?: string }): string | undefined {
  return parsed?.name ?? parsed?.preferred_username;
}

/** True when the parsed token carries the `role_admin` realm role. */
export function isAdminFromToken(parsed?: { realm_access?: { roles?: string[] } }): boolean {
  const roles = parsed?.realm_access?.roles ?? [];
  return Array.isArray(roles) && roles.includes('role_admin');
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _instance: Keycloak | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AuthState {
  readonly authenticated: boolean;
  readonly name: string | undefined;
  readonly sub: string | undefined;
  readonly isAdmin: boolean;

  /** The raw access token (JWT), or undefined. */
  token(): string | undefined;

  /** Redirect to Keycloak login (Authorization Code + PKCE). */
  login(): Promise<void>;

  /** Log out of Keycloak and redirect back to the origin. */
  logout(): Promise<void>;
}

/**
 * Initialise the Keycloak adapter and silently re-authenticate if there is an
 * active SSO session. Safe to call when Keycloak is unreachable — the adapter
 * stays unauthenticated and logs a warning.
 *
 * Populates `auth.name`, `auth.sub`, and `auth.isAdmin` from the access token
 * claims.  The token is held only in the `Keycloak` instance (memory); nothing
 * is written to web storage.
 */
export async function initAuth(): Promise<AuthState> {
  if (_instance) throw new Error('initAuth called twice');

  const kc = new Keycloak({
    url: '/auth',
    realm: 'counter-douglas',
    clientId: 'counter-douglas-spa',
  });
  _instance = kc;

  let authenticated = false;
  try {
    authenticated = await kc.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: `${location.origin}/sso-silent.html`,
      pkceMethod: 'S256',
      // ponytail: no session-status iframe. It needs a 3rd-party-cookie probe
      // iframe that dies behind an X-Frame-Options-hardened reverse proxy
      // ("Timeout when waiting for 3rd party check iframe message"), and we
      // don't act on remote logout anyway — token expiry is enough.
      checkLoginIframe: false,
    });
  } catch (err) {
    console.warn('Auth init failed (Keycloak unreachable?):', err);
  }

  return buildState(kc, authenticated);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function buildState(kc: Keycloak, authenticated: boolean): AuthState {
  return {
    authenticated,

    get name(): string | undefined {
      return displayNameFromToken(kc.tokenParsed as { name?: string; preferred_username?: string } | undefined);
    },

    get sub(): string | undefined {
      return kc.tokenParsed?.sub;
    },

    get isAdmin(): boolean {
      return isAdminFromToken(kc.tokenParsed as { realm_access?: { roles?: string[] } } | undefined);
    },

    token(): string | undefined {
      return kc.token;
    },

    async login(): Promise<void> {
      await kc.login({ redirectUri: location.href });
    },

    async logout(): Promise<void> {
      await kc.logout({ redirectUri: location.origin });
    },
  };
}
