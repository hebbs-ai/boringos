// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Connection routes: OAuth dance + tenant-connection listing.
//
// Legacy connector routes mounted: OAuth flow, webhook receivers, action invocation,
// connector definition listing. The legacy framework is gone; this
// file now mounts ONLY:
//
//   - GET  /oauth/:provider/authorize : start the OAuth dance (delegates to AuthManager)
//   - GET  /oauth/:provider/callback  : provider callback (delegates to AuthManager)
//   - GET  /connectors                : list providers + per-tenant
//                                       connection state (for the shell)
//   - POST /disconnect/:kind          : admin removes credentials
//
// The authorize/callback handlers now delegate to AuthManager (Task 2.5).
// The listing/disconnect/sync routes still read from the legacy `connectors`
// table and are untouched until Task 2.11 drops that table.
//
// Action invocation and webhook receivers moved to:
//   - /api/tools/<module>.<action> for actions
//   - /api/webhooks/<module-id>/<event> for inbound webhooks
//     (mounted by the Module registry)

import { Hono, type Context } from "hono";
import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors } from "@boringos/db";
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

// Forward-sync defaults ON: a connected connector with no explicit flag
// keeps ingesting. Only an explicit `false` pauses it.
function readForwardSyncEnabled(config: unknown): boolean {
  const gmail = (config as { gmail?: { forwardSyncEnabled?: unknown } } | null)?.gmail;
  return gmail?.forwardSyncEnabled !== false;
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
  // jwtSecret is kept on the signature for backward compatibility;
  // the OAuth dance now delegates to AuthManager which carries its
  // own state secret. Kept until Task 2.11 restructures this signature.
  _jwtSecret: string,
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
  //
  // When authManager is present (always at boot from Task 2.4),
  // the authorize/callback handlers go through AuthManager which
  // uses auth-manager-state.ts for state signing and stores tokens
  // in the new connector_accounts table.
  //
  // Fallback to the legacy path is NOT provided here because
  // authManager is always injected by boringos.ts since Task 2.4.

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
        `${shellOrigin || publicOrigin(c, baseUrl)}/settings/connectors?connect=ok&provider=${encodeURIComponent(provider)}`,
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

    const connected = await db.select().from(connectors).where(eq(connectors.tenantId, tenantId));
    const available = listProviders(authManager).map((p) => {
      const match = connected.find((c) => c.kind === p.kind);
      return {
        kind: p.kind,
        name: p.name,
        description: p.description,
        hasOAuth: true,
        oauthScopes: p.scopes,
        connected: !!match,
        status: match?.status ?? "not_connected",
        lastSyncAt: match?.lastSyncAt,
        forwardSyncEnabled: readForwardSyncEnabled(match?.config),
      };
    });

    return c.json({ connectors: available, tenantId });
  };

  app.get("/status", listingHandler);
  app.get("/connectors", listingHandler);

  // ── Disconnect ────────────────────────────────────────────

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

    await db
      .delete(connectors)
      .where(and(eq(connectors.tenantId, rows[0].tenant_id), eq(connectors.kind, kind)));

    return c.json({ ok: true });
  });

  // ── Forward-sync toggle ───────────────────────────────────
  //
  // Pause/resume the Gmail forward-sync ticker for this tenant
  // WITHOUT tearing down the connection. Flips
  // `config.gmail.forwardSyncEnabled`; the ticker
  // (inbox-gmail-forward-sync.ts) skips connectors where it is false.
  // Reversible and non-destructive, so (unlike disconnect) it is
  // not admin-gated; any tenant member can pause their own sync.

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
      .from(connectors)
      .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, kind)))
      .limit(1);
    if (!existing[0]) return c.json({ error: "Connector not connected" }, 404);

    const cfg = (existing[0].config as Record<string, unknown> | null) ?? {};
    const gmail = (cfg.gmail as Record<string, unknown> | undefined) ?? {};
    const nextConfig = { ...cfg, gmail: { ...gmail, forwardSyncEnabled: enabled } };

    await db
      .update(connectors)
      .set({ config: nextConfig, updatedAt: new Date() })
      .where(eq(connectors.id, existing[0].id));

    return c.json({ ok: true, kind, forwardSyncEnabled: enabled });
  });

  return app;
}
