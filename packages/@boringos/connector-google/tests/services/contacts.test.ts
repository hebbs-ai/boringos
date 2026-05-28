// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { PeopleClient } from "../../src/services/contacts/client.js";

describe("PeopleClient", () => {
  it("lists contacts", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          connections: [{ resourceName: "people/1", emailAddresses: [{ value: "a@b.com" }] }],
        }),
        { status: 200 },
      ),
    );
    const client = new PeopleClient("t", fetchMock as unknown as typeof fetch);
    const contacts = await client.listContacts();
    expect(contacts).toHaveLength(1);
  });

  it("batchGet returns empty for empty input without making a request", async () => {
    const fetchMock = vi.fn();
    const client = new PeopleClient("t", fetchMock as unknown as typeof fetch);
    const result = await client.batchGet([]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batchGet fetches and maps responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          responses: [
            { person: { resourceName: "people/abc", names: [{ displayName: "Alice" }] } },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new PeopleClient("t", fetchMock as unknown as typeof fetch);
    const result = await client.batchGet(["alice@example.com"]);
    expect(result).toHaveLength(1);
    expect(result[0].resourceName).toBe("people/abc");
  });
});
