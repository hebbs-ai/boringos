import { type AnyPgColumn, pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { agents } from "./agents.js";

export const agentWakeupRequests = pgTable("agent_wakeup_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  taskId: uuid("task_id"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  coalescedCount: integer("coalesced_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    wakeupRequestId: uuid("wakeup_request_id").references(() => agentWakeupRequests.id),
    status: text("status").notNull().default("queued"),
    exitCode: integer("exit_code"),
    error: text("error"),
    errorCode: text("error_code"),
    stdoutExcerpt: text("stdout_excerpt"),
    stderrExcerpt: text("stderr_excerpt"),
    usageJson: jsonb("usage_json").$type<Record<string, unknown>>(),
    contextSnapshot: jsonb("context_snapshot").$type<Record<string, unknown>>(),
    model: text("model"),
    sessionIdBefore: text("session_id_before"),
    sessionIdAfter: text("session_id_after"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantAgentIdx: index("agent_runs_tenant_agent_idx").on(table.tenantId, table.agentId),
  }),
);

export const costEvents = pgTable("cost_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  runId: uuid("run_id").references(() => agentRuns.id),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  model: text("model"),
  costUsd: text("cost_usd"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
