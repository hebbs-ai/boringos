// SPDX-License-Identifier: GPL-3.0-or-later
//
// Compatibility shim for the v1 CRM REST surface.
//
// Why this exists: the CRM module's web bundle calls
// `/api/crm/<group>(/...)` from a few legacy slots that bypass the
// bundle's own `lib/api.ts` translator (PipelineSettings.tsx is the
// canonical example). Those slots got upgraded to the v2 tool
// surface — `/api/tools/crm.<group>.<verb>` — but the slots still
// call the old paths, so they 404 on a fresh `boringos` install
// and render a blank screen.
//
// We could patch every slot, but the CRM lives in a separate repo
// (`hebbs-crm`) and ships as a `.hebbsmod` bundle; coordinated
// releases are slow and any future legacy-pathed slot would
// re-break. A framework-side shim that translates v1 paths back
// onto v2 tool dispatches is small, sits in front of the
// dispatcher, and decouples the CRM bundle's release cadence from
// the framework's.
//
// Design:
// - `translate(method, path, body)` — pure mapping; ported verbatim
//   from `hebbs-crm/packages/web/src/lib/api.ts` so the v1 ↔ v2
//   contract stays in lockstep. The mapping table comment block
//   below is the source of truth on both sides.
// - `createCrmShimRoutes({ ... })` returns a Hono app that the
//   framework mounts under `/api/crm`. It does the same dual-mode
//   auth as `tool-routes.ts` (callback JWT or shell session
//   bearer), translates, dispatches, unwraps the v2 envelope, and
//   returns the v1-shaped JSON the legacy hooks expect.
//
// Future shims: the file's exports are intentionally clean
// (one `translate()` + one `createCrmShimRoutes(deps)`) so a
// future contributor can add `/api/<moduleId>/*` shims for other
// modules by registering an additional translator. We deliberately
// don't generalise into a registry yet — KISS until a second
// caller exists.

import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import {
  verifyCallbackToken,
  dispatch,
} from "@boringos/agent";
import type { ToolRegistry } from "@boringos/agent";
import type { ToolInvocationSource } from "@boringos/module-sdk";

// ─── Types ──────────────────────────────────────────────────────

export interface Translation {
  toolName: string;
  input: Record<string, unknown>;
}

export interface CrmShimDeps {
  db: Db;
  registry: ToolRegistry;
  jwtSecret: string;
}

interface ResolvedAuth {
  tenantId: string;
  agentId?: string;
  runId?: string;
  wakeOwnerUserId?: string;
  invokedBy: ToolInvocationSource;
}

type ShimEnv = { Variables: { auth: ResolvedAuth } };

// ─── Translate (kept in lockstep with hebbs-crm/packages/web/src/lib/api.ts) ──
//
//   GET    /<group>                  -> crm.<group>.list
//   GET    /<group>/<id>             -> crm.<group>.get          { id }
//   POST   /<group>                  -> crm.<group>.create       { ...body }
//   PUT    /<group>/<id>             -> crm.<group>.update       { id, ...body }
//   DELETE /<group>/<id>             -> crm.<group>.delete       { id }
//
// Plus a few special cases for nested resources:
//   GET    /pipelines/<id>/forecast       -> crm.pipelines.forecast      { id }
//   POST   /pipelines/<id>/stages         -> crm.pipelines.create_stage  { pipelineId: id, ...body }
//   PUT    /pipelines/<id>/stages/<sid>   -> crm.pipelines.update_stage  { pipelineId: id, id: sid, ...body }
//   DELETE /pipelines/<id>/stages/<sid>   -> crm.pipelines.delete_stage  { pipelineId: id, id: sid }
//   GET    /activities/timeline/<cid>     -> crm.activities.timeline     { contactId: cid }
//   GET    /inbox                          -> crm.inbox.list
//   GET    /inbox/<id>/thread              -> crm.inbox.get_thread       { id }
//   POST   /inbox/<id>/reply               -> crm.inbox.reply            { id, ...body }
//   POST   /inbox/<id>/archive-gmail       -> crm.inbox.archive          { id }
//   POST   /inbox/sync                     -> crm.inbox.sync             { ...body }
//   POST   /inbox/backfill-threads         -> crm.inbox.backfill_threads { ...body }
//   POST   /inbox/backfill-bodies          -> crm.inbox.backfill_bodies  { ...body }
//   GET    /actions                        -> crm.actions.list
//   GET    /actions/count                  -> crm.actions.count_pending
//   POST   /actions/<id>/dismiss           -> crm.actions.dismiss        { id }
//   POST   /actions/<id>/complete          -> crm.actions.complete       { id }
//   POST   /actions/<id>/execute           -> crm.actions.execute        { id, ...body }
//   GET    /actions/<id>/comments          -> crm.actions.list_comments  { id }
//   POST   /actions/<id>/comments          -> crm.actions.post_comment   { id, ...body }
//   GET/PUT /profile                       -> crm.profile.get / crm.profile.update

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const [k, v] of new URLSearchParams(qs).entries()) out[k] = v;
  return out;
}

export function translate(method: string, fullPath: string, body?: unknown): Translation {
  const [pathOnly, queryString = ""] = fullPath.split("?");
  const query = parseQuery(queryString);
  const segments = pathOnly.split("/").filter(Boolean);
  const [group, ...rest] = segments;
  const m = method.toUpperCase();
  const bodyObj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  // Special-case routers go first.
  switch (group) {
    case "pipelines": {
      if (rest.length === 2 && rest[1] === "forecast" && m === "GET") {
        return { toolName: "crm.pipelines.forecast", input: { id: rest[0], ...query } };
      }
      if (rest.length === 2 && rest[1] === "stages" && m === "POST") {
        return { toolName: "crm.pipelines.create_stage", input: { pipelineId: rest[0], ...bodyObj } };
      }
      if (rest.length === 3 && rest[1] === "stages") {
        const pipelineId = rest[0];
        const id = rest[2];
        if (m === "PUT") return { toolName: "crm.pipelines.update_stage", input: { pipelineId, id, ...bodyObj } };
        if (m === "DELETE") return { toolName: "crm.pipelines.delete_stage", input: { pipelineId, id } };
      }
      break;
    }
    case "activities": {
      if (rest.length === 2 && rest[0] === "timeline" && m === "GET") {
        return { toolName: "crm.activities.timeline", input: { contactId: rest[1], ...query } };
      }
      break;
    }
    case "inbox": {
      if (rest.length === 0 && m === "GET") return { toolName: "crm.inbox.list", input: query };
      if (rest.length === 1 && rest[0] === "sync" && m === "POST")
        return { toolName: "crm.inbox.sync", input: bodyObj };
      if (rest.length === 1 && rest[0] === "backfill-threads" && m === "POST")
        return { toolName: "crm.inbox.backfill_threads", input: bodyObj };
      if (rest.length === 1 && rest[0] === "backfill-bodies" && m === "POST")
        return { toolName: "crm.inbox.backfill_bodies", input: bodyObj };
      if (rest.length === 2) {
        const id = rest[0];
        if (rest[1] === "thread" && m === "GET") return { toolName: "crm.inbox.get_thread", input: { id } };
        if (rest[1] === "reply" && m === "POST") return { toolName: "crm.inbox.reply", input: { id, ...bodyObj } };
        if (rest[1] === "archive-gmail" && m === "POST") return { toolName: "crm.inbox.archive", input: { id } };
      }
      break;
    }
    case "actions": {
      if (rest.length === 0 && m === "GET") return { toolName: "crm.actions.list", input: query };
      if (rest.length === 1 && rest[0] === "count" && m === "GET")
        return { toolName: "crm.actions.count_pending", input: {} };
      if (rest.length === 2) {
        const id = rest[0];
        if (rest[1] === "dismiss" && m === "POST") return { toolName: "crm.actions.dismiss", input: { id } };
        if (rest[1] === "complete" && m === "POST") return { toolName: "crm.actions.complete", input: { id } };
        if (rest[1] === "execute" && m === "POST")
          return { toolName: "crm.actions.execute", input: { id, ...bodyObj } };
        if (rest[1] === "comments") {
          if (m === "GET") return { toolName: "crm.actions.list_comments", input: { id } };
          if (m === "POST") return { toolName: "crm.actions.post_comment", input: { id, ...bodyObj } };
        }
      }
      break;
    }
    case "profile": {
      if (rest.length === 0) {
        if (m === "GET") return { toolName: "crm.profile.get", input: {} };
        if (m === "PUT") return { toolName: "crm.profile.update", input: bodyObj };
      }
      break;
    }
  }

  // Generic CRUD fallback.
  if (group && rest.length === 0) {
    if (m === "GET") return { toolName: `crm.${group}.list`, input: query };
    if (m === "POST") return { toolName: `crm.${group}.create`, input: bodyObj };
  }
  if (group && rest.length === 1) {
    const id = rest[0];
    if (m === "GET") return { toolName: `crm.${group}.get`, input: { id } };
    if (m === "PUT") return { toolName: `crm.${group}.update`, input: { id, ...bodyObj } };
    if (m === "DELETE") return { toolName: `crm.${group}.delete`, input: { id } };
  }

  throw new NoLegacyRouteError(m, fullPath);
}

export class NoLegacyRouteError extends Error {
  readonly method: string;
  readonly path: string;
  constructor(method: string, path: string) {
    super(`No v2 tool mapping for ${method} ${path}`);
    this.method = method;
    this.path = path;
    this.name = "NoLegacyRouteError";
  }
}

// ─── Hono routes ─────────────────────────────────────────────────

export function createCrmShimRoutes(deps: CrmShimDeps): Hono<ShimEnv> {
  const app = new Hono<ShimEnv>();

  // Same dual-mode auth as `createToolRoutes` — the shim is a
  // legacy face of the same surface, callers must already be
  // shell-authenticated for the real v2 dispatcher anyway.
  app.use("/*", async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        { ok: false, error: { code: "permission_denied", message: "Missing Authorization header", retryable: false } },
        401,
      );
    }
    const token = authHeader.slice(7);

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

    const result = await deps.db.execute(sql`
      SELECT s.user_id, ut.tenant_id
        FROM auth_sessions s
        JOIN user_tenants ut ON ut.user_id = s.user_id
       WHERE s.token = ${token} AND s.expires_at > NOW()
       LIMIT 1
    `);
    const rows = result as unknown as Array<{ user_id: string; tenant_id: string }>;
    if (rows[0]?.tenant_id) {
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

  app.all("/*", async (c) => {
    const auth = c.get("auth");
    const url = new URL(c.req.url);
    const path = url.pathname.replace(/^\/api\/crm/, "");
    const queryString = url.searchParams.toString();
    const fullPath = queryString ? `${path}?${queryString}` : path;

    let body: unknown = undefined;
    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "DELETE" && method !== "HEAD") {
      try {
        const text = await c.req.text();
        body = text ? JSON.parse(text) : undefined;
      } catch {
        return c.json(
          { ok: false, error: { code: "invalid_input", message: "Body must be valid JSON.", retryable: false } },
          400,
        );
      }
    }

    let translation: Translation;
    try {
      translation = translate(method, fullPath, body);
    } catch (err) {
      if (err instanceof NoLegacyRouteError) {
        return c.json(
          {
            ok: false,
            error: {
              code: "no_legacy_route",
              message: err.message,
              retryable: false,
              hint: "Use POST /api/tools/<crm.tool.name> instead.",
            },
          },
          404,
        );
      }
      throw err;
    }

    const idempotencyKey = c.req.header("Idempotency-Key") ?? undefined;

    try {
      const dispatched = await dispatch(
        { registry: deps.registry, db: deps.db },
        translation.toolName,
        translation.input,
        {
          tenantId: auth.tenantId,
          agentId: auth.agentId,
          runId: auth.runId,
          wakeOwnerUserId: auth.wakeOwnerUserId,
          invokedBy: auth.invokedBy,
        },
        { idempotencyKey },
      );

      // Unwrap the v2 envelope back into the v1 shape the legacy
      // hooks expect: success -> the inner `result` payload (e.g.
      // `{ data: [...] }`); failure -> the standard error envelope
      // with the dispatcher's HTTP status.
      const status = dispatched.status as 200 | 400 | 403 | 404 | 500;
      if (dispatched.result.ok) {
        return c.json(dispatched.result.result ?? {}, status);
      }
      return c.json(
        { ok: false, error: dispatched.result.error },
        status,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[crm-shim] dispatch threw for ${translation.toolName}:`, err);
      return c.json(
        { ok: false, error: { code: "internal", message: err instanceof Error ? err.message : String(err), retryable: false } },
        500,
      );
    }
  });

  return app;
}
