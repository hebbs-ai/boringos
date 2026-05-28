import { describe, it, expect, vi } from "vitest";
import { MessagingClient } from "../../src/services/messaging/client.js";

describe("MessagingClient", () => {
  it("sends a message", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, ts: "1.0", channel: "C1", message: { text: "hi" } }),
        { status: 200 },
      ),
    );
    const client = new MessagingClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.sendMessage({ channel: "C1", text: "hi" });
    expect(result.ts).toBe("1.0");
  });

  it("throws on slack error response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: false, error: "channel_not_found" }),
        { status: 200 },
      ),
    );
    const client = new MessagingClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.sendMessage({ channel: "X", text: "hi" })).rejects.toThrow(
      "channel_not_found",
    );
  });
});
