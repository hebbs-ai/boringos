// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from "vitest";
import { ContactsClient } from "../../src/services/contacts/client.js";

describe("ContactsClient", () => {
  it("lists contacts from the value array", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ value: [{ id: "c1", displayName: "Ada Lovelace" }] }),
        { status: 200 },
      ),
    );
    const client = new ContactsClient("token", fetchMock as unknown as typeof fetch);
    const contacts = await client.listContacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.displayName).toBe("Ada Lovelace");
  });

  it("getContact fetches a single contact", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ id: "c1", displayName: "Ada" }), { status: 200 });
    });
    const client = new ContactsClient("token", fetchMock as unknown as typeof fetch);
    const contact = await client.getContact("c1");
    expect(capturedUrl).toContain("/contacts/c1");
    expect(contact.id).toBe("c1");
  });

  it("searchPeople queries /me/people with $search", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ value: [{ id: "p1", displayName: "Bob" }] }), {
        status: 200,
      });
    });
    const client = new ContactsClient("token", fetchMock as unknown as typeof fetch);
    const people = await client.searchPeople("bob");
    expect(capturedUrl).toContain("/people");
    expect(capturedUrl).toContain("%24search=");
    expect(people[0]?.displayName).toBe("Bob");
  });

  it("throws on non-ok response", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    const client = new ContactsClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.listContacts()).rejects.toThrow("Contacts listContacts failed: 403");
  });
});
