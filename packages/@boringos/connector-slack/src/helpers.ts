// SPDX-License-Identifier: AGPL-3.0-or-later

export type TokenSource = string | (() => Promise<string>);

export async function resolveToken(src: TokenSource): Promise<string> {
  return typeof src === "function" ? src() : src;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// Slack auth-error codes that indicate the token is no longer valid and
// the caller should retry with a refreshed token. See:
// https://api.slack.com/methods/auth.test (and the Errors section on
// every method page).
const SLACK_AUTH_ERRORS: ReadonlySet<string> = new Set([
  "invalid_auth",
  "token_expired",
  "token_revoked",
  "account_inactive",
]);

export async function fetchSlack(
  getToken: () => Promise<string>,
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetchImpl(url, { ...init, headers });

  // Slack returns HTTP 200 on auth failures and signals the error via
  // a JSON body { ok: false, error: "<code>" }. Parse defensively and
  // only retry on known auth-error codes.
  //
  // The body is consumed from a clone so the caller still gets to parse
  // the original response.
  if (res.status !== 401) {
    let body: { ok?: boolean; error?: string } | null = null;
    try {
      body = (await res.clone().json()) as { ok?: boolean; error?: string };
    } catch {
      // Non-JSON response (e.g., 204, redirect). Nothing to retry on.
      return res;
    }
    if (body && body.ok === false && typeof body.error === "string" && SLACK_AUTH_ERRORS.has(body.error)) {
      const fresh = await getToken();
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("Authorization", `Bearer ${fresh}`);
      return fetchImpl(url, { ...init, headers: retryHeaders });
    }
  }
  return res;
}
