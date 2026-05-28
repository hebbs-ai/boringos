// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tool dispatch — the single agent-callable HTTP surface.
//
// One endpoint: `POST /api/tools/:fullName`. The full name is the
// dotted form `<module-id>.<tool-name>` (e.g. "framework.tasks.patch",
// "google.send_email"). Auth is the same JWT used by `/api/agent/*`
// so agent runtimes can call tools with no client changes.
//
// Mounted by `boringos.ts` only when at least one module is
// registered.

import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import {
  verifyCallbackToken,
  dispatch,
} from "@boringos/agent";
import type {
  ToolRegistry,
  InstallManager,
} from "@boringos/agent";
import type { ToolInvocationSource } from "@boringos/module-sdk";
import { tenantContext } from "./tenant-context.js";

interface ResolvedAuth {
  tenantId: string;
  agentId?: string;
  runId?: string;
  /** task_23 — wake-owner from JWT claim or admin session. */
  wakeOwnerUserId?: string;
  invokedBy: ToolInvocationSource;
}

type AuthEnv = {
  Variables: { auth: ResolvedAuth };
};

export interface ToolRoutesDeps {
  db: Db;
  registry: ToolRegistry;
  jwtSecret: string;
  /** Optional. When provided, the dispatcher gates calls on the
   * tool's owning module being installed for the JWT's tenant. */
  installManager?: InstallManager;
}

export function createToolRoutes(deps: ToolRoutesDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // Dual-mode auth: agents present a callback JWT (signed by the
  // engine when a run is launched); the shell + admin tooling
  // present a session bearer token. Either resolves to a tenant
  // context the dispatcher can use.
  app.use("/*", async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        { ok: false, error: { code: "permission_denied", message: "Missing Authorization header", retryable: false } },
        401,
      );
    }
    const token = authHeader.slice(7);

    // 1) Callback JWT (agent runtime).
    const claims = verifyCallbackToken(token, deps.jwtSecret);
    if (claims) {
      c.set("auth", {
        tenantId: claims.tenant_id,
        agentId: claims.agent_id,
        runId: claims.sub,
        wakeOwnerUserId: claims.wake_owner_user_id,
        invokedBy: "agent",
      });
      return next();
    }

    // 2) Session bearer (shell user).
    const result = await deps.db.execute(sql`
      SELECT s.user_id, ut.tenant_id
        FROM auth_sessions s
        JOIN user_tenants ut ON ut.user_id = s.user_id
       WHERE s.token = ${token} AND s.expires_at > NOW()
       LIMIT 1
    `);
    const rows = result as unknown as Array<{ user_id: string; tenant_id: string }>;
    if (rows[0]?.tenant_id) {
      // Admin dispatches: the session user IS the wake-owner for ACL
      // purposes. They can reach their own users/<id>/ without being
      // gated by the "agents can't touch users/*" rule.
      c.set("auth", {
        tenantId: rows[0].tenant_id,
        wakeOwnerUserId: rows[0].user_id,
        invokedBy: "admin",
      });
      return next();
    }

    return c.json(
      { ok: false, error: { code: "permission_denied", message: "Invalid or expired token", retryable: false } },
      401,
    );
  });

  app.post("/:fullName", async (c) => {
    const auth = c.get("auth");
    const fullName = c.req.param("fullName");
    let body: unknown = {};
    try {
      const text = await c.req.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return c.json(
        { ok: false, error: { code: "invalid_input", message: "Body must be valid JSON.", retryable: false } },
        400,
      );
    }

    // Per-tenant install gate — only meaningful for tools that
    // actually exist. Unknown tools fall through to the
    // dispatcher's 404 path so callers get the right error.
    if (deps.installManager && deps.registry.get(fullName)) {
      const moduleId = fullName.includes(".")
        ? fullName.slice(0, fullName.indexOf("."))
        : "";
      if (moduleId) {
        const installed = await deps.installManager.isInstalled(
          moduleId,
          auth.tenantId,
        );
        if (!installed) {
          return c.json(
            {
              ok: false,
              error: {
                code: "permission_denied",
                message:
                  `Module "${moduleId}" is not installed for this tenant. ` +
                  "An admin can install it via POST /api/admin/modules/<id>/install.",
                retryable: false,
              },
            },
            403,
          );
        }
      }
    }

    const idempotencyKey = c.req.header("Idempotency-Key") ?? undefined;

    try {
      // Wrap the dispatch call in tenantContext.run() so that
      // ModuleFactoryDeps auth helpers (getConnectorToken, etc.) can
      // read the tenantId from AsyncLocalStorage without it appearing
      // in the public deps signature.
      const dispatched = await tenantContext.run(auth.tenantId, () =>
        dispatch(
          { registry: deps.registry, db: deps.db },
          fullName,
          body,
          {
            tenantId: auth.tenantId,
            agentId: auth.agentId,
            runId: auth.runId,
            wakeOwnerUserId: auth.wakeOwnerUserId,
            invokedBy: auth.invokedBy,
          },
          { idempotencyKey },
        ),
      );

      return c.json(dispatched.result, dispatched.status as 200 | 400 | 403 | 404 | 500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[tool-routes] dispatch threw for ${fullName}:`, err);
      return c.json(
        { ok: false, error: { code: "internal", message: err instanceof Error ? err.message : String(err), retryable: false } },
        500,
      );
    }
  });

  return app;
}
