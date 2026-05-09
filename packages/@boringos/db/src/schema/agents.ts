import { type AnyPgColumn, pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { runtimes } from "./runtimes.js";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    role: text("role").notNull().default("general"),
    type: text("type").notNull().default("user"),
    source: text("source").notNull().default("user"),
    sourceAppId: text("source_app_id"),
    title: text("title"),
    icon: text("icon"),
    status: text("status").notNull().default("idle"),
    reportsTo: uuid("reports_to").references((): AnyPgColumn => agents.id),
    instructions: text("instructions"),
    runtimeId: uuid("runtime_id").references(() => runtimes.id, { onDelete: "set null" }),
    fallbackRuntimeId: uuid("fallback_runtime_id").references(() => runtimes.id, { onDelete: "set null" }),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    permissions: jsonb("permissions").$type<Record<string, unknown>>().notNull().default({}),
    routingTags: jsonb("routing_tags").$type<string[]>().notNull().default([]),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantStatusIdx: index("agents_tenant_status_idx").on(table.tenantId, table.status),
    tenantSourceIdx: index("agents_tenant_source_idx").on(table.tenantId, table.source),
    tenantSourceAppIdx: index("agents_tenant_source_app_idx").on(table.tenantId, table.sourceAppId),
  }),
);

// Removed: agent_runtime_state. Sessions are now task-scoped — see
// tasks.session_id. Cumulative token/cost tracking moved to per-run
// aggregation via agent_runs.usage_json.
