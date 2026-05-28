// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { DriveClient } from "../../src/services/drive/client.js";

describe("DriveClient", () => {
  it("lists files", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ files: [{ id: "f1", name: "doc", mimeType: "text/plain" }] }),
        { status: 200 },
      ),
    );
    const client = new DriveClient("t", fetchMock as unknown as typeof fetch);
    const files = await client.listFiles();
    expect(files).toHaveLength(1);
  });

  it("listFiles forwards query param", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("q=");
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    });
    const client = new DriveClient("t", fetchMock as unknown as typeof fetch);
    await client.listFiles({ query: "name contains 'report'" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("getFile returns a single file", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ id: "f2", name: "sheet", mimeType: "application/vnd.google-apps.spreadsheet" }),
        { status: 200 },
      ),
    );
    const client = new DriveClient("t", fetchMock as unknown as typeof fetch);
    const file = await client.getFile("f2");
    expect(file.id).toBe("f2");
  });
});
