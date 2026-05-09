// SPDX-License-Identifier: MIT
//
// OAuth machinery — moved here from `@boringos/connector` when the
// v1 connector framework was deleted. OAuth isn't a "connector"
// concept; it's how the framework brokers tenant credentials for
// any 3rd-party API.
//
// Three pieces:
//   1. `refreshOAuthToken` — exchange a stored refresh token for
//      a fresh access token. v2 connector modules call this when
//      they get a 401 from the upstream API.
//   2. `createOAuthManager` — typed wrapper for the authorize +
//      exchange flow. The connector-routes uses one per provider.
//   3. `createState` / `verifyState` / `isSafeReturnTo` — signed
//      OAuth `state` parameter so the callback can identify the
//      originating tenant + redirect target safely.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ── Types ───────────────────────────────────────────────────────

export interface OAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce?: boolean;
  extraParams?: Record<string, string>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  tokenType?: string;
}

// ── Refresh helper ──────────────────────────────────────────────

const TOKEN_ENDPOINTS: Record<string, string> = {
  google: "https://oauth2.googleapis.com/token",
  slack: "https://slack.com/api/oauth.v2.access",
};

export interface RefreshedToken {
  accessToken: string;
  /** ISO timestamp; absent when the provider didn't return expires_in. */
  expiresAt?: string;
}

/**
 * Exchange a stored refresh token for a fresh access token.
 *
 * Returns null when the refresh fails — caller should fall through to
 * surfacing the original auth error so the user can reconnect.
 *
 * Reads `<KIND>_CLIENT_ID` / `<KIND>_CLIENT_SECRET` from the
 * environment.
 */
export async function refreshOAuthToken(
  providerKind: string,
  refreshToken: string,
): Promise<RefreshedToken | null> {
  const tokenUrl = TOKEN_ENDPOINTS[providerKind];
  if (!tokenUrl) return null;

  const envKind = providerKind.toUpperCase();
  const clientId = process.env[`${envKind}_CLIENT_ID`];
  const clientSecret = process.env[`${envKind}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const accessToken = data.access_token as string | undefined;
    if (!accessToken) return null;
    const expiresIn = data.expires_in as number | undefined;
    return {
      accessToken,
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined,
    };
  } catch {
    return null;
  }
}

// ── Authorize / exchange flow ───────────────────────────────────

export interface OAuthManager {
  getAuthorizationUrl(redirectUri: string, state?: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
}

export function createOAuthManager(
  config: OAuthConfig,
  clientId: string,
  clientSecret: string,
): OAuthManager {
  return {
    getAuthorizationUrl(redirectUri, state) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: config.scopes.join(" "),
        state: state ?? randomBytes(16).toString("hex"),
        ...(config.extraParams ?? {}),
      });
      if (config.pkce) {
        params.set("code_challenge_method", "S256");
      }
      return `${config.authorizationUrl}?${params.toString()}`;
    },

    async exchangeCode(code, redirectUri) {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OAuth token exchange failed (${res.status}): ${text}`);
      }
      return parseTokenResponse((await res.json()) as Record<string, unknown>);
    },

    async refreshTokens(refreshToken) {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OAuth token refresh failed (${res.status}): ${text}`);
      }
      const tokens = parseTokenResponse((await res.json()) as Record<string, unknown>);
      if (!tokens.refreshToken) tokens.refreshToken = refreshToken;
      return tokens;
    },
  };
}

function parseTokenResponse(data: Record<string, unknown>): OAuthTokens {
  const expiresIn = data.expires_in as number | undefined;
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    scope: data.scope as string | undefined,
    tokenType: data.token_type as string | undefined,
  };
}

// ── Signed state for the authorize → callback round-trip ──────

export interface OAuthStatePayload {
  tenantId: string;
  returnTo: string;
  nonce: string;
  iat: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}
function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function createState(
  partial: Omit<OAuthStatePayload, "nonce" | "iat">,
  secret: string,
  now: Date = new Date(),
): string {
  const payload: OAuthStatePayload = {
    ...partial,
    nonce: randomBytes(16).toString("hex"),
    iat: now.getTime(),
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export interface VerifyStateResult {
  ok: boolean;
  payload?: OAuthStatePayload;
  reason?: "malformed" | "bad_signature" | "expired" | "bad_payload";
}

export function verifyState(
  token: string,
  secret: string,
  now: Date = new Date(),
  ttlMs: number = DEFAULT_TTL_MS,
): VerifyStateResult {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadB64, secret);
  let sigOk = false;
  try {
    sigOk = timingSafeEqual(fromB64url(sig), fromB64url(expected));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: "bad_signature" };
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString("utf-8")) as OAuthStatePayload;
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  if (
    typeof payload.tenantId !== "string" ||
    typeof payload.returnTo !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.iat !== "number"
  ) {
    return { ok: false, reason: "bad_payload" };
  }
  if (now.getTime() - payload.iat > ttlMs) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

/**
 * Validate that a returnTo URL is safe to redirect to. Apps should
 * not be able to point this at arbitrary external sites — that's
 * an open redirector. Accept relative paths or same-origin URLs.
 */
export function isSafeReturnTo(raw: string, allowedOrigins: string[]): boolean {
  if (typeof raw !== "string" || raw.length === 0) return false;
  if (raw.startsWith("//")) return false;
  if (raw.startsWith("/")) return true;
  try {
    const u = new URL(raw);
    return allowedOrigins.includes(u.origin);
  } catch {
    return false;
  }
}

// ── Provider table ─────────────────────────────────────────────

/**
 * Connection providers the framework knows how to OAuth against.
 * Replaces the v1 `ConnectorRegistry` walk — there are only ever
 * a handful of OAuth providers, hardcoding them is fine.
 *
 * Adding a new provider:
 *   1. Add an entry here with its OAuth config + scopes
 *   2. Set `<KIND>_CLIENT_ID` + `<KIND>_CLIENT_SECRET` env vars
 *   3. Optionally ship a v2 connector module (Module manifest)
 *      that wraps the HTTP client + tools
 */
export const OAUTH_PROVIDERS: Record<string, OAuthConfig> = {
  google: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar",
      "openid",
      "email",
      "profile",
    ],
    extraParams: { access_type: "offline", prompt: "consent" },
  },
  slack: {
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["chat:write", "channels:read", "groups:read", "reactions:write", "reactions:read"],
  },
};

export type ProviderKind = keyof typeof OAUTH_PROVIDERS;
