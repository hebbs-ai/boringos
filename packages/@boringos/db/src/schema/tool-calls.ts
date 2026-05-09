// SPDX-License-Identifier: MIT
//
// `tool_calls` — audit row for every Tool invocation.
//
// Phase 1 of the v2 rebuild adds this table. Phase 2's dispatcher
// writes to it. The table is unused until Phase 2 lands; the
// migration is additive so it can ship now without touching v1
// code paths.
//
// One row per invocation:
//  - HTTP calls from agents (POST /api/tools/<name>)
//  - In-process calls from workflow nodes
//  - In-process calls from routines + admin endpoints + lifecycle
//
// All v1 callable surfaces (connector actions, framework callback
// handlers, plugin hooks) keep their existing logging until those
// surfaces are retired.

import { pgTable, uuid, text, jsonb, timestamp, integer, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * Fully-qualified tool name: `<module-id>.<tool-name>`,
     * e.g. "framework.tasks.patch", "google.send_email".
     */
    toolName: text("tool_name").notNull(),
    /** Module that owns the tool — denormalized for query speed. */
    moduleId: text("module_id").notNull(),
    /**
     * Where the call came from. One of:
     * "agent" | "routine" | "workflow" | "admin" | "internal".
     */
    invokedBy: text("invoked_by").notNull(),
    /** Optional — the agent making the call, when known. */
    agentId: uuid("agent_id"),
    /** Optional — the run the call happened within, when known. */
    runId: uuid("run_id"),
    /** Optional — the task in scope, when known. */
    taskId: uuid("task_id"),
    /** Validated inputs (post-Zod). */
    inputs: jsonb("inputs").$type<Record<string, unknown>>(),
    /** Successful result body, if any. */
    result: jsonb("result").$type<Record<string, unknown>>(),
    /** Structured error from the tool, if any. */
    error: jsonb("error").$type<Record<string, unknown>>(),
    /**
     * Outcome:
     *  - "ok"               — handler returned `{ ok: true }`
     *  - "error"            — handler returned `{ ok: false, error }`
     *  - "validation_failed" — input failed schema validation
     *  - "permission_denied" — caller lacks permission for tool
     *  - "not_found"        — unknown tool name
     *  - "internal"         — handler threw uncaught
     */
    status: text("status").notNull(),
    /** Wall-clock duration in ms. */
    durationMs: integer("duration_ms"),
    /** Optional idempotency key supplied by caller. */
    idempotencyKey: text("idempotency_key"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => ({
    tenantToolIdx: index("tool_calls_tenant_tool_idx").on(table.tenantId, table.toolName),
    tenantStartedIdx: index("tool_calls_tenant_started_idx").on(table.tenantId, table.startedAt),
    runIdx: index("tool_calls_run_idx").on(table.runId),
  }),
);
