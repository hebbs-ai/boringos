// SPDX-License-Identifier: AGPL-3.0-or-later
//
// HMAC-signed OAuth state payloads used by AuthManager's OAuth dance.
// Carries tenantId + provider + scopes so the callback can reconstruct
// the full context without any server-side session storage.
//
// Payload shape differs from oauth.ts (which carries returnTo/iat) --
// kept separate intentionally. Task 2.10 removes oauth.ts entirely;
// until then both coexist.
//
// TTL: 10 minutes. Absolute expiry stored as `exp` (epoch ms).

import { createHmac, randomBytes } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

export interface StatePayload {
  tenantId: string;
  provider: string;
  scopes: string[];
  nonce: string;
  exp: number;
}

/**
 * Create a signed, base64url-encoded OAuth state token.
 *
 * @param secret  HMAC secret (pass via AuthManager constructor, resolved from config.auth.secret in Task 2.4).
 * @param payload Fields the callback needs; nonce and exp are injected automatically.
 */
export function createState(
  secret: string,
  payload: Omit<StatePayload, "nonce" | "exp">,
): string {
  const full: StatePayload = {
    ...payload,
    nonce: randomBytes(16).toString("hex"),
    exp: Date.now() + STATE_TTL_MS,
  };
  const json = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", secret).update(json).digest("base64url");
  return `${json}.${sig}`;
}

/**
 * Verify a state token produced by {@link createState}.
 *
 * Returns the decoded payload when valid, or null when the signature is
 * wrong, the token is malformed, or the TTL has expired.
 */
export function verifyState(secret: string, state: string): StatePayload | null {
  const idx = state.indexOf(".");
  if (idx < 0) return null;
  const json = state.slice(0, idx);
  const sig = state.slice(idx + 1);
  const expected = createHmac("sha256", secret).update(json).digest("base64url");
  if (sig !== expected) return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }
  if (Date.now() > payload.exp) return null;
  return payload;
}
