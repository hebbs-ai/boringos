// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared fetch helpers for Microsoft Graph API clients.
// `fetchWithAuth` wraps a fetch implementation with Bearer token injection
// and a single 401-triggered retry using a fresh token from the caller.
//
// Identical contract to the Google connector's helpers so both connectors
// behave the same way under the host's transparent-refresh token handle.

export type TokenSource = string | (() => Promise<string>);

export async function resolveToken(src: TokenSource): Promise<string> {
  return typeof src === "function" ? src() : src;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchWithAuth(
  getToken: () => Promise<string>,
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetchImpl(url, { ...init, headers });
  if (res.status !== 401) return res;

  // Retry once with a fresh token.
  const freshToken = await getToken();
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${freshToken}`);
  return fetchImpl(url, { ...init, headers: retryHeaders });
}
