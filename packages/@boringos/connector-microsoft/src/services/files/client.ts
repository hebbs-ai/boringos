// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed FilesClient. Wraps the Microsoft Graph v1.0 OneDrive surface
// (/me/drive). Read-only: listFiles (children of a folder, root by default),
// search, and getFile. Mirrors the Google DriveClient.

import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { DriveItem } from "./types.js";

const GRAPH_API = "https://graph.microsoft.com/v1.0/me/drive";

const ITEM_FIELDS = "id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference";

export class FilesClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listFiles(opts?: { query?: string; top?: number; folderId?: string }): Promise<DriveItem[]> {
    const params = new URLSearchParams({
      $select: ITEM_FIELDS,
      $top: String(opts?.top ?? 100),
    });
    let base: string;
    if (opts?.query) {
      // search(q='...') is its own function endpoint; folderId is ignored.
      base = `${GRAPH_API}/root/search(q='${encodeURIComponent(opts.query)}')`;
    } else if (opts?.folderId) {
      base = `${GRAPH_API}/items/${encodeURIComponent(opts.folderId)}/children`;
    } else {
      base = `${GRAPH_API}/root/children`;
    }
    const url = `${base}?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Files listFiles failed: ${res.status}`);
    const body = (await res.json()) as { value?: DriveItem[] };
    return body.value ?? [];
  }

  async getFile(itemId: string): Promise<DriveItem> {
    const params = new URLSearchParams({ $select: ITEM_FIELDS });
    const url = `${GRAPH_API}/items/${encodeURIComponent(itemId)}?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Files getFile failed: ${res.status}`);
    return (await res.json()) as DriveItem;
  }
}
