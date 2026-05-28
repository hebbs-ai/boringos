// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed DriveClient. Wraps the Google Drive API v3, read-only surface.
// Provides listFiles and getFile. No write or upload operations.

import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { DriveFile } from "./types.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export class DriveClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listFiles(opts?: { query?: string; pageSize?: number }): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,parents)",
      pageSize: String(opts?.pageSize ?? 100),
    });
    if (opts?.query) params.set("q", opts.query);
    const url = `${DRIVE_API}/files?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Drive listFiles failed: ${res.status}`);
    const body = (await res.json()) as { files?: DriveFile[] };
    return body.files ?? [];
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,modifiedTime,webViewLink,parents`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Drive getFile failed: ${res.status}`);
    return (await res.json()) as DriveFile;
  }
}
