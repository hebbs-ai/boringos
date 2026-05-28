/**
 * Connector SDK v2 — integration smoke tests
 *
 * Exercises the AuthManager against a real embedded Postgres. Covers the
 * OAuth-callback → encrypted-row → token-retrieval path that the manual
 * test verified once but had zero regression coverage.
 *
 * Mocks: global fetch (for the OAuth token exchange).
 * Real: Postgres, schema, encryption, AuthManager state HMAC.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDbConfig } from "./_helpers.js";

const TEST_KEY = "0123456789abcdef".repeat(4); // 64 hex chars = 32 bytes

describe("Connector SDK v2 — integration", () => {
  let dataDir: string;
  let dbConn: { db: unknown; close: () => Promise<void> };
  let savedKey: string | undefined;

  beforeAll(async () => {
    savedKey = process.env.BORINGOS_ENCRYPTION_KEY;
    process.env.BORINGOS_ENCRYPTION_KEY = TEST_KEY;

    const { createDatabase, createMigrationManager } = await import("@boringos/db");
    dataDir = await mkdtemp(join(tmpdir(), "boringos-connector-sdk-v2-"));
    dbConn = await createDatabase(testDbConfig(dataDir, 5599)) as { db: unknown; close: () => Promise<void> };
    const migrator = createMigrationManager(dbConn.db as never);
    await migrator.apply();
  }, 60_000);

  afterAll(async () => {
    if (dbConn) await dbConn.close();
    if (savedKey !== undefined) process.env.BORINGOS_ENCRYPTION_KEY = savedKey;
    else delete process.env.BORINGOS_ENCRYPTION_KEY;
  });

  // Synthetic id_token: header.payload.signature. We don't verify the
  // signature in our AuthManager (documented decision), so the signature
  // can be any non-empty string.
  function makeIdToken(claims: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${header}.${payload}.fake-signature`;
  }

  it("handleOAuthCallback persists an encrypted account row and getToken retrieves it", async () => {
    const { AuthManager } = await import("@boringos/core");
    const { tenants } = await import("@boringos/db");

    const tenantId = "11111111-1111-1111-1111-111111111111";
    await (dbConn.db as { insert: (t: unknown) => { values: (v: unknown) => Promise<void> } })
      .insert(tenants).values({ id: tenantId, name: "Test Tenant", slug: "test-tenant-1" });

    // Set up env vars the test connector references.
    process.env.TEST_CLIENT_ID = "test-client-id";
    process.env.TEST_CLIENT_SECRET = "test-client-secret";

    const testConnector = {
      provider: "test",
      displayName: "Test Provider",
      version: 1,
      auth: [{
        type: "oauth2" as const,
        authorizationUrl: "https://example.invalid/authorize",
        tokenUrl: "https://example.invalid/token",
        clientIdEnv: "TEST_CLIENT_ID",
        clientSecretEnv: "TEST_CLIENT_SECRET",
      }],
      services: [],
      resolveAccountId: (resp: Record<string, unknown>) =>
        String(resp.email ?? resp.sub ?? "unknown"),
    };

    const mgr = new AuthManager(
      dbConn.db as never,
      "test-state-secret",
      (provider: string) => `http://test/oauth/${provider}/callback`,
    );
    mgr.registerConnector(testConnector);

    // Mock fetch for the token exchange. Return a Google-style response
    // with an id_token carrying the identity claim.
    const idToken = makeIdToken({ email: "alice@example.com", sub: "user-123" });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://example.invalid/token");
      return new Response(JSON.stringify({
        access_token: "ya29.access-token-value",
        refresh_token: "1//refresh-token-value",
        expires_in: 3600,
        token_type: "Bearer",
        id_token: idToken,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Start the OAuth flow to get a valid state token.
    const { state } = await mgr.startOAuthFlow("test", tenantId, ["openid", "email"]);

    // Complete the callback. This should:
    //   - verify state
    //   - exchange code for tokens
    //   - decode id_token claims
    //   - resolve accountId to alice@example.com
    //   - insert an encrypted row into connector_accounts
    const account = await mgr.handleOAuthCallback("test", "fake-auth-code", state);

    expect(account.accountId).toBe("alice@example.com");
    expect(account.provider).toBe("test");
    expect(account.status).toBe("active");
    expect(account.grantedScopes).toEqual(["openid", "email"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify the row landed and credentials are an encrypted STRING (not a
    // plaintext object). Read raw via Drizzle.
    const { connectorAccounts } = await import("@boringos/db");
    const { eq, and } = await import("drizzle-orm");
    const rows = await (dbConn.db as never).select().from(connectorAccounts).where(
      and(
        eq(connectorAccounts.tenantId, tenantId),
        eq(connectorAccounts.provider, "test"),
        eq(connectorAccounts.accountId, "alice@example.com"),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(typeof rows[0].credentials).toBe("string");
    expect(rows[0].credentials.length).toBeGreaterThan(40); // base64 of iv+tag+ciphertext
    expect(rows[0].credentials).not.toContain("ya29"); // ciphertext, not plaintext

    // Now retrieve a token via the binding-fallback path (no binding row
    // exists, so it should fall back to "oldest active account").
    const handle = await mgr.getToken("test", tenantId, "any-module");
    expect(handle).not.toBeNull();
    const token = await handle!.getToken();
    expect(token).toBe("ya29.access-token-value");

    vi.unstubAllGlobals();
  }, 30_000);

  it("first-active fallback returns the OLDEST account when no binding exists", async () => {
    const { AuthManager } = await import("@boringos/core");
    const { packCredentials: pack, tenants, connectorAccounts } = await import("@boringos/db");

    const tenantId = "22222222-2222-2222-2222-222222222222";
    await (dbConn.db as never).insert(tenants).values({ id: tenantId, name: "Multi-Account Tenant", slug: "multi-tenant" });

    // Stub minimal connector
    const stub = {
      provider: "test-multi",
      displayName: "Multi",
      version: 1,
      auth: [{ type: "oauth2" as const, authorizationUrl: "u", tokenUrl: "t", clientIdEnv: "X", clientSecretEnv: "Y" }],
      services: [],
      resolveAccountId: () => "n/a",
    };
    const mgr = new AuthManager(dbConn.db as never, "secret", () => "http://x");
    mgr.registerConnector(stub);

    // Insert TWO accounts. We control timestamps to verify ordering.
    const olderCreatedAt = new Date("2026-01-01T00:00:00Z");
    const newerCreatedAt = new Date("2026-02-01T00:00:00Z");

    await (dbConn.db as never).insert(connectorAccounts).values({
      tenantId,
      provider: "test-multi",
      accountId: "newer@example.com",
      authStrategy: "oauth2",
      status: "active",
      credentials: pack({ accessToken: "newer-token" }),
      grantedScopes: [],
      createdAt: newerCreatedAt,
      updatedAt: newerCreatedAt,
    });
    await (dbConn.db as never).insert(connectorAccounts).values({
      tenantId,
      provider: "test-multi",
      accountId: "older@example.com",
      authStrategy: "oauth2",
      status: "active",
      credentials: pack({ accessToken: "older-token" }),
      grantedScopes: [],
      createdAt: olderCreatedAt,
      updatedAt: olderCreatedAt,
    });

    // No binding exists. Fallback should return the OLDER account
    // because it has the earliest createdAt.
    const handle = await mgr.getToken("test-multi", tenantId, "no-binding-here");
    expect(handle).not.toBeNull();
    const token = await handle!.getToken();
    expect(token).toBe("older-token");
  }, 30_000);

  it("startOAuthFlow merges requiredScopes from ConnectorDefinition, deduped", async () => {
    // T0.1 — `requiredScopes` is the first-class replacement for the
    // pre-MDK pattern of hiding a "profile" pseudo-service in services[].
    // AuthManager.startOAuthFlow must always merge them into the OAuth URL.
    const { AuthManager } = await import("@boringos/core");

    process.env.REQ_CLIENT_ID = "req-id";
    process.env.REQ_CLIENT_SECRET = "req-secret";

    const tenantId = "33333333-3333-3333-3333-333333333333";

    const reqConnector = {
      provider: "test-required",
      displayName: "Required-Scopes Test",
      version: 1,
      auth: [{
        type: "oauth2" as const,
        authorizationUrl: "https://example.invalid/authorize",
        tokenUrl: "https://example.invalid/token",
        clientIdEnv: "REQ_CLIENT_ID",
        clientSecretEnv: "REQ_CLIENT_SECRET",
      }],
      services: [],
      requiredScopes: [
        { scope: "openid", description: "OIDC id token", required: true },
        { scope: "email", description: "email claim", required: true },
        { scope: "profile", description: "profile claim", required: true },
      ],
      resolveAccountId: () => "acc",
    };

    const mgr = new AuthManager(
      dbConn.db as never,
      "test-state-secret-req",
      (provider: string) => `http://test/oauth/${provider}/callback`,
    );
    mgr.registerConnector(reqConnector);

    // Caller passes only "custom-scope" plus "email" (which overlaps
    // requiredScopes — must be deduped).
    const { authUrl } = await mgr.startOAuthFlow(
      "test-required",
      tenantId,
      ["custom-scope", "email"],
    );

    const url = new URL(authUrl);
    const scopeParam = url.searchParams.get("scope") ?? "";
    const scopes = scopeParam.split(" ");

    expect(scopes).toContain("openid");
    expect(scopes).toContain("email");
    expect(scopes).toContain("profile");
    expect(scopes).toContain("custom-scope");
    // Deduped — "email" appears once even though it's in both lists.
    expect(scopes.filter((s) => s === "email")).toHaveLength(1);
  }, 10_000);

  it("googleConnector advertises identity scopes via requiredScopes, not as a hidden service", async () => {
    // T0.1 — drops the `profileService` hidden-service hack. The
    // canonical definition must expose identity scopes ONLY through
    // `requiredScopes`; `services` must not contain a "profile" entry.
    const { googleConnector } = await import("@boringos/connector-google");

    const serviceIds = googleConnector.services.map((s) => s.id);
    expect(serviceIds).not.toContain("profile");

    const requiredScopeStrings =
      (googleConnector.requiredScopes ?? []).map((s) => s.scope);
    expect(requiredScopeStrings).toContain("openid");
    expect(requiredScopeStrings).toContain("email");
    expect(requiredScopeStrings).toContain("profile");
  });
});
