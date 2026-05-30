// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed ContactsClient. Wraps the Microsoft Graph v1.0 contacts surface
// (/me/contacts) plus the relevance-ranked people surface (/me/people).
// Read-only, mirroring the Google PeopleClient (listContacts + lookup).

import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { Contact, Person } from "./types.js";

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";

export class ContactsClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listContacts(opts?: { top?: number }): Promise<Contact[]> {
    const params = new URLSearchParams({
      $top: String(opts?.top ?? 100),
      $select: "id,displayName,givenName,surname,emailAddresses,mobilePhone,businessPhones,companyName,jobTitle",
    });
    const url = `${GRAPH_API}/contacts?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Contacts listContacts failed: ${res.status}`);
    const body = (await res.json()) as { value?: Contact[] };
    return body.value ?? [];
  }

  async getContact(contactId: string): Promise<Contact> {
    const url = `${GRAPH_API}/contacts/${encodeURIComponent(contactId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Contacts getContact failed: ${res.status}`);
    return (await res.json()) as Contact;
  }

  // Relevance-ranked people search across the mailbox (parallels Google's
  // People search). Returns Person resources, not stored Contacts.
  async searchPeople(query: string, opts?: { top?: number }): Promise<Person[]> {
    const params = new URLSearchParams({
      $search: `"${query}"`,
      $top: String(opts?.top ?? 25),
    });
    const url = `${GRAPH_API}/people?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Contacts searchPeople failed: ${res.status}`);
    const body = (await res.json()) as { value?: Person[] };
    return body.value ?? [];
  }
}
