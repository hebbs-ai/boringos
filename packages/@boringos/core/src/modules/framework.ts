// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The `framework` Module — built-in. Ships every operation that
// today lives behind `/api/agent/*` as a Tool, plus three core
// SKILL.md files (tool-protocol / approvals / when-stuck) that
// teach the agent the calling convention and core procedures.
//
// Phase 4 of task_12. Behaviour is identical to 's
// `routes.ts` handlers — the tool handlers delegate to the same
// Drizzle operations. (legacy routes are gone) in parallel
// during the migration; cutover removes them.

import { and, eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import {
  tasks,
  taskComments,
  taskWorkProducts,
  costEvents,
  agents,
  inboxItems,
  tenantSettings,
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
      originId: z.string().optional(),
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
        originId?: string;
        proposedParams?: Record<string, unknown>;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const id = generateId();
      const originKind = input.originKind ?? "agent_created";

      // Replicates admin-routes.ts logic: `agent_action` / `human_todo` /
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
        originId: input.originId,
        proposedParams: input.proposedParams,
      });

      // Auto-wake the assignee agent (parity with 's admin
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
              // this agent" — the admin endpoint uses the same
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
      cacheCreationTokens: z.number().int().nonnegative().optional(),
      cacheReadTokens: z.number().int().nonnegative().optional(),
      model: z.string().optional(),
      costUsd: z.union([z.number(), z.string()]).optional(),
    }),
    async handler(
      input: {
        runId: string;
        inputTokens?: number;
        outputTokens?: number;
        cacheCreationTokens?: number;
        cacheReadTokens?: number;
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
        cacheCreationTokens: input.cacheCreationTokens ?? 0,
        cacheReadTokens: input.cacheReadTokens ?? 0,
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

function makeUpdateInbox(deps: FrameworkDeps): Tool {
  const db = deps.db;
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

      const previousMeta = (item.metadata ?? {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.metadata) updates.metadata = input.metadata;
      if (input.status) updates.status = input.status;
      await db.update(inboxItems).set(updates).where(eq(inboxItems.id, input.itemId));

      // Emit `triage.classified` whenever this update set / changed
      // the `metadata.triage` block. The event is what wakes the
      // generic-replier; without it the replier would never run.
      // Reads `label` (the canonical key written by `triage.classify`),
      // falling back to `classification` for any caller still on the
      // older shape.
      if (input.metadata) {
        const nextTriage = (input.metadata.triage ?? null) as
          | { label?: unknown; classification?: unknown; source?: unknown; rationale?: unknown; reason?: unknown }
          | null;
        const prevTriage = (previousMeta.triage ?? null) as
          | { label?: unknown; classification?: unknown }
          | null;
        const nextLabel = nextTriage?.label ?? nextTriage?.classification ?? null;
        const prevLabel = prevTriage?.label ?? prevTriage?.classification ?? null;
        const triageChanged = nextTriage !== null && nextLabel !== prevLabel;
        if (triageChanged) {
          const bus = (deps.factoryDeps.eventBus ?? null) as
            | { emit: (e: { connectorKind: string; type: string; tenantId: string; data: Record<string, unknown>; timestamp: Date }) => Promise<void> | void }
            | null;
          if (bus) {
            try {
              await bus.emit({
                connectorKind: "framework",
                type: "triage.classified",
                tenantId: ctx.tenantId,
                timestamp: new Date(),
                data: {
                  itemId: input.itemId,
                  label: nextLabel,
                  source: nextTriage.source ?? "agent",
                  rationale: nextTriage.rationale ?? nextTriage.reason ?? null,
                },
              });
            } catch (err) {
              console.warn(
                `[framework.inbox.update] triage.classified emit failed for item=${input.itemId}:`,
                err instanceof Error ? err.message : err,
              );
            }
          }
        }
      }
      return { ok: true, result: { ok: true } };
    },
  };
}

// ────────────────────────────────────────────────────────────
// Business profile — framework-level "what this tenant does"
// ────────────────────────────────────────────────────────────
//
// Stored as a single jsonb-shaped row in `tenant_settings`
// (key='business_profile', value=<JSON string>). Treated as a
// strongly-typed object at the tool boundary, free-form at the
// storage layer so we can grow the shape without migrations.

const BUSINESS_PROFILE_KEY = "business_profile";

interface BusinessProfile {
  industry: string | null;
  whatWeDo: string | null;
  idealCustomer: string | null;
  signalExamples: string[];
  noiseExamples: string[];
  competitors: string[];
  tone: string | null;
}

function emptyBusinessProfile(): BusinessProfile {
  return {
    industry: null,
    whatWeDo: null,
    idealCustomer: null,
    signalExamples: [],
    noiseExamples: [],
    competitors: [],
    tone: null,
  };
}

function parseBusinessProfile(raw: string | null | undefined): BusinessProfile {
  if (!raw) return emptyBusinessProfile();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyBusinessProfile();
    const obj = parsed as Record<string, unknown>;
    return {
      industry: typeof obj.industry === "string" ? obj.industry : null,
      whatWeDo: typeof obj.whatWeDo === "string" ? obj.whatWeDo : null,
      idealCustomer:
        typeof obj.idealCustomer === "string" ? obj.idealCustomer : null,
      signalExamples: Array.isArray(obj.signalExamples)
        ? (obj.signalExamples.filter((s): s is string => typeof s === "string"))
        : [],
      noiseExamples: Array.isArray(obj.noiseExamples)
        ? (obj.noiseExamples.filter((s): s is string => typeof s === "string"))
        : [],
      competitors: Array.isArray(obj.competitors)
        ? (obj.competitors.filter((s): s is string => typeof s === "string"))
        : [],
      tone: typeof obj.tone === "string" ? obj.tone : null,
    };
  } catch {
    return emptyBusinessProfile();
  }
}

/**
 * Fallback: read legacy `company_*` keys (the CRM's pre-framework
 * profile shape) and map them onto BusinessProfile. Used by
 * `get_business_profile` for tenants who haven't migrated yet.
 */
async function readLegacyCrmProfile(
  db: Db,
  tenantId: string,
): Promise<Partial<BusinessProfile>> {
  const rows = await db
    .select({ key: tenantSettings.key, value: tenantSettings.value })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId));
  const legacy: Record<string, string> = {};
  for (const r of rows) {
    if (typeof r.value === "string" && r.key.startsWith("company_")) {
      legacy[r.key] = r.value;
    }
  }
  const out: Partial<BusinessProfile> = {};
  if (legacy["company_description"]) out.whatWeDo = legacy["company_description"];
  if (legacy["company_icp"]) out.idealCustomer = legacy["company_icp"];
  if (legacy["company_competitors"]) {
    out.competitors = legacy["company_competitors"]
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (legacy["company_tone"]) out.tone = legacy["company_tone"];
  // company_name + company_products + company_differentiators have no
  // 1:1 mapping; surface company_name as part of industry-ish context.
  return out;
}

function makeGetBusinessProfile(db: Db): Tool {
  return {
    name: "tenant.get_business_profile",
    description:
      "Return the current tenant's business profile: industry, what we do, ICP, signal/noise examples, competitors, tone. Returns the empty shape (nulls + empty arrays) when not yet set.",
    inputs: z.object({}),
    async handler(
      _input: Record<string, never>,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await db
        .select({ value: tenantSettings.value })
        .from(tenantSettings)
        .where(
          and(
            eq(tenantSettings.tenantId, ctx.tenantId),
            eq(tenantSettings.key, BUSINESS_PROFILE_KEY),
          ),
        )
        .limit(1);
      const raw = rows[0]?.value ?? null;
      let profile = parseBusinessProfile(raw);
      // If the structured row is empty (no save yet) fall back to
      // legacy `company_*` keys so existing tenants don't see a blank
      // page the first time they open the new settings UI.
      const isEmpty =
        !raw &&
        !profile.industry &&
        !profile.whatWeDo &&
        !profile.idealCustomer &&
        !profile.tone &&
        profile.signalExamples.length === 0 &&
        profile.noiseExamples.length === 0 &&
        profile.competitors.length === 0;
      if (isEmpty) {
        const legacy = await readLegacyCrmProfile(db, ctx.tenantId);
        profile = { ...profile, ...legacy };
      }
      return { ok: true, result: { profile } };
    },
  };
}

function makeUpdateBusinessProfile(db: Db): Tool {
  return {
    name: "tenant.update_business_profile",
    description:
      "Set / overwrite the tenant's business profile. All fields optional; omitted fields keep their existing value.",
    inputs: z.object({
      industry: z.string().nullable().optional(),
      whatWeDo: z.string().nullable().optional(),
      idealCustomer: z.string().nullable().optional(),
      signalExamples: z.array(z.string()).optional(),
      noiseExamples: z.array(z.string()).optional(),
      competitors: z.array(z.string()).optional(),
      tone: z.string().nullable().optional(),
    }),
    async handler(
      input: Partial<BusinessProfile>,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const existingRows = await db
        .select({ id: tenantSettings.id, value: tenantSettings.value })
        .from(tenantSettings)
        .where(
          and(
            eq(tenantSettings.tenantId, ctx.tenantId),
            eq(tenantSettings.key, BUSINESS_PROFILE_KEY),
          ),
        )
        .limit(1);
      const current = parseBusinessProfile(existingRows[0]?.value ?? null);
      const next: BusinessProfile = {
        industry: input.industry !== undefined ? input.industry : current.industry,
        whatWeDo: input.whatWeDo !== undefined ? input.whatWeDo : current.whatWeDo,
        idealCustomer:
          input.idealCustomer !== undefined ? input.idealCustomer : current.idealCustomer,
        signalExamples: input.signalExamples ?? current.signalExamples,
        noiseExamples: input.noiseExamples ?? current.noiseExamples,
        competitors: input.competitors ?? current.competitors,
        tone: input.tone !== undefined ? input.tone : current.tone,
      };
      const serialized = JSON.stringify(next);
      if (existingRows[0]) {
        await db
          .update(tenantSettings)
          .set({ value: serialized, updatedAt: new Date() })
          .where(eq(tenantSettings.id, existingRows[0].id));
      } else {
        await db.insert(tenantSettings).values({
          tenantId: ctx.tenantId,
          key: BUSINESS_PROFILE_KEY,
          value: serialized,
        });
      }
      return { ok: true, result: { profile: next } };
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
      "Built-in framework tools and skills — task management, comments, work products, cost reporting, agent management, inbox, tenant business profile.",
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
      makeUpdateInbox(fwDeps),
      makeWakeAgent(fwDeps),
      makeGetBusinessProfile(db),
      makeUpdateBusinessProfile(db),
    ],
  };

  return module;
};
