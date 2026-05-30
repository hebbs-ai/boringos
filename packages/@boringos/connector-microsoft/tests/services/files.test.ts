// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from "vitest";
import { FilesClient } from "../../src/services/files/client.js";

describe("FilesClient", () => {
  it("lists root children by default", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ value: [{ id: "f1", name: "Doc.docx" }] }), {
        status: 200,
      });
    });
    const client = new FilesClient("token", fetchMock as unknown as typeof fetch);
    const files = await client.listFiles();
    expect(capturedUrl).toContain("/drive/root/children");
    expect(files[0]?.name).toBe("Doc.docx");
  });

  it("lists children of a folder when folderId given", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    const client = new FilesClient("token", fetchMock as unknown as typeof fetch);
    await client.listFiles({ folderId: "FID" });
    expect(capturedUrl).toContain("/drive/items/FID/children");
  });

  it("uses the search endpoint when a query is given", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    const client = new FilesClient("token", fetchMock as unknown as typeof fetch);
    await client.listFiles({ query: "budget" });
    expect(capturedUrl).toContain("/drive/root/search(q='budget')");
  });

  it("getFile fetches a single item", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ id: "f1", name: "Doc.docx" }), { status: 200 });
    });
    const client = new FilesClient("token", fetchMock as unknown as typeof fetch);
    const file = await client.getFile("f1");
    expect(capturedUrl).toContain("/drive/items/f1");
    expect(file.id).toBe("f1");
  });

  it("throws on non-ok response", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = new FilesClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.getFile("x")).rejects.toThrow("Files getFile failed: 401");
  });
});
