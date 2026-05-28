// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed PeopleClient. Wraps the Google People API (v1) contacts surface.
// Only exposes read-side methods: listContacts and batchGet.

import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { Contact } from "./types.js";

const PEOPLE_API = "https://people.googleapis.com/v1";

export class PeopleClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listContacts(opts?: { pageSize?: number }): Promise<Contact[]> {
    const params = new URLSearchParams({
      personFields: "names,emailAddresses,phoneNumbers",
      pageSize: String(opts?.pageSize ?? 100),
    });
    const url = `${PEOPLE_API}/people/me/connections?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`People listContacts failed: ${res.status}`);
    const body = (await res.json()) as { connections?: Contact[] };
    return body.connections ?? [];
  }

  async batchGet(emails: string[]): Promise<Contact[]> {
    if (emails.length === 0) return [];
    const params = new URLSearchParams({ personFields: "names,emailAddresses" });
    emails.forEach((e) => params.append("resourceNames", `people/${encodeURIComponent(e)}`));
    const url = `${PEOPLE_API}/people:batchGet?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`People batchGet failed: ${res.status}`);
    const body = (await res.json()) as { responses?: { person: Contact }[] };
    return (body.responses ?? []).map((r) => r.person);
  }
}
