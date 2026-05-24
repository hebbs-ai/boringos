import { type AnyPgColumn, pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { agents } from "./agents.js";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    /**
     * Whose turn it is. Drives the auto-rewake gate and the UI's
     * "Waiting on you" badge. Independent of `status` — `status`
     * is the lifecycle (todo/in_progress/done), `next_actor` is
     * the handoff state machine ('agent' / 'human' / null).
     *
     * - `agent`: agent should pick up. Auto-rewake fires.
     * - `human`: human should pick up. Auto-rewake skipped.
     * - `null`: terminal. Set when status='done' or task cancelled.
     *
     * Set on creation by tasks.create (mirrors assignee). Flipped
     * to 'human' automatically when an agent run completes (see
     * agent/lifecycle.ts). Flipped back to 'agent' by the user's
     * "Send back to agent" action (admin route).
     */
    nextActor: text("next_actor"),
    priority: text("priority").notNull().default("medium"),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    assigneeUserId: uuid("assignee_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id"),
    issueNumber: integer("issue_number"),
    identifier: text("identifier"),
    originKind: text("origin_kind").notNull().default("manual"),
    originId: text("origin_id"),
    /**
     * Pre-filled payload for `agent_action` tasks — everything the executor
     * needs to do the work when the human clicks Approve. Examples: draft
     * email body for `kind: 'reply'`, datetime + attendees for
     * `kind: 'schedule_meeting'`, target stage for `kind: 'update_stage'`.
     */
    proposedParams: jsonb("proposed_params").$type<Record<string, unknown>>(),
    /**
     * Open-ended metadata jsonb. Used today by the approvals-as-tasks
     * design to stamp `metadata.approval = { decision, decidedAt,
     * decidedByUserId, comment }` on `origin_kind='agent_action'`
     * tasks. Future fields can ride here without schema churn.
     */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    /**
     * The Claude Code session id this task's conversation lives in.
     * Set on first run completion; resumed on every subsequent wake of
     * this task. One session per task, full stop — no per-agent
     * sessions, no shared transcripts.
     */
    sessionId: text("session_id"),
    /**
     * Which runtime created the session in `sessionId`. Sessions are
     * runtime-specific — a Claude session id cannot be resumed by pi
     * (and vice versa). The engine only resumes when this matches the
     * agent's current runtime type; otherwise it starts a fresh session
     * (no false "resuming session X"). NULL = legacy ⇒ treated as
     * "claude". See docs/pi-runtime-integration.md.
     */
    sessionRuntimeType: text("session_runtime_type"),
    requestDepth: integer("request_depth").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantStatusIdx: index("tasks_tenant_status_idx").on(table.tenantId, table.status),
    assigneeAgentIdx: index("tasks_assignee_agent_idx").on(table.assigneeAgentId),
  }),
);

export const taskComments = pgTable("task_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  body: text("body").notNull(),
  authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
  authorUserId: uuid("author_user_id"),
  mentions: jsonb("mentions").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskWorkProducts = pgTable("task_work_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
