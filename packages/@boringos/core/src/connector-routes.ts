// SPDX-License-Identifier: MIT
//
// Connection routes — OAuth dance + tenant-connection listing.
//
// v1 mounted: OAuth flow, webhook receivers, action invocation,
// connector definition listing. The v1 framework is gone; this
// file now mounts ONLY:
//
//   - GET  /oauth/:kind/authorize — start the OAuth dance
//   - GET  /oauth/:kind/callback  — provider callback (persists
//                                   credentials in `connectors`)
//   - GET  /connectors            — list providers + per-tenant
//                                   connection state (for the shell)
//   - POST /disconnect/:kind      — admin removes credentials
//
// Action invocation and webhook receivers moved to:
//   - /api/tools/<module>.<action> for actions
//   - /api/webhooks/<module-id>/<event> for inbound webhooks
//     (mounted by the v2 Module registry)

import { Hono, type Context } from "hono";
import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors } from "@boringos/db";
import { generateId } from "@boringos/shared";
import {
  createOAuthManager,
  createState,
  verifyState,
  isSafeReturnTo,
  OAUTH_PROVIDERS,
  type OAuthConfig,
} from "./oauth.js";
import type { EventBus } from "./event-bus.js";

export interface ConnectorRoutesOptions {
  /** Origin of the shell SPA, allowed as a returnTo target. */
  shellOrigin?: string;
}

interface ProviderEntry {
  kind: string;
  name: string;
  description: string;
  oauth: OAuthConfig;
}

const PROVIDER_DISPLAY: Record<string, { name: string; description: string }> = {
  google: { name: "Google Workspace", description: "Gmail + Calendar" },
  slack: { name: "Slack", description: "Channels, threads, reactions" },
};

function listProviders(): ProviderEntry[] {
  return Object.entries(OAUTH_PROVIDERS).map(([kind, oauth]) => ({
    kind,
    name: PROVIDER_DISPLAY[kind]?.name ?? kind,
    description: PROVIDER_DISPLAY[kind]?.description ?? "",
    oauth,
  }));
}

function readEnvClient(kind: string): { clientId?: string; clientSecret?: string } {
  const env = kind.toUpperCase();
  return {
    clientId: process.env[`${env}_CLIENT_ID`],
    clientSecret: process.env[`${env}_CLIENT_SECRET`],
  };
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

function resolveReturnTo(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  return raw;
}

export function createConnectorRoutes(
  db: Db,
  // eventBus is reserved for future webhook routing; kept on the
  // signature so callers don't have to change.
  _eventBus: EventBus,
  jwtSecret: string,
  baseUrl: string,
  opts: ConnectorRoutesOptions = {},
): Hono {
  const app = new Hono();
  const shellOrigin = opts.shellOrigin ?? process.env.BORINGOS_SHELL_URL ?? "";

  function buildAllowedOrigins(callerOrigin: string): string[] {
    const list = new Set<string>([callerOrigin]);
    if (shellOrigin) list.add(shellOrigin);
    return Array.from(list);
  }

  // ── OAuth ──────────────────────────────────────────────────

  app.get("/oauth/:kind/authorize", async (c) => {
    const kind = c.req.param("kind");
    const provider = OAUTH_PROVIDERS[kind];
    if (!provider) return c.json({ error: `Unknown provider: ${kind}` }, 404);

    const tenantId = c.req.query("tenantId") ?? c.req.header("X-Tenant-Id") ?? "";
    if (!tenantId) return c.json({ error: "tenantId required" }, 400);

    const { clientId, clientSecret } = readEnvClient(kind);
    if (!clientId || !clientSecret) {
      return c.json(
        {
          error: `Missing ${kind.toUpperCase()}_CLIENT_ID / ${kind.toUpperCase()}_CLIENT_SECRET in environment.`,
        },
        500,
      );
    }

    const callerOrigin = publicOrigin(c, baseUrl);
    const allowed = buildAllowedOrigins(callerOrigin);
    const rawReturn = c.req.query("returnTo");
    const returnTo = isSafeReturnTo(rawReturn ?? "", allowed)
      ? rawReturn!
      : resolveReturnTo(undefined, `${shellOrigin || callerOrigin}/connectors`);

    const oauth = createOAuthManager(provider, clientId, clientSecret);
    const redirectUri = `${callerOrigin}/api/connectors/oauth/${kind}/callback`;
    const state = createState({ tenantId, returnTo }, jwtSecret);
    return c.redirect(oauth.getAuthorizationUrl(redirectUri, state));
  });

  app.get("/oauth/:kind/callback", async (c) => {
    const kind = c.req.param("kind");
    const provider = OAUTH_PROVIDERS[kind];
    if (!provider) return c.text(`Unknown provider: ${kind}`, 400);

    const code = c.req.query("code");
    const stateRaw = c.req.query("state") ?? "";
    const error = c.req.query("error");
    const callerOrigin = publicOrigin(c, baseUrl);
    const fallback = `${shellOrigin || callerOrigin}/connectors`;

    if (error) {
      return c.redirect(
        `${fallback}?connect=error&kind=${encodeURIComponent(kind)}&reason=${encodeURIComponent(error)}`,
      );
    }
    if (!code) {
      return c.redirect(
        `${fallback}?connect=error&kind=${encodeURIComponent(kind)}&reason=missing_code`,
      );
    }

    const verified = verifyState(stateRaw, jwtSecret);
    if (!verified.ok || !verified.payload) {
      return c.redirect(
        `${fallback}?connect=error&kind=${encodeURIComponent(kind)}&reason=${encodeURIComponent(verified.reason ?? "bad_state")}`,
      );
    }
    const { tenantId, returnTo } = verified.payload;

    const { clientId, clientSecret } = readEnvClient(kind);
    if (!clientId || !clientSecret) {
      return c.redirect(
        `${fallback}?connect=error&kind=${encodeURIComponent(kind)}&reason=missing_client`,
      );
    }

    const oauth = createOAuthManager(provider, clientId, clientSecret);
    const redirectUri = `${callerOrigin}/api/connectors/oauth/${kind}/callback`;

    try {
      const tokens = await oauth.exchangeCode(code, redirectUri);
      const credentialBag = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt?.toISOString(),
      };
      const existing = await db
        .select()
        .from(connectors)
        .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, kind)))
        .limit(1);
      if (existing[0]) {
        await db
          .update(connectors)
          .set({ credentials: credentialBag, status: "active", updatedAt: new Date() })
          .where(eq(connectors.id, existing[0].id));
      } else {
        await db.insert(connectors).values({
          id: generateId(),
          tenantId,
          kind,
          status: "active",
          config: {},
          credentials: credentialBag,
        });
      }
      return c.redirect(`${returnTo}?connect=ok&kind=${encodeURIComponent(kind)}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "exchange_failed";
      return c.redirect(
        `${fallback}?connect=error&kind=${encodeURIComponent(kind)}&reason=${encodeURIComponent(reason)}`,
      );
    }
  });

  // ── Connection listing ────────────────────────────────────
  //
  // Mounted at both `/status` (Connectors screen) and `/connectors`
  // (ui/client hooks) — same handler, different historical names.

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
    const available = listProviders().map((p) => {
      const match = connected.find((c) => c.kind === p.kind);
      return {
        kind: p.kind,
        name: p.name,
        description: p.description,
        hasOAuth: true,
        oauthScopes: p.oauth.scopes,
        connected: !!match,
        status: match?.status ?? "not_connected",
        lastSyncAt: match?.lastSyncAt,
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

  return app;
}
