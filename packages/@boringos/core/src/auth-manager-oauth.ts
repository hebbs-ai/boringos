// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Low-level OAuth helpers for AuthManager.
//
// Only the refresh leg lives here. The authorize/exchange leg (startOAuthFlow,
// handleOAuthCallback) comes in Task 2.3.

import type { OAuth2Strategy } from "@boringos/module-sdk";

export interface RefreshedToken {
  accessToken: string;
  /** Unix epoch milliseconds when the token expires. */
  expiresAt: number;
  /** Updated refresh token, if the provider rotated it. */
  refreshToken?: string;
}

/**
 * Exchange a stored refresh token for a fresh access token.
 *
 * Throws on any HTTP error or missing access_token in the response. The
 * caller is responsible for catching and auditing the failure.
 *
 * The `fetchImpl` parameter exists solely for unit-test injection.
 */
export async function exchangeRefreshToken(
  strategy: OAuth2Strategy,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshedToken> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetchImpl(strategy.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!body.access_token) {
    throw new Error("Token refresh response missing access_token");
  }
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    refreshToken: body.refresh_token,
  };
}
