// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Connection routes: OAuth dance + tenant-connection listing.
//
// Handlers mounted here:
//
//   - GET  /oauth/:provider/authorize : start the OAuth dance (delegates to AuthManager)
//   - GET  /oauth/:provider/callback  : provider callback (delegates to AuthManager)
//   - GET  /connectors                : list providers + per-tenant
//                                       connection state (for the shell)
//   - GET  /status                    : same as /connectors (legacy name)
//   - POST /disconnect/:kind          : admin removes all accounts for a provider
//   - POST /:kind/sync                : pause/resume Gmail forward-sync
//
// All listing/disconnect/sync handlers read from connector_accounts (Task 2.11).
// The legacy `connectors` table is gone.

import { Hono, type Context } from "hono";
import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectorAccounts } from "@boringos/db";
import type { AuthManager } from "./auth-manager.js";
import type { EventBus } from "./event-bus.js";

export interface ConnectorRoutesOptions {
  /** Origin of the shell SPA, allowed as a returnTo target. */
  shellOrigin?: string;
}

interface ProviderEntry {
  kind: string;
  name: string;
  description: string;
  scopes: string[];
}

const PROVIDER_DISPLAY: Record<string, { name: string; description: string }> = {
  google: { name: "Google Workspace", description: "Gmail + Calendar" },
  slack: { name: "Slack", description: "Channels, threads, reactions" },
};

function listProviders(authManager?: AuthManager): ProviderEntry[] {
  const defs = authManager?.listConnectors() ?? [];
  return defs.map((def) => ({
    kind: def.provider,
    name: PROVIDER_DISPLAY[def.provider]?.name ?? def.displayName,
    description: PROVIDER_DISPLAY[def.provider]?.description ?? "",
    scopes: def.services.flatMap((s) => s.scopes.map((sc) => sc.scope)),
  }));
}

// Forward-sync defaults ON: a connected account with no explicit flag
// keeps ingesting. Only an explicit `false` (stored in profile JSONB) pauses it.
function readForwardSyncEnabled(profile: Record<string, unknown> | null | undefined): boolean {
  return (profile as { forwardSyncEnabled?: unknown } | null)?.forwardSyncEnabled !== false;
}

function publicOrigin(c: Context, baseUrl: string): string {
  const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host");
  const proto = c.req.header("X-Forwarded-Proto") ?? "http";
  if (host) return `${proto}://${host}`;
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

export function createConnectorRoutes(
  db: Db,
  // eventBus is reserved for future webhook routing; kept on the
  // signature so callers don't have to change.
  _eventBus: EventBus,
  baseUrl: string,
  opts: ConnectorRoutesOptions = {},
  authManager?: AuthManager,
): Hono {
  const app = new Hono();
  const shellOrigin = opts.shellOrigin ?? process.env.BORINGOS_SHELL_URL ?? "";

  /** Default scopes for a provider, derived from its ConnectorDefinition. */
  function defaultScopesForProvider(provider: string): string[] {
    if (!authManager) return [];
    const def = authManager.getConnector(provider);
    return def?.services.flatMap((s) => s.scopes.map((sc) => sc.scope)) ?? [];
  }

  // ── OAuth (v2 path: delegates to AuthManager) ───────────────

  app.get("/oauth/:provider/authorize", async (c) => {
    const provider = c.req.param("provider");

    const tenantId = c.req.query("tenantId") ?? c.req.header("X-Tenant-Id") ?? "";
    if (!tenantId) return c.json({ error: "tenantId required" }, 400);

    if (!authManager) {
      return c.json({ error: "AuthManager not configured" }, 500);
    }

    const connector = authManager.getConnector(provider);
    if (!connector) return c.json({ error: `Unknown provider: ${provider}` }, 404);

    const rawScopes = c.req.query("scopes");
    const scopes = rawScopes ? rawScopes.split(",").map((s) => s.trim()).filter(Boolean) : defaultScopesForProvider(provider);

    try {
      const { authUrl } = await authManager.startOAuthFlow(provider, tenantId, scopes);
      return c.redirect(authUrl);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return c.json({ error: reason }, 500);
    }
  });

  app.get("/oauth/:provider/callback", async (c) => {
    const provider = c.req.param("provider");
    const code = c.req.query("code");
    const state = c.req.query("state") ?? "";
    const error = c.req.query("error");
    const fallback = `${shellOrigin || publicOrigin(c, baseUrl)}/connectors`;

    if (error) {
      return c.redirect(
        `${fallback}?connect=error&provider=${encodeURIComponent(provider)}&reason=${encodeURIComponent(error)}`,
      );
    }
    if (!code || !state) {
      return c.redirect(
        `${fallback}?connect=error&provider=${encodeURIComponent(provider)}&reason=missing_code_or_state`,
      );
    }

    if (!authManager) {
      return c.redirect(
        `${fallback}?connect=error&provider=${encodeURIComponent(provider)}&reason=auth_manager_not_configured`,
      );
    }

    try {
      await authManager.handleOAuthCallback(provider, code, state);
      return c.redirect(
        `${shellOrigin || publicOrigin(c, baseUrl)}/connectors?connect=ok&provider=${encodeURIComponent(provider)}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "callback_failed";
      return c.redirect(
        `${fallback}?connect=error&provider=${encodeURIComponent(provider)}&reason=${encodeURIComponent(reason)}`,
      );
    }
  });

  // ── Connection listing ────────────────────────────────────
  //
  // Mounted at both `/status` (Connectors screen) and `/connectors`
  // (ui/client hooks). Same handler, different historical names.
  //
  // Response shape (unchanged from before):
  //   { connectors: ConnectorStatusRow[], tenantId: string }
  //
  // ConnectorStatusRow fields:
  //   kind, name, description, hasOAuth, oauthScopes, connected, status,
  //   lastSyncAt (null -- field no longer on connector_accounts), forwardSyncEnabled
  //
  // When a tenant has multiple accounts for the same provider (multi-account),
  // the listing reports the provider as connected if any account is active.
  // `forwardSyncEnabled` reflects the first active account's profile flag.

  const listingHandler = async (c: Context) => {
    // Browser flow: resolve tenant from session token.
    const tenantHeader = c.req.header("X-Tenant-Id");
    let tenantId = tenantHeader ?? "";
    if (!tenantId) {
      const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
      if (!bearer) return c.json({ error: "Authentication required" }, 401);
      const result = await db.execute(sql`
        SELECT ut.tenant_id FROM auth_sessions s
        JOIN user_tenants ut ON ut.user_id = s.user_id
        WHERE s.token = ${bearer} AND s.expires_at > NOW() LIMIT 1
      `);
      const rows = result as unknown as Array<{ tenant_id: string }>;
      if (!rows[0]) return c.json({ error: "Invalid session" }, 401);
      tenantId = rows[0].tenant_id;
    }

    const accounts = await db
      .select()
      .from(connectorAccounts)
      .where(eq(connectorAccounts.tenantId, tenantId));

    // Group accounts by provider. For the per-provider summary the shell
    // expects, we pick the first active account (or any account if none
    // are active) to derive the status + forwardSyncEnabled flag.
    const byProvider = new Map<string, typeof accounts[number]>();
    for (const acct of accounts) {
      const existing = byProvider.get(acct.provider);
      if (!existing || acct.status === "active") {
        byProvider.set(acct.provider, acct);
      }
    }

    const available = listProviders(authManager).map((p) => {
      const match = byProvider.get(p.kind);
      return {
        kind: p.kind,
        name: p.name,
        description: p.description,
        hasOAuth: true,
        oauthScopes: p.scopes,
        connected: !!match,
        // Map connector_accounts.status; fall back to "not_connected" when absent.
        status: match?.status ?? "not_connected",
        // connector_accounts has no lastSyncAt -- always null.
        lastSyncAt: null as null,
        forwardSyncEnabled: readForwardSyncEnabled(
          match?.profile as Record<string, unknown> | null | undefined,
        ),
      };
    });

    return c.json({ connectors: available, tenantId });
  };

  app.get("/status", listingHandler);
  app.get("/connectors", listingHandler);

  // ── Disconnect ────────────────────────────────────────────
  //
  // Removes ALL connector_accounts rows for the given provider + tenant.
  // Uses AuthManager.removeAccount for each account found so bindings
  // are also cleaned up.

  app.post("/disconnect/:kind", async (c) => {
    const kind = c.req.param("kind");
    const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!bearer) return c.json({ error: "Authentication required" }, 401);

    const result = await db.execute(sql`
      SELECT ut.tenant_id, ut.role FROM auth_sessions s
      JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${bearer} AND s.expires_at > NOW() LIMIT 1
    `);
    const rows = result as unknown as Array<{ tenant_id: string; role: string }>;
    if (!rows[0]) return c.json({ error: "Invalid session" }, 401);
    if (rows[0].role !== "admin") return c.json({ error: "Admin only" }, 403);

    const tenantId = rows[0].tenant_id;

    if (authManager) {
      // Remove each account individually so AuthManager also cleans up bindings.
      const existing = await db
        .select({ accountId: connectorAccounts.accountId })
        .from(connectorAccounts)
        .where(
          and(
            eq(connectorAccounts.tenantId, tenantId),
            eq(connectorAccounts.provider, kind),
          ),
        );
      for (const acct of existing) {
        await authManager.removeAccount(kind, acct.accountId, tenantId);
      }
    } else {
      // Fallback: direct delete (no authManager = no binding cleanup needed).
      await db
        .delete(connectorAccounts)
        .where(
          and(
            eq(connectorAccounts.tenantId, tenantId),
            eq(connectorAccounts.provider, kind),
          ),
        );
    }

    return c.json({ ok: true });
  });

  // ── Forward-sync toggle ───────────────────────────────────
  //
  // Pause/resume the Gmail forward-sync ticker for this tenant WITHOUT
  // tearing down the connection. Flips `profile.forwardSyncEnabled` on all
  // connector_accounts rows for the given provider + tenant. The ticker
  // (inbox-gmail-forward-sync.ts) skips accounts where it is false.
  // Reversible and non-destructive, so (unlike disconnect) it is not
  // admin-gated; any tenant member can pause their own sync.

  app.post("/:kind/sync", async (c) => {
    const kind = c.req.param("kind");
    const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!bearer) return c.json({ error: "Authentication required" }, 401);

    const result = await db.execute(sql`
      SELECT ut.tenant_id FROM auth_sessions s
      JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${bearer} AND s.expires_at > NOW() LIMIT 1
    `);
    const rows = result as unknown as Array<{ tenant_id: string }>;
    if (!rows[0]) return c.json({ error: "Invalid session" }, 401);
    const tenantId = rows[0].tenant_id;

    const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return c.json({ error: "Body must include boolean `enabled`" }, 400);
    }
    const enabled = body.enabled;

    const existing = await db
      .select()
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.tenantId, tenantId),
          eq(connectorAccounts.provider, kind),
        ),
      );
    if (!existing.length) return c.json({ error: "Connector not connected" }, 404);

    // Update forwardSyncEnabled on all accounts for this provider.
    for (const acct of existing) {
      const profile = (acct.profile as Record<string, unknown> | null) ?? {};
      const nextProfile = { ...profile, forwardSyncEnabled: enabled };
      await db
        .update(connectorAccounts)
        .set({ profile: nextProfile, updatedAt: new Date() })
        .where(eq(connectorAccounts.id, acct.id));
    }

    return c.json({ ok: true, kind, forwardSyncEnabled: enabled });
  });

  return app;
}
