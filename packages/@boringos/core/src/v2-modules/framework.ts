// SPDX-License-Identifier: MIT
//
// The `framework` Module — built-in. Ships every operation that
// today lives behind `/api/agent/*` as a Tool, plus three core
// SKILL.md files (tool-protocol / approvals / when-stuck) that
// teach the agent the calling convention and core procedures.
//
// Phase 4 of task_12. Behaviour is identical to v1's
// `routes.ts` handlers — the tool handlers delegate to the same
// Drizzle operations. v1 routes continue to work in parallel
// during the migration; cutover removes them.

import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import {
  tasks,
  taskComments,
  taskWorkProducts,
  costEvents,
  agents,
  inboxItems,
} from "@boringos/db";
import { generateId } from "@boringos/shared";
import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  ModuleFactoryDeps,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";
import type { AgentEngine } from "@boringos/agent";

/**
 * The wake-reason literal union the engine enforces (mirrored
 * here so this module doesn't import @boringos/shared's full
 * type tree).
 */
type EngineWakeReason =
  | "comment_posted"
  | "comment_mentioned"
  | "routine_triggered"
  | "manual_request"
  | "approval_resolved"
  | "connector_event";

type EngineWakeRequest = {
  agentId: string;
  tenantId: string;
  reason: EngineWakeReason;
  taskId?: string;
};

const TOOL_PROTOCOL_SKILL = `Every tool you can call is at \`POST $BORINGOS_CALLBACK_URL/api/tools/<name>\`.
The full tool name is \`<module-id>.<tool-name>\` (e.g. \`framework.tasks.patch\`,
\`google.send_email\`). Authentication is the bearer token in
\`$BORINGOS_CALLBACK_TOKEN\`. The body is JSON matching the tool's input
schema. The response is one of:

- \`{ "ok": true, "result": ... }\` — success
- \`{ "ok": false, "error": { "code", "message", "retryable", "details" } }\` — handled error

HTTP status:
- 200 — handler ran (regardless of success or business error)
- 400 — input failed schema validation; \`error.details\` lists the issues
- 401 — token invalid/expired; do not retry, end your run
- 404 — unknown tool name
- 5xx — framework bug; one retry, then stop

If \`error.retryable\` is true, retry with exponential backoff. Otherwise,
post a comment explaining what failed and either ask for help or use the
"When you're stuck" procedure.`;

const APPROVALS_SKILL = `Default-deny posture: ask before acting on anything that
sends a message, modifies a 3rd-party system, spends money, or otherwise
affects the world outside this run. Examples: sending email, posting to
Slack, scheduling a meeting, paying an invoice, deleting data.

To request approval, create a child task with \`originKind: "agent_action"\`
and \`proposedParams\` describing the action. The user reviews; if
approved, a comment lands on this task with \`**Approved.**\` plus the
action's parameters inline. Apply any modifications they noted, then
execute.

Read-only operations don't need approval: querying a CRM, reading email,
listing files. When in doubt, ask.`;

const WHEN_STUCK_SKILL = `You're stuck when you cannot make progress regardless
of how many more attempts. Examples:
- A capability you'd need isn't in your tools catalog
- The task description is genuinely ambiguous
- A field or fact the work depends on doesn't exist yet

When stuck, do this in order:

1. Post a final comment explaining what you delivered, what's missing,
   and the specific action the user needs to take.
2. Use \`framework.tasks.patch\` to set
   \`{ status: "blocked", assigneeAgentId: null, assigneeUserId: <task creator's user id> }\`.
   This stops the auto-rewake loop and routes the task to the user's
   "My todos" tab.
3. End your run.

Do NOT silently re-comment "(awaiting input)" and end with status \`todo\`.
The framework treats \`todo\` as actionable and re-wakes you on the same
task — that loops forever and burns budget. The same-task auto-rewake
guard catches this once, but the procedure above is the right answer.`;

interface FrameworkDeps {
  db: Db;
  /** Holder reference — read at dispatch time, populated by the
   * host after `createAgentEngine` returns. */
  factoryDeps: ModuleFactoryDeps;
}

/** Pull a working AgentEngine reference, or throw a clean error. */
function getEngine(deps: FrameworkDeps): AgentEngine | null {
  return (deps.factoryDeps.engine as AgentEngine | undefined) ?? null;
}

/**
 * Spawn an agent run for (agentId, taskId). Used by:
 *   - the explicit `framework.agents.wake` tool
 *   - auto-wake from `framework.tasks.create` when an
 *     assigneeAgentId is supplied
 *
 * Goes through the standard wake → enqueue path so coalescing,
 * pause-state, and budget guards apply. Returns the wakeup
 * outcome shape for visibility.
 */
async function wakeAgent(
  deps: FrameworkDeps,
  ctx: ToolContext,
  request: EngineWakeRequest,
): Promise<ToolResult> {
  const engine = getEngine(deps);
  if (!engine) {
    return {
      ok: false,
      error: {
        code: "internal",
        message:
          "Agent engine is not yet available. The host has not finished booting.",
        retryable: true,
      },
    };
  }
  const outcome = await engine.wake(request);
  if (outcome.kind === "agent_not_found") {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: `Agent ${request.agentId} not found in this tenant.`,
        retryable: false,
      },
    };
  }
  if (outcome.kind === "agent_not_invokable") {
    return {
      ok: false,
      error: {
        code: "permission_denied",
        message: `Agent is paused (status=${outcome.agentStatus}).`,
        retryable: false,
      },
    };
  }
  // created / coalesced — both are fine. Enqueue so the queue
  // actually drains (created wakes come back as queued; coalesced
  // wakes already have a job in flight).
  if (outcome.kind === "created") {
    await engine.enqueue(outcome.wakeupRequestId);
  }
  return {
    ok: true,
    result: { kind: outcome.kind, runWasCoalesced: outcome.kind === "coalesced" },
  };
}

function makeReadTask(db: Db): Tool {
  return {
    name: "tasks.read",
    description: "Read a task and its comments",
    inputs: z.object({ taskId: z.string().uuid() }),
    async handler(input: { taskId: string }): Promise<ToolResult> {
      const taskRows = await db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
      const task = taskRows[0];
      if (!task) {
        return {
          ok: false,
          error: { code: "not_found", message: "Task not found", retryable: false },
        };
      }
      const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, input.taskId));
      return { ok: true, result: { task, comments } };
    },
  };
}

function makePatchTask(db: Db): Tool {
  return {
    name: "tasks.patch",
    description:
      "Update a task's status, title, description, priority, assignees, or parent",
    inputs: z
      .object({
        taskId: z.string().uuid(),
        status: z.string().optional(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        priority: z.string().optional(),
        assigneeAgentId: z.string().uuid().nullable().optional(),
        assigneeUserId: z.string().uuid().nullable().optional(),
        parentId: z.string().uuid().nullable().optional(),
        // Accept arbitrary JSON object — used by the copilot's
        // first-wake rename to set `{"titleAuto": false}` and pin
        // the new title against future auto-renames.
        metadata: z.record(z.unknown()).optional(),
      })
      .refine(
        (v) =>
          v.status !== undefined ||
          v.title !== undefined ||
          v.description !== undefined ||
          v.priority !== undefined ||
          v.assigneeAgentId !== undefined ||
          v.assigneeUserId !== undefined ||
          v.parentId !== undefined ||
          v.metadata !== undefined,
        { message: "At least one field must be provided" },
      ),
    async handler(
      input: {
        taskId: string;
        status?: string;
        title?: string;
        description?: string | null;
        priority?: string;
        assigneeAgentId?: string | null;
        assigneeUserId?: string | null;
        parentId?: string | null;
        metadata?: Record<string, unknown>;
      },
    ): Promise<ToolResult> {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.status !== undefined) updates.status = input.status;
      if (input.title !== undefined) updates.title = input.title;
      if (input.description !== undefined) updates.description = input.description;
      if (input.priority !== undefined) updates.priority = input.priority;
      if (input.assigneeAgentId !== undefined) updates.assigneeAgentId = input.assigneeAgentId;
      if (input.assigneeUserId !== undefined) updates.assigneeUserId = input.assigneeUserId;
      if (input.parentId !== undefined) updates.parentId = input.parentId;
      // Merge into existing metadata so callers can set individual
      // keys without clobbering siblings ({titleAuto: false} keeps
      // any other metadata fields intact).
      if (input.metadata !== undefined) {
        const existingRows = await db.select({ metadata: tasks.metadata }).from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
        const existing = (existingRows[0]?.metadata as Record<string, unknown> | null) ?? {};
        updates.metadata = { ...existing, ...input.metadata };
      }

      await db.update(tasks).set(updates).where(eq(tasks.id, input.taskId));
      return { ok: true, result: { ok: true } };
    },
  };
}

function makeCreateTask(deps: FrameworkDeps): Tool {
  const db = deps.db;
  return {
    name: "tasks.create",
    description: "Create a task. Use originKind 'agent_action' for approval flows",
    inputs: z.object({
      title: z.string(),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      parentId: z.string().uuid().optional(),
      assigneeAgentId: z.string().uuid().optional(),
      assigneeUserId: z.string().uuid().optional(),
      originKind: z.string().optional(),
      proposedParams: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: {
        title: string;
        description?: string;
        status?: string;
        priority?: string;
        parentId?: string;
        assigneeAgentId?: string;
        assigneeUserId?: string;
        originKind?: string;
        proposedParams?: Record<string, unknown>;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const id = generateId();
      const originKind = input.originKind ?? "agent_created";

      // Replicates v1 routes.ts logic: `agent_action` / `human_todo` /
      // `agent_blocked` tasks need a human assignee; default it to
      // the parent's owner if the agent didn't supply one.
      let assigneeUserId = input.assigneeUserId;
      const needsHumanInbox =
        originKind === "agent_action" ||
        originKind === "human_todo" ||
        originKind === "agent_blocked";
      if (needsHumanInbox && !assigneeUserId && input.parentId) {
        const parentRows = await db
          .select({
            assigneeUserId: tasks.assigneeUserId,
            createdByUserId: tasks.createdByUserId,
          })
          .from(tasks)
          .where(eq(tasks.id, input.parentId))
          .limit(1);
        const parent = parentRows[0];
        if (parent) {
          assigneeUserId = parent.assigneeUserId ?? parent.createdByUserId ?? undefined;
        }
      }

      await db.insert(tasks).values({
        id,
        tenantId: ctx.tenantId,
        title: input.title,
        description: input.description,
        status: input.status ?? "todo",
        priority: input.priority ?? "medium",
        parentId: input.parentId,
        assigneeAgentId: input.assigneeAgentId,
        assigneeUserId,
        createdByAgentId: ctx.agentId,
        originKind,
        proposedParams: input.proposedParams,
      });

      // Auto-wake the assignee agent (parity with v1's admin
      // create-task endpoint). If no assignee agent or no engine
      // available, skip silently — the row exists either way and
      // the next external trigger picks it up.
      let wake: { kind: string; runWasCoalesced: boolean } | undefined;
      if (input.assigneeAgentId) {
        const engine = getEngine(deps);
        if (engine) {
          try {
            const outcome = await engine.wake({
              agentId: input.assigneeAgentId,
              tenantId: ctx.tenantId,
              // closest existing wake-reason for "task assigned to
              // this agent" — the v1 admin endpoint uses the same
              // mapping. A new "task_assigned" literal would be a
              // separate change to the shared union.
              reason: "manual_request",
              taskId: id,
            });
            if (outcome.kind === "created") {
              await engine.enqueue(outcome.wakeupRequestId);
              wake = { kind: outcome.kind, runWasCoalesced: false };
            } else if (outcome.kind === "coalesced") {
              wake = { kind: outcome.kind, runWasCoalesced: true };
            }
          } catch {
            // wake failure shouldn't block task creation
          }
        }
      }
      return { ok: true, result: { id, wake } };
    },
  };
}

function makeWakeAgent(deps: FrameworkDeps): Tool {
  return {
    name: "agents.wake",
    description:
      "Wake an agent on a task. Coalesces with any in-flight run. Respects pause state.",
    inputs: z.object({
      agentId: z.string().uuid(),
      taskId: z.string().uuid().optional(),
      reason: z.string().optional(),
    }),
    async handler(
      input: { agentId: string; taskId?: string; reason?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      // The user-supplied reason is informational; the engine's
      // typed reason union is fixed. Default to manual_request.
      const reason: EngineWakeReason = "manual_request";
      void input.reason;
      return wakeAgent(deps, ctx, {
        agentId: input.agentId,
        tenantId: ctx.tenantId,
        reason,
        taskId: input.taskId,
      });
    },
  };
}

function makePostComment(db: Db): Tool {
  return {
    name: "comments.post",
    description: "Post a comment on a task",
    inputs: z.object({
      taskId: z.string().uuid(),
      body: z.string(),
    }),
    async handler(
      input: { taskId: string; body: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const id = generateId();
      await db.insert(taskComments).values({
        id,
        taskId: input.taskId,
        tenantId: ctx.tenantId,
        body: input.body,
        authorAgentId: ctx.agentId,
      });
      return { ok: true, result: { id } };
    },
  };
}

function makeRecordWorkProduct(db: Db): Tool {
  return {
    name: "work_products.record",
    description: "Record a deliverable on a task (PR url, document, etc.)",
    inputs: z.object({
      taskId: z.string().uuid(),
      kind: z.string(),
      title: z.string(),
      url: z.string().url().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: {
        taskId: string;
        kind: string;
        title: string;
        url?: string;
        metadata?: Record<string, unknown>;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const id = generateId();
      await db.insert(taskWorkProducts).values({
        id,
        taskId: input.taskId,
        tenantId: ctx.tenantId,
        kind: input.kind,
        title: input.title,
        url: input.url,
        metadata: input.metadata,
        createdByAgentId: ctx.agentId,
      });
      return { ok: true, result: { id } };
    },
  };
}

function makeReportCost(db: Db): Tool {
  return {
    name: "runs.report_cost",
    description: "Record token + USD cost for an agent run",
    inputs: z.object({
      runId: z.string().uuid(),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      model: z.string().optional(),
      costUsd: z.union([z.number(), z.string()]).optional(),
    }),
    async handler(
      input: {
        runId: string;
        inputTokens?: number;
        outputTokens?: number;
        model?: string;
        costUsd?: number | string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const id = generateId();
      await db.insert(costEvents).values({
        id,
        tenantId: ctx.tenantId,
        agentId: ctx.agentId ?? "",
        runId: input.runId,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        model: input.model,
        costUsd: input.costUsd === undefined ? undefined : String(input.costUsd),
      });
      return { ok: true, result: { id } };
    },
  };
}

function makeCreateAgent(db: Db): Tool {
  return {
    name: "agents.create",
    description: "Create a new agent under this tenant",
    inputs: z.object({
      name: z.string(),
      role: z.string().optional(),
      instructions: z.string().optional(),
      /**
       * Optional manager. Defaults to the calling agent's id —
       * the new agent reports to whoever spawned it. Required
       * unless the tenant has no agents yet (the schema enforces
       * "one root per tenant" via a partial unique index on
       * `(tenant_id) WHERE reports_to IS NULL`).
       */
      reportsTo: z.string().uuid().optional(),
    }),
    async handler(
      input: { name: string; role?: string; instructions?: string; reportsTo?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const id = generateId();
      // If no reportsTo was provided, default to the caller. If
      // there's no caller (rare — internal invocations), find the
      // tenant's root and report to it. If the tenant is empty,
      // this agent becomes the root.
      let reportsTo = input.reportsTo;
      if (!reportsTo && ctx.agentId) {
        reportsTo = ctx.agentId;
      } else if (!reportsTo) {
        const rootRows = await db
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.tenantId, ctx.tenantId))
          .limit(1);
        reportsTo = rootRows[0]?.id;
      }
      await db.insert(agents).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        role: input.role ?? "general",
        instructions: input.instructions,
        reportsTo,
      });
      return { ok: true, result: { id } };
    },
  };
}

function makeReadInbox(db: Db): Tool {
  return {
    name: "inbox.read",
    description: "Read an inbox item",
    inputs: z.object({ itemId: z.string().uuid() }),
    async handler(
      input: { itemId: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, input.itemId)).limit(1);
      const item = rows[0];
      if (!item) {
        return { ok: false, error: { code: "not_found", message: "Inbox item not found", retryable: false } };
      }
      if (item.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "permission_denied", message: "Inbox item belongs to another tenant", retryable: false },
        };
      }
      return { ok: true, result: item as unknown as Record<string, unknown> };
    },
  };
}

function makeUpdateInbox(db: Db): Tool {
  return {
    name: "inbox.update",
    description: "Update inbox item metadata or status",
    inputs: z.object({
      itemId: z.string().uuid(),
      metadata: z.record(z.unknown()).optional(),
      status: z.string().optional(),
    }),
    async handler(
      input: {
        itemId: string;
        metadata?: Record<string, unknown>;
        status?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, input.itemId)).limit(1);
      const item = rows[0];
      if (!item) {
        return { ok: false, error: { code: "not_found", message: "Inbox item not found", retryable: false } };
      }
      if (item.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "permission_denied", message: "Inbox item belongs to another tenant", retryable: false },
        };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.metadata) updates.metadata = input.metadata;
      if (input.status) updates.status = input.status;
      await db.update(inboxItems).set(updates).where(eq(inboxItems.id, input.itemId));
      return { ok: true, result: { ok: true } };
    },
  };
}

/**
 * Factory for the built-in `framework` Module. Pass to
 * `app.module(createFrameworkModule)` — boot will resolve the
 * factory once the DB handle is available.
 */
export const createFrameworkModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;
  const fwDeps: FrameworkDeps = { db, factoryDeps: deps };

  const module: Module = {
    id: "framework",
    name: "BoringOS Framework",
    version: "0.1.0",
    description:
      "Built-in framework tools and skills — task management, comments, work products, cost reporting, agent management, inbox.",
    provides: ["task-management", "audit"],
    skills: [
      {
        id: "tool-protocol",
        source: "framework",
        body: TOOL_PROTOCOL_SKILL,
        priority: 50,
      },
      {
        id: "approvals",
        source: "framework",
        body: APPROVALS_SKILL,
        priority: 51,
      },
      {
        id: "when-stuck",
        source: "framework",
        body: WHEN_STUCK_SKILL,
        priority: 52,
      },
    ],
    tools: [
      makeReadTask(db),
      makePatchTask(db),
      makeCreateTask(fwDeps),
      makePostComment(db),
      makeRecordWorkProduct(db),
      makeReportCost(db),
      makeCreateAgent(db),
      makeReadInbox(db),
      makeUpdateInbox(db),
      makeWakeAgent(fwDeps),
    ],
  };

  return module;
};
