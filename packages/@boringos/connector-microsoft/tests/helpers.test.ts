import { describe, it, expect, vi } from "vitest";
import { fetchWithAuth } from "../src/helpers.js";

describe("fetchWithAuth", () => {
  it("calls getToken once on 200", async () => {
    const getToken = vi.fn(async () => "token-1");
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    await fetchWithAuth(getToken, fetchMock, "https://x", {});
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it("retries with a fresh token on 401", async () => {
    const getToken = vi.fn().mockResolvedValueOnce("stale").mockResolvedValueOnce("fresh");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("auth", { status: 401 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await fetchWithAuth(getToken, fetchMock, "https://x", {});
    expect(res.status).toBe(200);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry twice on persistent 401", async () => {
    const getToken = vi.fn(async () => "tok");
    const fetchMock = vi.fn(async () => new Response("auth", { status: 401 }));
    const res = await fetchWithAuth(getToken, fetchMock, "https://x", {});
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
