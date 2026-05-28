// SPDX-License-Identifier: MIT
//
// Unit tests for the connector-token dispatcher + the Google provider.
// The dispatcher routes by kind; Google has all the load/refresh logic.
// All DB and refreshOAuthToken calls are mocked — no embedded Postgres needed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getConnectorTokenForTenant } from "../packages/@boringos/core/src/connector-tokens.js";
import { unpackCredentials } from "../packages/@boringos/db/src/credentials.js";

// Set BORINGOS_ENCRYPTION_KEY for all tests in this file so that
// packCredentials / unpackCredentials work without hitting a real key store.
const TEST_ENCRYPTION_KEY = "a".repeat(64); // 32 bytes as 64 hex chars
beforeEach(() => {
  process.env.BORINGOS_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});
afterEach(() => {
  delete process.env.BORINGOS_ENCRYPTION_KEY;
});

// ── Mock refreshOAuthToken ────────────────────────────────────────────────────

vi.mock("../packages/@boringos/core/src/oauth.js", () => ({
  refreshOAuthToken: vi.fn(),
}));

import { refreshOAuthToken } from "../packages/@boringos/core/src/oauth.js";
const mockRefresh = vi.mocked(refreshOAuthToken);

// ── DB stub helpers ───────────────────────────────────────────────────────────

function makeMockDb(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const updateSetWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateSetWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  // The dispatcher's fire-and-forget audit write. The chain
  // `db.insert(table).values({...}).catch(...)` must be a thenable.
  const insertValues = vi.fn().mockReturnValue(Promise.resolve());
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  return { select, update, insert } as unknown as import("@boringos/db").Db;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "connector-row-1",
    credentials: {
      accessToken: "access-tok-initial",
      refreshToken: "refresh-tok",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min ahead (fresh)
      ...overrides,
    },
    config: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getConnectorTokenForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when Slack provider has no connector row", async () => {
    // Slack provider is registered; with no connector row it returns null.
    const db = makeMockDb([]);
    const result = await getConnectorTokenForTenant(db, "slack", "tenant-1", "test-module");
    expect(result).toBeNull();
  });

  it("returns the access token from Slack creds when present", async () => {
    const slackRow = { credentials: { accessToken: "xoxb-slack-token" } };
    const db = makeMockDb([slackRow]);
    const result = await getConnectorTokenForTenant(db, "slack", "tenant-1", "test-module");
    expect(result).toEqual({ accessToken: "xoxb-slack-token" });
  });

  it("returns null for a totally unknown kind string", async () => {
    const db = makeMockDb([]);
    const result = await getConnectorTokenForTenant(db, "made-up-provider", "tenant-1", "test-module");
    expect(result).toBeNull();
  });

  it("returns null when no connector row exists", async () => {
    const db = makeMockDb([]); // empty rows
    const result = await getConnectorTokenForTenant(db, "google", "tenant-1", "test-module");
    expect(result).toBeNull();
  });

  it("returns null when credentials field is null", async () => {
    const db = makeMockDb([{ id: "c1", credentials: null, config: null }]);
    const result = await getConnectorTokenForTenant(db, "google", "tenant-1", "test-module");
    expect(result).toBeNull();
  });

  it("returns existing token when it is fresh (not expiring soon)", async () => {
    const row = makeRow(); // expiresAt = 10 min from now → fresh
    const db = makeMockDb([row]);

    const result = await getConnectorTokenForTenant(db, "google", "tenant-1", "test-module");

    expect(result).toEqual({ accessToken: "access-tok-initial" });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("returns existing token when expiresAt is absent (no proactive refresh)", async () => {
    const row = makeRow({ expiresAt: undefined });
    const db = makeMockDb([row]);

    const result = await getConnectorTokenForTenant(db, "google", "tenant-1", "test-module");

    expect(result).toEqual({ accessToken: "access-tok-initial" });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("refreshes and returns new token when expiring within 60 s", async () => {
    // expiresAt = 30 s from now → within the 60 s threshold
    const row = makeRow({
      expiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
    });
    const db = makeMockDb([row]);

    mockRefresh.mockResolvedValueOnce({
      accessToken: "access-tok-refreshed",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const result = await getConnectorTokenForTenant(db, "google", "tenant-1", "test-module");

    expect(result).toEqual({ accessToken: "access-tok-refreshed" });
    expect(mockRefresh).toHaveBeenCalledWith("google", "refresh-tok");
  });

  it("falls back to existing token when expiring but refresh returns null", async () => {
    const row = makeRow({
      expiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
    });
    const db = makeMockDb([row]);
    mockRefresh.mockResolvedValueOnce(null);

    const result = await getConnectorTokenForTenant(db, "google", "tenant-1", "test-module");

    expect(result).toEqual({ accessToken: "access-tok-initial" });
  });

  it("skips refresh when token is expiring but no refreshToken is stored", async () => {
    const row = makeRow({
      expiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
      refreshToken: undefined,
    });
    const db = makeMockDb([row]);

    const result = await getConnectorTokenForTenant(db, "google", "tenant-1", "test-module");

    expect(result).toEqual({ accessToken: "access-tok-initial" });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("persists new credentials to the DB after a successful refresh", async () => {
    const row = makeRow({
      expiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
    });

    // Capture DB update calls
    const updateSetWhereMock = vi.fn().mockResolvedValue(undefined);
    const updateSetMock = vi.fn().mockReturnValue({ where: updateSetWhereMock });
    const updateMock = vi.fn().mockReturnValue({ set: updateSetMock });
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const insertValues = vi.fn().mockReturnValue(Promise.resolve());
    const insertMock = vi.fn().mockReturnValue({ values: insertValues });
    const db = { select, update: updateMock, insert: insertMock } as unknown as import("@boringos/db").Db;

    const newExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockRefresh.mockResolvedValueOnce({
      accessToken: "access-tok-refreshed",
      expiresAt: newExpiry,
    });

    await getConnectorTokenForTenant(db, "google", "tenant-1", "test-module");

    expect(updateMock).toHaveBeenCalled();
    const setCall = updateSetMock.mock.calls[0][0];
    // Credentials are now stored encrypted. Verify the stored value is
    // a non-empty string (the ciphertext blob) and that it round-trips
    // back to the expected access token + expiry.
    expect(typeof setCall.credentials).toBe("string");
    const decrypted = unpackCredentials<{ accessToken: string; expiresAt: string }>(setCall.credentials as string);
    expect(decrypted?.accessToken).toBe("access-tok-refreshed");
    expect(decrypted?.expiresAt).toBe(newExpiry);
  });

  // ─── audit hook ────────────────────────────────────────────────

  it("audit: writes one issuance row per call with caller_module_id + outcome", async () => {
    const row = makeRow();
    const insertValues = vi.fn().mockReturnValue(Promise.resolve());
    const insert = vi.fn().mockReturnValue({ values: insertValues });
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select, update: vi.fn(), insert } as unknown as import("@boringos/db").Db;

    await getConnectorTokenForTenant(db, "google", "tenant-1", "executive-assistant");

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const auditRow = insertValues.mock.calls[0][0];
    expect(auditRow).toMatchObject({
      tenantId: "tenant-1",
      kind: "google",
      callerModuleId: "executive-assistant",
      outcome: "issued",
    });
  });

  it("audit: records 'not_connected' for unknown kind", async () => {
    const insertValues = vi.fn().mockReturnValue(Promise.resolve());
    const insert = vi.fn().mockReturnValue({ values: insertValues });
    const db = { select: vi.fn(), update: vi.fn(), insert } as unknown as import("@boringos/db").Db;

    await getConnectorTokenForTenant(db, "made-up-provider", "tenant-1", "ea");

    expect(insertValues).toHaveBeenCalledTimes(1);
    const auditRow = insertValues.mock.calls[0][0];
    expect(auditRow).toMatchObject({
      tenantId: "tenant-1",
      kind: "made-up-provider",
      callerModuleId: "ea",
      outcome: "not_connected",
    });
  });

  it("audit: caller_module_id defaults to 'unknown' when omitted", async () => {
    const row = makeRow();
    const insertValues = vi.fn().mockReturnValue(Promise.resolve());
    const insert = vi.fn().mockReturnValue({ values: insertValues });
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select, update: vi.fn(), insert } as unknown as import("@boringos/db").Db;

    await getConnectorTokenForTenant(db, "google", "tenant-1");

    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues.mock.calls[0][0].callerModuleId).toBe("unknown");
  });

  it("audit: write failure does not break the caller", async () => {
    const row = makeRow();
    const insertValues = vi.fn().mockReturnValue(Promise.reject(new Error("audit DB down")));
    const insert = vi.fn().mockReturnValue({ values: insertValues });
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select, update: vi.fn(), insert } as unknown as import("@boringos/db").Db;

    const result = await getConnectorTokenForTenant(db, "google", "tenant-1", "ea");
    expect(result).toEqual({ accessToken: "access-tok-initial" });
    await new Promise((r) => setImmediate(r));
  });
});
