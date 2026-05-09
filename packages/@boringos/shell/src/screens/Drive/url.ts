// SPDX-License-Identifier: BUSL-1.1
//
// Auth-aware URL builder for drive files. The file-serve route
// accepts a session token via `?token=` query parameter so <img>
// tags can load drive content without JS-fetched blobs. We append
// the current localStorage token here.

const TOKEN_KEY = "boringos.token";

/** Read the active session token. Returns null in non-browser
 * environments (SSR, tests). */
function readToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Build a URL the browser can use directly in src/href.
 * Accepts either a tenant-relative drive path (e.g.
 * "tasks/T/foo.png") or a full drive URL the agent embedded
 * (e.g. "/api/admin/drive/file/tasks/T/foo.png"). Always returns
 * a string with the auth token appended as ?token=...  */
export function driveUrl(pathOrUrl: string): string {
  const isFullUrl = pathOrUrl.startsWith("/api/admin/drive/file/");
  const url = isFullUrl
    ? pathOrUrl
    : `/api/admin/drive/file/${encodePath(pathOrUrl)}`;

  const token = readToken();
  if (!token) return url;
  // Don't double-add if a token is already present.
  if (/[?&]token=/.test(url)) return url;
  return url.includes("?") ? `${url}&token=${token}` : `${url}?token=${token}`;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** Append the auth token to a URL only if it's a drive-file URL.
 * Used by the Markdown preprocessor — leaves non-drive URLs (e.g.
 * external image hosts) untouched. */
export function withDriveAuth(url: string): string {
  if (!url.startsWith("/api/admin/drive/file/")) return url;
  return driveUrl(url);
}
