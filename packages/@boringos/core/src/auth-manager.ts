// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AuthManager -- connector registration, binding resolution, token refresh, audit,
// OAuth dance, and account removal.
//
// Responsibilities (Task 2.2 + 2.3):
//   - Connector registry: registerConnector / listConnectors / getConnector
//   - Binding CRUD: bindAccount / unbindAccount / getBinding
//   - Token resolution: getToken (returns a ConnectorTokenHandle closure)
//   - Transparent refresh: refreshIfNeeded (private)
//   - Fire-and-forget audit: writes to connector_token_issuance
//   - Account listing: listAccounts
//   - Scope check: checkScopes
//   - OAuth dance: startOAuthFlow / handleOAuthCallback
//   - Account removal: removeAccount

import type {
  ConnectorDefinition,
  ConnectorTokenHandle,
  ConnectedAccount,
  ScopeCheckResult,
  OAuth2Strategy,
} from "@boringos/module-sdk";
import {
  connectorAccounts,
  connectorOauthApps,
  moduleConnectorBindings,
  connectorTokenIssuance,
} from "@boringos/db";
import { packCredentials, unpackCredentials } from "@boringos/db";
import type { Db } from "@boringos/db";
import { eq, and, asc } from "drizzle-orm";
import { exchangeRefreshToken } from "./auth-manager-oauth.js";
import { createState, verifyState } from "./auth-manager-state.js";

// ---- Internal types ----

interface OAuthClientCreds {
  clientId: string;
  clientSecret: string;
}

interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  [k: string]: unknown;
}

/** How far ahead of expiry we proactively refresh (60 seconds). */
const REFRESH_LEAD_MS = 60_000;

// ---- AuthManager ----

export class AuthManager {
  private connectors = new Map<string, ConnectorDefinition>();

  constructor(
    private db: Db,
    private stateSecret: string,
    private getRedirectUri: (provider: string) => string,
  ) {}

  private redirectUri(provider: string): string {
    return this.getRedirectUri(provider);
  }

  // ---- Connector registry ----

  registerConnector(def: ConnectorDefinition): void {
    if (this.connectors.has(def.provider)) {
      throw new Error(`Connector '${def.provider}' already registered`);
    }
    this.connectors.set(def.provider, def);
  }

  listConnectors(): ConnectorDefinition[] {
    return [...this.connectors.values()];
  }

  getConnector(provider: string): ConnectorDefinition | null {
    return this.connectors.get(provider) ?? null;
  }

  // ---- OAuth client resolution (private) ----

  private async resolveOAuthClient(
    provider: string,
    tenantId: string,
  ): Promise<OAuthClientCreds> {
    // 1. Tenant-supplied "bring your own app" override.
    const tenantApps = await this.db
      .select()
      .from(connectorOauthApps)
      .where(
        and(
          eq(connectorOauthApps.tenantId, tenantId),
          eq(connectorOauthApps.provider, provider),
        ),
      )
      .limit(1);

    if (tenantApps[0]) {
      const id = unpackCredentials<string>(tenantApps[0].clientId);
      const secret = unpackCredentials<string>(tenantApps[0].clientSecret);
      if (!id || !secret) {
        throw new Error(`Tenant OAuth app credentials corrupted for provider '${provider}'`);
      }
      return { clientId: id, clientSecret: secret };
    }

    // 2. Platform default: read from connector definition's env vars.
    const def = this.getConnector(provider);
    if (!def) throw new Error(`Unknown connector: ${provider}`);
    const oauth = def.auth.find((a): a is OAuth2Strategy => a.type === "oauth2");
    if (!oauth) {
      throw new Error(`Connector '${provider}' has no oauth2 auth strategy`);
    }
    const clientId = process.env[oauth.clientIdEnv];
    const clientSecret = process.env[oauth.clientSecretEnv];
    if (!clientId || !clientSecret) {
      throw new Error(
        `OAuth client not configured for '${provider}'. ` +
          `Set env vars ${oauth.clientIdEnv} and ${oauth.clientSecretEnv}.`,
      );
    }
    return { clientId, clientSecret };
  }

  // ---- Audit (fire-and-forget) ----

  private audit(
    provider: string,
    accountId: string,
    callerModuleId: string,
    outcome: string,
    tenantId: string,
  ): void {
    this.db
      .insert(connectorTokenIssuance)
      .values({
        tenantId,
        kind: provider,       // backward compat: existing column
        provider,             // v2 column
        accountId,            // v2 column
        callerModuleId: callerModuleId || "unknown",
        outcome,
      })
      .catch((err: unknown) => {
        // Audit failure must never break token issuance.
        console.warn(
          `[auth-manager] audit write failed provider=${provider} caller=${callerModuleId}:`,
          err instanceof Error ? err.message : err,
        );
      });
  }

  // ---- Token resolution ----

  /**
   * Resolves a live ConnectorTokenHandle for the given provider/tenant/module.
   *
   * Resolution order:
   *  1. Explicit `opts.accountId` override (bypasses binding lookup).
   *  2. `module_connector_bindings` lookup.
   *  3. Returns null and audits "not_connected" if neither resolves.
   *
   * The returned handle's `getToken()` call refreshes the access token
   * transparently when within 60 s of expiry.
   */
  async getToken(
    provider: string,
    tenantId: string,
    callerModuleId: string,
    opts?: { accountId?: string },
  ): Promise<ConnectorTokenHandle | null> {
    // --- Step 1: resolve account id ---
    let accountId = opts?.accountId;

    if (!accountId) {
      const bindings = await this.db
        .select()
        .from(moduleConnectorBindings)
        .where(
          and(
            eq(moduleConnectorBindings.tenantId, tenantId),
            eq(moduleConnectorBindings.moduleId, callerModuleId),
            eq(moduleConnectorBindings.provider, provider),
          ),
        )
        .limit(1);

      if (bindings[0]) {
        accountId = bindings[0].accountId;
      } else {
        // No explicit binding. Fall back to the OLDEST active account for
        // this (tenant, provider). Ordering by createdAt makes the choice
        // deterministic across requests: a tenant with two Google accounts
        // and no bindings always gets the one connected first. Otherwise
        // PostgreSQL would return rows in arbitrary order and modules could
        // silently flip between accounts. Phase 3 UI will let users bind
        // modules to specific accounts explicitly.
        const fallback = await this.db
          .select()
          .from(connectorAccounts)
          .where(
            and(
              eq(connectorAccounts.tenantId, tenantId),
              eq(connectorAccounts.provider, provider),
              eq(connectorAccounts.status, "active"),
            ),
          )
          .orderBy(asc(connectorAccounts.createdAt))
          .limit(1);
        if (!fallback[0]) {
          this.audit(provider, "", callerModuleId, "not_connected", tenantId);
          return null;
        }
        accountId = fallback[0].accountId;
      }
    }

    // --- Step 2: verify the account row exists ---
    const accounts = await this.db
      .select()
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.tenantId, tenantId),
          eq(connectorAccounts.provider, provider),
          eq(connectorAccounts.accountId, accountId),
        ),
      )
      .limit(1);

    if (!accounts[0]) {
      this.audit(provider, accountId, callerModuleId, "not_connected", tenantId);
      return null;
    }

    const rowId = accounts[0].id;

    // --- Step 3: return a handle whose getToken() refreshes lazily ---
    return {
      getToken: () => this.refreshIfNeeded(provider, tenantId, rowId, callerModuleId),
    };
  }

  // ---- Refresh internals ----

  private async refreshIfNeeded(
    provider: string,
    tenantId: string,
    accountRowId: string,
    callerModuleId: string,
  ): Promise<string> {
    const rows = await this.db
      .select()
      .from(connectorAccounts)
      .where(eq(connectorAccounts.id, accountRowId))
      .limit(1);

    const row = rows[0];
    if (!row) throw new Error(`Account row missing: ${accountRowId}`);

    const creds = unpackCredentials<StoredCredentials>(row.credentials);
    if (!creds) throw new Error(`Credentials missing or corrupted for account row: ${accountRowId}`);

    const accountId = row.accountId;
    const needsRefresh =
      typeof creds.expiresAt === "number" &&
      creds.expiresAt - Date.now() < REFRESH_LEAD_MS;

    // Token is still fresh (or no expiry info) -- serve as-is.
    if (!needsRefresh || !creds.refreshToken) {
      this.audit(provider, accountId, callerModuleId, "issued", tenantId);
      return creds.accessToken;
    }

    // Token is near expiry -- refresh it.
    const def = this.getConnector(provider);
    if (!def) throw new Error(`Unknown connector: ${provider}`);
    const strategy = def.auth.find((a): a is OAuth2Strategy => a.type === "oauth2");
    if (!strategy) {
      throw new Error(`Connector '${provider}' has no oauth2 strategy for refresh`);
    }

    const { clientId, clientSecret } = await this.resolveOAuthClient(provider, tenantId);
    try {
      const refreshed = await exchangeRefreshToken(
        strategy,
        clientId,
        clientSecret,
        creds.refreshToken,
      );

      const updated: StoredCredentials = {
        ...creds,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? creds.refreshToken,
        expiresAt: refreshed.expiresAt,
      };

      await this.db
        .update(connectorAccounts)
        .set({
          credentials: packCredentials(updated as Record<string, unknown>),
          updatedAt: new Date(),
        })
        .where(eq(connectorAccounts.id, accountRowId));

      this.audit(provider, accountId, callerModuleId, "refreshed", tenantId);
      return refreshed.accessToken;
    } catch (e) {
      this.audit(provider, accountId, callerModuleId, "refresh_failed", tenantId);
      throw e;
    }
  }

  // ---- Account listing ----

  async listAccounts(provider: string, tenantId: string): Promise<ConnectedAccount[]> {
    const rows = await this.db
      .select()
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.tenantId, tenantId),
          eq(connectorAccounts.provider, provider),
        ),
      );

    return rows.map((r) => ({
      accountId: r.accountId,
      provider: r.provider,
      grantedScopes: (r.grantedScopes ?? []) as string[],
      status: r.status as "active" | "expired" | "revoked",
    }));
  }

  // ---- OAuth flow ----

  /**
   * Initiate the OAuth 2.0 authorization code flow for a given provider.
   *
   * Returns the authorization URL the user should be redirected to, plus the
   * signed state token (which the callback handler must pass back to
   * handleOAuthCallback for verification).
   *
   * PKCE: declared on the OAuth2Strategy but NOT implemented in v1 of the
   * Connector SDK. The strategy's `pkce` flag is noted below. A future task
   * should generate a code_verifier / code_challenge pair and persist the
   * verifier in the state payload.
   * TODO(v2): implement PKCE -- generate verifier, store in state, send challenge.
   */
  async startOAuthFlow(
    provider: string,
    tenantId: string,
    scopes: string[],
  ): Promise<{ authUrl: string; state: string }> {
    const def = this.getConnector(provider);
    if (!def) throw new Error(`Unknown connector: ${provider}`);
    const strategy = def.auth.find((a): a is OAuth2Strategy => a.type === "oauth2");
    if (!strategy) throw new Error(`No oauth2 strategy for ${provider}`);

    const { clientId } = await this.resolveOAuthClient(provider, tenantId);
    const state = createState(this.stateSecret, { tenantId, provider, scopes });
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: this.redirectUri(provider),
      scope: scopes.join(" "),
      state,
    });
    if (strategy.accessType) params.set("access_type", strategy.accessType);
    if (strategy.prompt) params.set("prompt", strategy.prompt);
    // PKCE is declared on the strategy but its full implementation is out of scope
    // for v1. The `pkce` flag on the strategy is acknowledged here.
    // TODO(v2): generate code_verifier/code_challenge and persist verifier in state.

    return {
      authUrl: `${strategy.authorizationUrl}?${params}`,
      state,
    };
  }

  /**
   * Complete the OAuth 2.0 callback: verify state, exchange the authorization
   * code for tokens, derive the accountId, then upsert the account row.
   *
   * The raw token response is stored as `profile` JSONB. Some providers
   * (e.g., Google) include id_token claims here; downstream callers extract
   * what they need.
   */
  async handleOAuthCallback(
    provider: string,
    code: string,
    state: string,
  ): Promise<ConnectedAccount> {
    const payload = verifyState(this.stateSecret, state);
    if (!payload || payload.provider !== provider) throw new Error("Invalid OAuth state");

    const def = this.getConnector(provider);
    if (!def) throw new Error(`Unknown connector: ${provider}`);
    const strategy = def.auth.find((a): a is OAuth2Strategy => a.type === "oauth2");
    if (!strategy) throw new Error(`No oauth2 strategy for ${provider}`);

    const { clientId, clientSecret } = await this.resolveOAuthClient(provider, payload.tenantId);
    const tokenRes = await fetch(strategy.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: this.redirectUri(provider),
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(
        `Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`,
      );
    }
    const tokenBody = (await tokenRes.json()) as Record<string, unknown>;

    // Enrich the response with id_token claims so resolveAccountId can read
    // identity fields like email/sub. Google's token endpoint puts these in
    // the id_token JWT (when openid scope was requested), not in the top-level
    // response. No signature verification: we trust the source since this
    // came directly from the provider's token endpoint over TLS.
    const profile: Record<string, unknown> = { ...tokenBody };
    if (typeof tokenBody.id_token === "string") {
      const parts = tokenBody.id_token.split(".");
      if (parts.length === 3) {
        try {
          const claims = JSON.parse(
            Buffer.from(parts[1], "base64url").toString("utf8"),
          ) as Record<string, unknown>;
          // Claims first, then token body so access_token et al win.
          for (const [k, v] of Object.entries(claims)) {
            if (!(k in profile)) profile[k] = v;
          }
        } catch {
          // Malformed id_token. Fall through; resolveAccountId may still
          // succeed via other fields or throw a clearer error.
        }
      }
    }

    const accountId = def.resolveAccountId(profile);

    const credentials = packCredentials({
      accessToken: tokenBody.access_token as string,
      refreshToken: tokenBody.refresh_token as string | undefined,
      expiresAt:
        tokenBody.expires_in
          ? Date.now() + (tokenBody.expires_in as number) * 1000
          : undefined,
    });

    await this.db
      .insert(connectorAccounts)
      .values({
        tenantId: payload.tenantId,
        provider,
        accountId,
        authStrategy: "oauth2",
        status: "active",
        credentials,
        grantedScopes: payload.scopes,
        profile: tokenBody as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [
          connectorAccounts.tenantId,
          connectorAccounts.provider,
          connectorAccounts.accountId,
        ],
        set: {
          credentials,
          grantedScopes: payload.scopes,
          status: "active",
          updatedAt: new Date(),
        },
      });

    return {
      accountId,
      provider,
      grantedScopes: payload.scopes,
      status: "active",
    };
  }

  /**
   * Remove a connected account and all module bindings that reference it.
   *
   * Bindings are cleaned up in the same operation so modules don't get
   * orphaned binding rows pointing at a non-existent account.
   */
  async removeAccount(provider: string, accountId: string, tenantId: string): Promise<void> {
    await this.db
      .delete(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.tenantId, tenantId),
          eq(connectorAccounts.provider, provider),
          eq(connectorAccounts.accountId, accountId),
        ),
      );
    // Clean up any module bindings pointing at the removed account.
    await this.db
      .delete(moduleConnectorBindings)
      .where(
        and(
          eq(moduleConnectorBindings.tenantId, tenantId),
          eq(moduleConnectorBindings.provider, provider),
          eq(moduleConnectorBindings.accountId, accountId),
        ),
      );
  }

  // ---- Scope check ----

  async checkScopes(
    provider: string,
    tenantId: string,
    callerModuleId: string,
    scopes: string[],
    opts?: { accountId?: string },
  ): Promise<ScopeCheckResult> {
    // Resolve account id (same logic as getToken).
    let accountId = opts?.accountId;
    if (!accountId) {
      const bindings = await this.db
        .select()
        .from(moduleConnectorBindings)
        .where(
          and(
            eq(moduleConnectorBindings.tenantId, tenantId),
            eq(moduleConnectorBindings.moduleId, callerModuleId),
            eq(moduleConnectorBindings.provider, provider),
          ),
        )
        .limit(1);

      if (!bindings[0]) return { granted: false, missing: scopes };
      accountId = bindings[0].accountId;
    }

    const accounts = await this.db
      .select()
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.tenantId, tenantId),
          eq(connectorAccounts.provider, provider),
          eq(connectorAccounts.accountId, accountId),
        ),
      )
      .limit(1);

    if (!accounts[0]) return { granted: false, missing: scopes };

    const granted = new Set((accounts[0].grantedScopes ?? []) as string[]);
    const missing = scopes.filter((s) => !granted.has(s));
    return { granted: missing.length === 0, missing };
  }

  // ---- Binding management ----

  async bindAccount(
    tenantId: string,
    moduleId: string,
    provider: string,
    accountId: string,
  ): Promise<void> {
    await this.db
      .insert(moduleConnectorBindings)
      .values({ tenantId, moduleId, provider, accountId })
      .onConflictDoUpdate({
        target: [
          moduleConnectorBindings.tenantId,
          moduleConnectorBindings.moduleId,
          moduleConnectorBindings.provider,
        ],
        set: { accountId },
      });
  }

  async unbindAccount(
    tenantId: string,
    moduleId: string,
    provider: string,
  ): Promise<void> {
    await this.db
      .delete(moduleConnectorBindings)
      .where(
        and(
          eq(moduleConnectorBindings.tenantId, tenantId),
          eq(moduleConnectorBindings.moduleId, moduleId),
          eq(moduleConnectorBindings.provider, provider),
        ),
      );
  }

  async getBinding(
    tenantId: string,
    moduleId: string,
    provider: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(moduleConnectorBindings)
      .where(
        and(
          eq(moduleConnectorBindings.tenantId, tenantId),
          eq(moduleConnectorBindings.moduleId, moduleId),
          eq(moduleConnectorBindings.provider, provider),
        ),
      )
      .limit(1);

    return rows[0] ? rows[0].accountId : null;
  }
}
