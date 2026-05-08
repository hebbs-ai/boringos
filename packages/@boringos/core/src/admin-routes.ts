import { Hono } from "hono";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import {
  tenants,
  agents,
  tasks,
  taskComments,
  taskWorkProducts,
  agentRuns,
  agentWakeupRequests,
  runtimes,
  costEvents,
  activityLog,
  budgetPolicies,
  budgetIncidents,
  routines,
  companySkills,
  agentSkills,
  projects,
  goals,
  labels,
  taskLabels,
  taskAttachments,
  taskReadStates,
  driveFiles,
  driveSkillRevisions,
  onboardingState,
  evals,
  evalRuns,
  inboxItems,
  entityReferences,
  workflows,
  workflowRuns,
  workflowBlockRuns,
} from "@boringos/db";
import type { AgentEngine, ToolRegistry } from "@boringos/agent";
import type { RuntimeRegistry } from "@boringos/runtime";
import { generateId } from "@boringos/shared";
import type { RealtimeBus } from "./realtime.js";
import { syncArchive, syncStatusChange } from "./inbox-gmail-sync.js";
import { runWorkflow } from "./run-workflow.js";

type AdminEnv = {
  Variables: {
    tenantId: string;
    userId: string;
    role: string;
  };
};

export function createAdminRoutes(
  db: Db,
  engine: AgentEngine,
  adminKey: string,
  realtimeBus?: RealtimeBus,
  toolRegistry?: ToolRegistry,
  runtimeRegistry?: RuntimeRegistry,
): Hono<AdminEnv> {

  function emit(type: string, tenantId: string, data: Record<string, unknown>) {
    realtimeBus?.publish({ type, tenantId, data, timestamp: new Date().toISOString() });
  }

  async function logActivity(tenantId: string, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
    await db.insert(activityLog).values({
      id: generateId(),
      tenantId,
      action,
      entityType,
      entityId,
      actorType: "user",
      metadata: metadata ?? null,
    }).catch(() => {});
  }

  const app = new Hono<AdminEnv>();

  // Role gate for mutating operations. API-key auth (system/tenant provisioning) bypasses.
  // Session-authed callers must have role="admin" to pass; anyone else gets 403.
  // Returns a Response on rejection, or null when the caller is permitted.
  function requireAdmin(c: import("hono").Context<AdminEnv>) {
    if (c.req.header("X-API-Key")) return null;
    const role = c.get("role");
    if (role !== "admin") return c.json({ error: "Admin only" }, 403);
    return null;
  }

  // Auth middleware — supports API key OR session token
  app.use("/*", async (c, next) => {
    const apiKey = c.req.header("X-API-Key");
    const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
    // EventSource can't set custom headers, so endpoints intended for it
    // (SSE streams) accept the session token as `?token=`. We only honor
    // the query-param form when the Authorization header is absent so
    // normal requests aren't affected.
    const queryToken = !bearer ? c.req.query("token") : undefined;

    // Option 1: API key auth
    if (apiKey && apiKey === adminKey) {
      const tenantId = c.req.header("X-Tenant-Id") ?? c.req.query("tenantId") ?? "";
      if (!tenantId) return c.json({ error: "Missing X-Tenant-Id header" }, 400);
      c.set("tenantId", tenantId);
      return next();
    }

    // Option 2: Session token auth (from login) — via header or query param
    const sessionToken = bearer ?? queryToken;
    if (sessionToken) {
      const { validateSession } = await import("./auth.js");
      const session = await validateSession(db, sessionToken);
      if (session) {
        c.set("tenantId", session.tenantId);
        c.set("userId", session.userId);
        c.set("role", session.role);
        return next();
      }
    }

    return c.json({ error: "Invalid or missing authentication" }, 401);
  });

  // ── Agents ──────────────────────────────────────────────────────────────

  app.get("/agents", async (c) => {
    const rows = await db.select().from(agents).where(eq(agents.tenantId, c.get("tenantId")));
    return c.json({ agents: rows });
  });

  // Must be before /agents/:id to avoid ":id" matching "org-tree"
  app.get("/agents/org-tree", async (c) => {
    try {
      const { buildOrgTree } = await import("@boringos/agent");
      const tree = await buildOrgTree(db, c.get("tenantId"));
      return c.json({ tree });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  app.get("/agents/:id", async (c) => {
    const rows = await db.select().from(agents).where(
      and(eq(agents.id, c.req.param("id")), eq(agents.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Agent not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/agents", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    const tenantId = c.get("tenantId");
    const skills = Array.isArray(body.skills) ? (body.skills as string[]).filter((s) => typeof s === "string") : [];

    // Task 07: Provenance tracking
    const source = (body.source as string) ?? "user";
    const sourceAppId = body.sourceAppId as string | undefined;

    // Validate source
    if (!["user", "app"].includes(source)) {
      return c.json({ error: "source must be 'user' or 'app'" }, 400);
    }
    if (source === "shell") {
      return c.json({ error: "source='shell' is reserved for framework agents" }, 403);
    }
    if (source === "app" && !sourceAppId) {
      return c.json({ error: "sourceAppId is required when source='app'" }, 400);
    }

    // Default reportsTo to tenant root if not provided
    let reportsTo = body.reportsTo as string | undefined;
    if (!reportsTo) {
      const tenantRows = await db.select({ rootAgentId: tenants.rootAgentId }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      reportsTo = tenantRows[0]?.rootAgentId ?? undefined;
    }

    await db.insert(agents).values({
      id,
      tenantId,
      name: body.name as string,
      role: (body.role as string) ?? "general",
      instructions: body.instructions as string | undefined,
      runtimeId: body.runtimeId as string | undefined,
      reportsTo,
      source,
      sourceAppId: sourceAppId ?? null,
      skills,
    });
    const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    emit("agent:created", tenantId, { agentId: id, name: body.name });
    await logActivity(tenantId, "agent.created", "agent", id, { name: body.name, role: body.role, source });
    return c.json(rows[0], 201);
  });

  app.patch("/agents/:id", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = await c.req.json() as Record<string, unknown>;
    const agentId = c.req.param("id");
    const tenantId = c.get("tenantId");
    const values: Record<string, unknown> = { updatedAt: new Date() };

    // Task 07: Guard against reparenting violations
    if (body.reportsTo !== undefined) {
      const { validateReparenting } = await import("@boringos/agent");
      const validation = await validateReparenting(db as any, agentId, body.reportsTo as string | null, tenantId);
      if (!validation.valid) {
        return c.json({ error: validation.reason }, 409);
      }
      values.reportsTo = body.reportsTo;
    }

    // Task 07: Protect shell agents from modification
    const agentRows = await db.select({ source: (await import("@boringos/db")).agents.source })
      .from((await import("@boringos/db")).agents).where(eq((await import("@boringos/db")).agents.id, agentId)).limit(1) as Array<{ source: string }>;
    if (agentRows[0]?.source === "shell") {
      return c.json({ error: "Framework agents (source='shell') cannot be modified" }, 403);
    }

    if (body.name !== undefined) values.name = body.name;
    if (body.role !== undefined) values.role = body.role;
    if (body.title !== undefined) values.title = body.title;
    if (body.instructions !== undefined) values.instructions = body.instructions;
    if (body.status !== undefined) values.status = body.status;
    if (body.runtimeId !== undefined) values.runtimeId = body.runtimeId;
    if (body.fallbackRuntimeId !== undefined) values.fallbackRuntimeId = body.fallbackRuntimeId;
    if (body.budgetMonthlyCents !== undefined) values.budgetMonthlyCents = body.budgetMonthlyCents;
    if (body.skills !== undefined) {
      values.skills = Array.isArray(body.skills) ? (body.skills as unknown[]).filter((s) => typeof s === "string") : [];
    }

    // When archiving an agent, reparent reports to the archived agent's manager (grandparent).
    // Set-null would orphan a subtree; grandparent preserves org structure on departures.
    if (body.status === "archived") {
      const agentId = c.req.param("id");
      const selfRows = await db.select({ reportsTo: agents.reportsTo }).from(agents).where(eq(agents.id, agentId)).limit(1);
      const grandparent = selfRows[0]?.reportsTo ?? null;
      const myReports = await db.select({ id: agents.id }).from(agents).where(
        and(eq(agents.reportsTo, agentId), eq(agents.tenantId, c.get("tenantId"))),
      );
      for (const r of myReports) {
        await db.update(agents).set({ reportsTo: grandparent, updatedAt: new Date() }).where(eq(agents.id, r.id));
        emit("agent:reparented", c.get("tenantId"), { agentId: r.id, reportsTo: grandparent });
      }
    }

    // reportsTo: cycle check before accepting
    if (body.reportsTo !== undefined) {
      const newParent = body.reportsTo as string | null;
      if (newParent) {
        const selfId = c.req.param("id");
        if (newParent === selfId) return c.json({ error: "Agent cannot report to itself" }, 409);
        // Walk up the proposed chain; if we hit selfId, it's a cycle.
        let cursor: string | null = newParent;
        const seen = new Set<string>();
        while (cursor) {
          if (cursor === selfId) return c.json({ error: "Reparent would create a cycle" }, 409);
          if (seen.has(cursor)) break;
          seen.add(cursor);
          const cursorRows: Array<{ reportsTo: string | null }> = await db
            .select({ reportsTo: agents.reportsTo })
            .from(agents)
            .where(eq(agents.id, cursor))
            .limit(1) as Array<{ reportsTo: string | null }>;
          cursor = cursorRows[0]?.reportsTo ?? null;
        }
      }
      values.reportsTo = newParent;
    }

    await db.update(agents).set(values).where(
      and(eq(agents.id, c.req.param("id")), eq(agents.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(agents).where(eq(agents.id, c.req.param("id"))).limit(1);

    if (body.reportsTo !== undefined) {
      emit("agent:reparented", c.get("tenantId"), { agentId: c.req.param("id"), reportsTo: values.reportsTo });
    }
    emit("agent:updated", c.get("tenantId"), { agentId: c.req.param("id") });
    return c.json(rows[0]);
  });

  // Dedicated skills endpoint: cheaper than round-tripping the whole array for edits
  app.patch("/agents/:id/skills", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = await c.req.json() as { add?: string[]; remove?: string[]; set?: string[] };
    const rows = await db.select().from(agents).where(
      and(eq(agents.id, c.req.param("id")), eq(agents.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Agent not found" }, 404);
    let next: string[];
    if (Array.isArray(body.set)) {
      next = body.set.filter((s) => typeof s === "string");
    } else {
      const current = Array.isArray(rows[0].skills) ? rows[0].skills as string[] : [];
      const afterRemove = Array.isArray(body.remove)
        ? current.filter((s) => !body.remove!.includes(s))
        : current;
      const add = Array.isArray(body.add) ? body.add.filter((s) => typeof s === "string" && !afterRemove.includes(s)) : [];
      next = [...afterRemove, ...add];
    }
    await db.update(agents).set({ skills: next, updatedAt: new Date() }).where(eq(agents.id, c.req.param("id")));
    return c.json({ agentId: c.req.param("id"), skills: next });
  });

  app.post("/agents/:id/wake", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = c.get("tenantId");
    const agentId = c.req.param("id");

    // Every wake must be bound to a task. If the caller supplied one,
    // use it; otherwise mint a manual task so the session has somewhere
    // to live.
    let taskId = body.taskId as string | undefined;
    if (!taskId) {
      const newTaskId = generateId();
      await db.insert(tasks).values({
        id: newTaskId,
        tenantId,
        title: (body.title as string | undefined) ?? "Manual wake",
        description: (body.description as string | undefined) ?? "",
        status: "todo",
        originKind: "manual",
        assigneeAgentId: agentId,
      });
      taskId = newTaskId;
    }

    const outcome = await engine.wake({
      agentId,
      tenantId,
      taskId,
      reason: "manual_request",
    });

    if (outcome.kind === "created") {
      await engine.enqueue(outcome.wakeupRequestId);
    }

    return c.json({ ...outcome, taskId });
  });

  app.get("/agents/:id/runs", async (c) => {
    const rows = await db.select().from(agentRuns).where(
      and(eq(agentRuns.agentId, c.req.param("id")), eq(agentRuns.tenantId, c.get("tenantId"))),
    ).orderBy(desc(agentRuns.createdAt)).limit(50);
    return c.json({ runs: rows });
  });

  // ── Agent Templates & Teams ──────────────────────────────────────────────

  app.post("/agents/from-template", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = await c.req.json() as Record<string, unknown>;
    const { createAgentFromTemplate } = await import("@boringos/agent");
    const agent = await createAgentFromTemplate(db, body.role as string, {
      tenantId: c.get("tenantId"),
      name: body.name as string | undefined,
      runtimeId: body.runtimeId as string | undefined,
      reportsTo: body.reportsTo as string | undefined,
    });
    emit("agent:created", c.get("tenantId"), { agentId: agent.id, name: agent.name, role: agent.role });
    await logActivity(c.get("tenantId"), "agent.created_from_template", "agent", agent.id, { role: agent.role });
    return c.json(agent, 201);
  });

  app.post("/teams/from-template", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = await c.req.json() as Record<string, unknown>;
    const { createTeam } = await import("@boringos/agent");
    const agents = await createTeam(db, body.template as string, {
      tenantId: c.get("tenantId"),
      runtimeId: body.runtimeId as string | undefined,
    });
    for (const a of agents) {
      emit("agent:created", c.get("tenantId"), { agentId: a.id, name: a.name, role: a.role });
    }
    await logActivity(c.get("tenantId"), "team.created_from_template", "team", agents[0]?.id ?? "", { template: body.template, count: agents.length });
    return c.json({ agents }, 201);
  });

  app.get("/teams/templates", async (_c) => {
    const { BUILT_IN_TEAMS } = await import("@boringos/agent");
    const templates = Object.entries(BUILT_IN_TEAMS).map(([key, t]) => ({
      key,
      name: (t as any).name,
      description: (t as any).description,
      roles: (t as any).roles.map((r: any) => ({ role: r.role, name: r.name })),
    }));
    return _c.json({ templates });
  });

  app.get("/agents/:id/reports", async (c) => {
    const rows = await db.select().from(agents).where(
      and(eq(agents.reportsTo, c.req.param("id")), eq(agents.tenantId, c.get("tenantId"))),
    );
    return c.json({ reports: rows });
  });

  // ── Tasks ───────────────────────────────────────────────────────────────

  app.get("/tasks", async (c) => {
    const status = c.req.query("status");
    const assignee = c.req.query("assigneeAgentId");
    const assigneeUser = c.req.query("assigneeUserId");
    const resolvedAssigneeUser = assigneeUser === "me" ? c.get("userId") : assigneeUser;

    let query = db.select().from(tasks).where(eq(tasks.tenantId, c.get("tenantId")));
    // Note: drizzle doesn't chain .where easily, so we filter in-memory for optional params
    const rows = await query.orderBy(desc(tasks.createdAt)).limit(100);

    let filtered = rows;
    if (status) filtered = filtered.filter((t) => t.status === status);
    if (assignee) filtered = filtered.filter((t) => t.assigneeAgentId === assignee);
    if (resolvedAssigneeUser) filtered = filtered.filter((t) => t.assigneeUserId === resolvedAssigneeUser);

    return c.json({ tasks: filtered });
  });

  app.get("/tasks/:id", async (c) => {
    const taskId = c.req.param("id");
    const taskRows = await db.select().from(tasks).where(
      and(eq(tasks.id, taskId), eq(tasks.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!taskRows[0]) return c.json({ error: "Task not found" }, 404);

    const comments = await db.select().from(taskComments)
      .where(eq(taskComments.taskId, taskId))
      .orderBy(desc(taskComments.createdAt));

    const workProducts = await db.select().from(taskWorkProducts)
      .where(eq(taskWorkProducts.taskId, taskId));

    // Fetch runs + cost data for this task
    const wakeups = await db.select().from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));
    const wakeupIds = wakeups.map((w) => w.id);

    let runs: Array<Record<string, unknown>> = [];
    let costSummary = { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, runCount: 0, models: [] as string[] };

    if (wakeupIds.length > 0) {
      const runRows = await db.select().from(agentRuns)
        .where(sql`${agentRuns.wakeupRequestId} = ANY(ARRAY[${sql.join(wakeupIds.map(id => sql`${id}::uuid`), sql`, `)}])`)
        .orderBy(desc(agentRuns.createdAt));

      const runIds = runRows.map((r) => r.id);
      let costMap = new Map<string, { inputTokens: number; outputTokens: number; costUsd: number; model: string | null }>();

      if (runIds.length > 0) {
        const costRows = await db.select().from(costEvents)
          .where(sql`${costEvents.runId} = ANY(ARRAY[${sql.join(runIds.map(id => sql`${id}::uuid`), sql`, `)}])`);

        for (const ce of costRows) {
          const existing = costMap.get(ce.runId!) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, model: null };
          existing.inputTokens += ce.inputTokens;
          existing.outputTokens += ce.outputTokens;
          existing.costUsd += parseFloat(ce.costUsd ?? "0");
          if (ce.model) existing.model = ce.model;
          costMap.set(ce.runId!, existing);
        }
      }

      const agentMap = new Map<string, string>();
      const agentIds = [...new Set(runRows.map((r) => r.agentId))];
      if (agentIds.length > 0) {
        const agentRows = await db.select({ id: agents.id, name: agents.name }).from(agents)
          .where(sql`${agents.id} = ANY(ARRAY[${sql.join(agentIds.map(id => sql`${id}::uuid`), sql`, `)}])`);
        for (const a of agentRows) agentMap.set(a.id, a.name);
      }

      const modelsSet = new Set<string>();
      runs = runRows.map((r) => {
        const cost = costMap.get(r.id);
        const model = r.model ?? cost?.model ?? null;
        if (model) modelsSet.add(model);
        costSummary.totalInputTokens += cost?.inputTokens ?? 0;
        costSummary.totalOutputTokens += cost?.outputTokens ?? 0;
        costSummary.totalCostUsd += cost?.costUsd ?? 0;
        return {
          id: r.id,
          agentId: r.agentId,
          agentName: agentMap.get(r.agentId) ?? null,
          status: r.status,
          model,
          exitCode: r.exitCode,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          inputTokens: cost?.inputTokens ?? 0,
          outputTokens: cost?.outputTokens ?? 0,
          costUsd: cost?.costUsd ?? 0,
        };
      });
      costSummary.runCount = runs.length;
      costSummary.models = [...modelsSet];
    }

    return c.json({ task: taskRows[0], comments, workProducts, runs, costSummary });
  });

  app.post("/tasks", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    const tenantId = c.get("tenantId");
    const projectId = body.projectId as string | undefined;

    // Auto-generate identifier if not provided
    let identifier = body.identifier as string | undefined;
    if (!identifier) {
      if (projectId) {
        // Use project prefix + counter
        const projRows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
        const proj = projRows[0];
        if (proj) {
          const prefix = proj.prefix ?? proj.name.slice(0, 3).toUpperCase();
          const num = parseInt(proj.nextIssueNumber) || 1;
          identifier = `${prefix}-${String(num).padStart(3, "0")}`;
          await db.update(projects).set({ nextIssueNumber: String(num + 1) }).where(eq(projects.id, projectId));
        }
      } else {
        // Use tenant-level counter from settings
        const { tenantSettings } = await import("@boringos/db");
        const counterRows = await db.select().from(tenantSettings).where(
          and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, "task_counter")),
        ).limit(1);
        const counter = parseInt(counterRows[0]?.value ?? "0") + 1;
        identifier = `BOS-${String(counter).padStart(3, "0")}`;

        if (counterRows[0]) {
          await db.update(tenantSettings).set({ value: String(counter) }).where(eq(tenantSettings.id, counterRows[0].id));
        } else {
          const { tenantSettings: ts } = await import("@boringos/db");
          await db.insert(ts).values({ id: generateId(), tenantId, key: "task_counter", value: String(counter) });
        }
      }
    }

    await db.insert(tasks).values({
      id,
      tenantId,
      title: body.title as string,
      description: body.description as string | undefined,
      status: (body.status as string) ?? "todo",
      priority: (body.priority as string) ?? "medium",
      assigneeAgentId: body.assigneeAgentId as string | undefined,
      // Default assignee = current user, but only when no agent is
      // assigned. Setting both fields creates ambiguity (whose
      // queue does it land in?) and the auto-wake-on-comment hook
      // ends up firing the agent for tasks that were really meant
      // to live on the user's todo list.
      assigneeUserId:
        (body.assigneeUserId as string) ??
        (body.assigneeAgentId ? undefined : c.get("userId") ?? undefined),
      // Stamp the creating user — needed for the "My todos" /
      // "Watching" filters in the Tasks UI to distinguish "I made
      // this" from "an agent made this." Without it, tasks created
      // through this endpoint were invisible in My todos when an
      // agent was the assignee.
      createdByUserId: c.get("userId") ?? undefined,
      parentId: body.parentId as string | undefined,
      identifier,
      originKind: (body.originKind as string) ?? "manual",
      proposedParams: body.proposedParams as Record<string, unknown> | undefined,
    });
    const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    emit("task:created", c.get("tenantId"), { taskId: id, title: body.title });
    await logActivity(c.get("tenantId"), "task.created", "task", id, { title: body.title });
    return c.json(rows[0], 201);
  });

  app.patch("/tasks/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) values.title = body.title;
    if (body.description !== undefined) values.description = body.description;
    if (body.status !== undefined) values.status = body.status;
    if (body.priority !== undefined) values.priority = body.priority;
    if (body.assigneeAgentId !== undefined) values.assigneeAgentId = body.assigneeAgentId;
    if (body.assigneeUserId !== undefined) values.assigneeUserId = body.assigneeUserId;

    await db.update(tasks).set(values).where(
      and(eq(tasks.id, c.req.param("id")), eq(tasks.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(tasks).where(eq(tasks.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  app.delete("/tasks/:id", async (c) => {
    await db.delete(tasks).where(
      and(eq(tasks.id, c.req.param("id")), eq(tasks.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  // POST /tasks/:id/decision — approve / reject an `agent_action` task
  // (the new approvals-as-tasks model from
  // docs/blockers/done/task_06).
  //
  // Behaviour:
  //   1. Validate the target is an open `agent_action` task.
  //   2. Stamp `metadata.approval = { decision, decidedAt, ... }` on
  //      the child task and flip its status (done / cancelled).
  //   3. If a comment was supplied, post it on the PARENT task — that
  //      's where the requesting agent's session lives, and the
  //      existing auto-wake-on-comment hook will pick it up. If no
  //      comment, synthesize a minimal "approved"/"rejected" stub so
  //      the parent's transcript carries the decision either way.
  //   4. Emit a realtime event + activity log entry.
  app.post("/tasks/:id/decision", async (c) => {
    const taskId = c.req.param("id");
    const tenantId = c.get("tenantId");
    const userId = c.get("userId");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const kind = body.kind as string | undefined;
    if (kind !== "approve" && kind !== "reject") {
      return c.json({ error: "kind must be 'approve' or 'reject'" }, 400);
    }
    const userComment = (body.comment as string | undefined)?.trim() || null;

    const taskRows = await db.select().from(tasks).where(
      and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)),
    ).limit(1);
    const task = taskRows[0];
    if (!task) return c.json({ error: "Task not found" }, 404);

    if (task.originKind !== "agent_action") {
      return c.json(
        { error: "Decisions only apply to agent_action tasks" },
        400,
      );
    }
    if (task.status === "done" || task.status === "cancelled") {
      return c.json({ error: "Task is already decided" }, 409);
    }

    const decisionAt = new Date();
    const existingMetadata =
      (task.metadata as Record<string, unknown> | null) ?? {};
    const nextMetadata = {
      ...existingMetadata,
      approval: {
        decision: kind,
        decidedAt: decisionAt.toISOString(),
        decidedByUserId: userId,
        comment: userComment,
      },
    };

    const nextStatus = kind === "approve" ? "done" : "cancelled";
    await db.update(tasks).set({
      metadata: nextMetadata,
      status: nextStatus,
      completedAt: kind === "approve" ? decisionAt : null,
      cancelledAt: kind === "reject" ? decisionAt : null,
      updatedAt: decisionAt,
    }).where(eq(tasks.id, taskId));

    // Post the decision comment to the PARENT task (where the
    // requesting agent's session lives). Without a parent we can't
    // wake anything — surface a warning but still return success.
    let parentWokenForAgentId: string | null = null;
    if (task.parentId) {
      const parentRows = await db.select().from(tasks).where(
        and(eq(tasks.id, task.parentId), eq(tasks.tenantId, tenantId)),
      ).limit(1);
      const parent = parentRows[0];
      if (parent) {
        // Snapshot proposed_params into the comment so the parent
        // agent gets the action call inline — no extra fetch round
        // trip. The agent applies any modifications from the user's
        // note before executing. See task_07.
        let snapshot = "";
        if (kind === "approve" && task.proposedParams) {
          const params = task.proposedParams as Record<string, unknown>;
          const kindField = typeof params.kind === "string" ? params.kind : "(unknown)";
          snapshot =
            `\n\n_Original \`proposed_params\` (apply any modifications from the comment above before executing):_\n` +
            "```json\n" +
            JSON.stringify({ kind: kindField, ...params }, null, 2) +
            "\n```";
        }
        const commentBody =
          kind === "approve"
            ? `**Approved.**${userComment ? `\n\n${userComment}` : ""}${snapshot}`
            : `**Rejected.**${userComment ? `\n\n${userComment}` : ""}`;
        const commentId = generateId();
        await db.insert(taskComments).values({
          id: commentId,
          taskId: parent.id,
          tenantId,
          body: commentBody,
          authorUserId: userId,
        });
        emit("task:comment_added", tenantId, { taskId: parent.id, commentId });

        // Wake the parent's assignee agent so it resumes its session
        // and reads the comment. Same shape as the auto-wake-on-comment
        // hook elsewhere in this file.
        if (parent.assigneeAgentId) {
          const outcome = await engine.wake({
            agentId: parent.assigneeAgentId,
            tenantId,
            reason: "comment_posted",
            taskId: parent.id,
          });
          if (outcome.kind === "created") {
            await engine.enqueue(outcome.wakeupRequestId);
            parentWokenForAgentId = parent.assigneeAgentId;
          }
        }
      }
    }

    emit("task:decision_made", tenantId, { taskId, kind });
    await logActivity(
      tenantId,
      kind === "approve" ? "task.approved" : "task.rejected",
      "task",
      taskId,
      { kind, parentTaskId: task.parentId },
    );

    return c.json({
      ok: true,
      decision: kind,
      parentWokenForAgentId,
    });
  });

  app.post("/tasks/:id/comments", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    const taskId = c.req.param("id");
    const tenantId = c.get("tenantId");

    await db.insert(taskComments).values({
      id,
      taskId,
      tenantId,
      body: body.body as string,
      authorUserId: body.authorUserId as string | undefined,
    });
    emit("task:comment_added", tenantId, { taskId, commentId: id });
    await logActivity(tenantId, "comment.created", "task_comment", id, { taskId });

    // Auto-wake on user comment.
    //  - If the task is assigned to an agent → wake the assignee (handles
    //    copilot sessions, delegated work, etc.).
    //  - Otherwise, if the task was created by an agent (typical human_todo
    //    case: agent proposes a follow-up question, user answers in a
    //    comment) → wake the creator so the answer can flow back into
    //    whatever state the creator owns (dossier, intelligence, plan).
    // Either way the agent receives the task + comments in its context.
    if (!body.authorAgentId) {
      const taskRows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      const task = taskRows[0];
      const wakeTargetAgentId = task?.assigneeAgentId ?? task?.createdByAgentId ?? null;
      if (wakeTargetAgentId) {
        const outcome = await engine.wake({
          agentId: wakeTargetAgentId,
          tenantId,
          reason: "comment_posted",
          taskId,
        });
        if (outcome.kind === "created") {
          await engine.enqueue(outcome.wakeupRequestId);
        }
        return c.json({ id, agentWoken: true, wakeup: outcome.kind }, 201);
      }
    }

    return c.json({ id }, 201);
  });

  app.post("/tasks/:id/assign", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const agentId = body.agentId as string;
    const taskId = c.req.param("id");

    await db.update(tasks).set({
      assigneeAgentId: agentId,
      updatedAt: new Date(),
    }).where(eq(tasks.id, taskId));

    // Optionally wake the agent
    if (body.wake) {
      const outcome = await engine.wake({
        agentId,
        tenantId: c.get("tenantId"),
        reason: "manual_request",
        taskId,
      });
      if (outcome.kind === "created") {
        await engine.enqueue(outcome.wakeupRequestId);
      }
      return c.json({ assigned: true, wakeup: outcome });
    }

    return c.json({ assigned: true });
  });

  // POST /tasks/:id/handoff — hand off a task to another agent
  // Creates a subtask assigned to toAgentId, posts a comment on this task,
  // optionally wakes the recipient. Enforces 3-handoff-per-tree limit.
  app.post("/tasks/:id/handoff", async (c) => {
    const body = await c.req.json() as { toAgentId?: string; fromAgentId?: string; message?: string; wake?: boolean };
    if (!body.toAgentId) return c.json({ error: "toAgentId required" }, 400);

    const parentTaskId = c.req.param("id");
    const tenantId = c.get("tenantId");

    // If fromAgentId isn't supplied, infer from the task's current assignee
    let fromAgentId = body.fromAgentId ?? null;
    if (!fromAgentId) {
      const parentRows = await db.select({ assigneeAgentId: tasks.assigneeAgentId }).from(tasks)
        .where(and(eq(tasks.id, parentTaskId), eq(tasks.tenantId, tenantId))).limit(1);
      fromAgentId = parentRows[0]?.assigneeAgentId ?? null;
    }

    // Resolve an author display for the handoff comment — if no fromAgent, use the current user
    const targetRows = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, body.toAgentId)).limit(1);
    const toName = targetRows[0]?.name ?? "agent";

    const { createHandoffTask } = await import("@boringos/agent");
    const subtaskId = await createHandoffTask(db, {
      fromAgentId: fromAgentId ?? body.toAgentId, // fallback to self if no from — keeps FK valid
      toAgentId: body.toAgentId,
      parentTaskId,
      title: `Handoff: ${body.message?.slice(0, 80) ?? "see parent task"}`,
      description: body.message ?? undefined,
      originKind: "handoff",
    });
    if (!subtaskId) {
      return c.json({ error: "Handoff chain too deep; root task marked blocked" }, 409);
    }

    // Optionally wake the recipient
    if (body.wake) {
      const outcome = await engine.wake({
        agentId: body.toAgentId,
        tenantId,
        reason: "manual_request",
        taskId: subtaskId,
      });
      if (outcome.kind === "created") {
        await engine.enqueue(outcome.wakeupRequestId);
      }
      return c.json({ subtaskId, to: toName, wakeup: outcome.kind });
    }

    return c.json({ subtaskId, to: toName });
  });

  // ── Runs ────────────────────────────────────────────────────────────────

  app.get("/runs", async (c) => {
    const agentId = c.req.query("agentId");
    const status = c.req.query("status");

    const rows = await db.select().from(agentRuns)
      .where(eq(agentRuns.tenantId, c.get("tenantId")))
      .orderBy(desc(agentRuns.createdAt))
      .limit(100);

    let filtered = rows;
    if (agentId) filtered = filtered.filter((r) => r.agentId === agentId);
    if (status) filtered = filtered.filter((r) => r.status === status);

    // Enrich with taskId via the wakeup-request join. The Tasks UI's
    // "needs attention" surfacing (Task D in task_05) needs to know
    // which task each failed run belongs to; doing the join here is a
    // single-query lookup instead of N round-trips from the client.
    const wakeupIds = filtered.map((r) => r.wakeupRequestId).filter((x): x is string => !!x);
    let wakeupToTask = new Map<string, string>();
    if (wakeupIds.length > 0) {
      const wRows = await db.select({
        id: agentWakeupRequests.id,
        taskId: agentWakeupRequests.taskId,
      }).from(agentWakeupRequests)
        .where(sql`${agentWakeupRequests.id} = ANY(ARRAY[${sql.join(wakeupIds.map(id => sql`${id}::uuid`), sql`, `)}])`);
      for (const w of wRows) {
        if (w.taskId) wakeupToTask.set(w.id, w.taskId);
      }
    }

    const enriched = filtered.map((r) => ({
      ...r,
      taskId: r.wakeupRequestId ? wakeupToTask.get(r.wakeupRequestId) ?? null : null,
    }));

    return c.json({ runs: enriched });
  });

  app.get("/runs/:id", async (c) => {
    const rows = await db.select().from(agentRuns).where(
      and(eq(agentRuns.id, c.req.param("id")), eq(agentRuns.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Run not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/runs/:id/cancel", async (c) => {
    await engine.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  // ── Runtimes ────────────────────────────────────────────────────────────

  app.get("/runtimes", async (c) => {
    const rows = await db.select().from(runtimes).where(eq(runtimes.tenantId, c.get("tenantId")));
    return c.json({ runtimes: rows });
  });

  app.post("/runtimes", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(runtimes).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      type: body.type as string,
      config: (body.config as Record<string, unknown>) ?? {},
      model: body.model as string | undefined,
    });
    const rows = await db.select().from(runtimes).where(eq(runtimes.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.patch("/runtimes/:id", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) values.name = body.name;

    // Keep config.model and model column in sync
    if (body.config !== undefined) {
      const cfg = body.config as Record<string, unknown>;
      values.config = cfg;
      if (cfg.model && body.model === undefined) values.model = cfg.model as string;
    }
    if (body.model !== undefined) {
      values.model = body.model;
      const existing = await db.select().from(runtimes).where(eq(runtimes.id, c.req.param("id"))).limit(1);
      if (existing[0]) {
        const cfg = { ...(existing[0].config as Record<string, unknown>), model: body.model };
        if (!body.config) values.config = cfg;
      }
    }

    await db.update(runtimes).set(values).where(
      and(eq(runtimes.id, c.req.param("id")), eq(runtimes.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(runtimes).where(eq(runtimes.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  app.get("/runtimes/:id/models", async (c) => {
    const rows = await db.select().from(runtimes).where(
      and(eq(runtimes.id, c.req.param("id")), eq(runtimes.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Runtime not found" }, 404);

    const rtModule = runtimeRegistry?.get(rows[0].type);
    if (!rtModule) return c.json({ models: [] });

    const models = rtModule.models ?? (rtModule.listModels ? await rtModule.listModels() : []);
    return c.json({ models });
  });

  app.delete("/runtimes/:id", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    await db.delete(runtimes).where(
      and(eq(runtimes.id, c.req.param("id")), eq(runtimes.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  app.post("/runtimes/:id/default", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const tenantId = c.get("tenantId");
    // Unset all defaults first
    await db.update(runtimes).set({ isDefault: false }).where(eq(runtimes.tenantId, tenantId));
    // Set this one as default
    await db.update(runtimes).set({ isDefault: true, updatedAt: new Date() }).where(
      and(eq(runtimes.id, c.req.param("id")), eq(runtimes.tenantId, tenantId)),
    );
    return c.json({ ok: true });
  });

  // Approvals routes removed — collapsed into tasks. See
  // POST /tasks/:id/decision above and
  // docs/blockers/done/task_06_collapse_approvals_into_tasks.md.

  // ── Activity Log ────────────────────────────────────────────────────────

  app.get("/activity", async (c) => {
    const rows = await db.select().from(activityLog)
      .where(eq(activityLog.tenantId, c.get("tenantId")))
      .orderBy(desc(activityLog.createdAt))
      .limit(100);
    return c.json({ activity: rows });
  });

  // ── Projects ─────────────────────────────────────────────────────────────

  app.get("/projects", async (c) => {
    const rows = await db.select().from(projects).where(eq(projects.tenantId, c.get("tenantId")));
    return c.json({ projects: rows });
  });

  app.get("/projects/:id", async (c) => {
    const rows = await db.select().from(projects).where(
      and(eq(projects.id, c.req.param("id")), eq(projects.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Project not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/projects", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(projects).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      description: body.description as string | undefined,
      prefix: body.prefix as string | undefined,
      repoUrl: body.repoUrl as string | undefined,
      defaultBranch: body.defaultBranch as string | undefined,
      branchTemplate: body.branchTemplate as string | undefined,
    });
    const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    emit("task:created", c.get("tenantId"), { projectId: id, name: body.name });
    return c.json(rows[0], 201);
  });

  app.patch("/projects/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) values.name = body.name;
    if (body.description !== undefined) values.description = body.description;
    if (body.status !== undefined) values.status = body.status;
    if (body.repoUrl !== undefined) values.repoUrl = body.repoUrl;

    await db.update(projects).set(values).where(
      and(eq(projects.id, c.req.param("id")), eq(projects.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(projects).where(eq(projects.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  // ── Goals ───────────────────────────────────────────────────────────────

  app.get("/goals", async (c) => {
    const rows = await db.select().from(goals).where(eq(goals.tenantId, c.get("tenantId")));
    return c.json({ goals: rows });
  });

  app.post("/goals", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(goals).values({
      id,
      tenantId: c.get("tenantId"),
      title: body.title as string,
      description: body.description as string | undefined,
    });
    const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.patch("/goals/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) values.title = body.title;
    if (body.description !== undefined) values.description = body.description;
    if (body.status !== undefined) values.status = body.status;

    await db.update(goals).set(values).where(
      and(eq(goals.id, c.req.param("id")), eq(goals.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(goals).where(eq(goals.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  // ── Labels ──────────────────────────────────────────────────────────────

  app.get("/labels", async (c) => {
    const rows = await db.select().from(labels).where(eq(labels.tenantId, c.get("tenantId")));
    return c.json({ labels: rows });
  });

  app.post("/labels", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(labels).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      color: body.color as string | undefined,
    });
    const rows = await db.select().from(labels).where(eq(labels.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.post("/tasks/:taskId/labels/:labelId", async (c) => {
    const id = generateId();
    await db.insert(taskLabels).values({
      id,
      taskId: c.req.param("taskId"),
      labelId: c.req.param("labelId"),
    });
    return c.json({ ok: true }, 201);
  });

  app.delete("/tasks/:taskId/labels/:labelId", async (c) => {
    await db.delete(taskLabels).where(
      and(eq(taskLabels.taskId, c.req.param("taskId")), eq(taskLabels.labelId, c.req.param("labelId"))),
    );
    return c.json({ ok: true });
  });

  // ── Task Read States ────────────────────────────────────────────────────

  app.post("/tasks/:taskId/read", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = body.userId as string ?? "unknown";
    const id = generateId();
    await db.insert(taskReadStates).values({
      id,
      taskId: c.req.param("taskId"),
      userId,
    });
    return c.json({ ok: true });
  });

  // ── Skills ───────────────────────────────────────────────────────────────

  app.get("/skills", async (c) => {
    const rows = await db.select().from(companySkills).where(eq(companySkills.tenantId, c.get("tenantId")));
    return c.json({ skills: rows });
  });

  app.post("/skills", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(companySkills).values({
      id,
      tenantId: c.get("tenantId"),
      key: body.key as string,
      name: body.name as string,
      description: body.description as string | undefined,
      sourceType: body.sourceType as string,
      sourceConfig: (body.sourceConfig as Record<string, unknown>) ?? {},
      trustLevel: (body.trustLevel as string) ?? "markdown_only",
    });
    const rows = await db.select().from(companySkills).where(eq(companySkills.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.post("/skills/:id/attach/:agentId", async (c) => {
    const id = generateId();
    await db.insert(agentSkills).values({
      id,
      skillId: c.req.param("id"),
      agentId: c.req.param("agentId"),
    });
    return c.json({ ok: true }, 201);
  });

  app.delete("/skills/:id/attach/:agentId", async (c) => {
    await db.delete(agentSkills).where(
      and(eq(agentSkills.skillId, c.req.param("id")), eq(agentSkills.agentId, c.req.param("agentId"))),
    );
    return c.json({ ok: true });
  });

  // ── Routines ─────────────────────────────────────────────────────────────

  app.get("/routines", async (c) => {
    const rows = await db.select().from(routines).where(eq(routines.tenantId, c.get("tenantId")));
    return c.json({ routines: rows });
  });

  app.post("/routines", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(routines).values({
      id,
      tenantId: c.get("tenantId"),
      title: body.title as string,
      description: body.description as string | undefined,
      assigneeAgentId: (body.assigneeAgentId as string) || null,
      workflowId: (body.workflowId as string) || null,
      cronExpression: body.cronExpression as string,
      timezone: (body.timezone as string) ?? "UTC",
      concurrencyPolicy: (body.concurrencyPolicy as string) ?? "skip_if_active",
    });
    const rows = await db.select().from(routines).where(eq(routines.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.patch("/routines/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) values.title = body.title;
    if (body.cronExpression !== undefined) values.cronExpression = body.cronExpression;
    if (body.status !== undefined) values.status = body.status;
    if (body.concurrencyPolicy !== undefined) values.concurrencyPolicy = body.concurrencyPolicy;

    await db.update(routines).set(values).where(
      and(eq(routines.id, c.req.param("id")), eq(routines.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(routines).where(eq(routines.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  app.delete("/routines/:id", async (c) => {
    await db.delete(routines).where(
      and(eq(routines.id, c.req.param("id")), eq(routines.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  app.post("/routines/:id/trigger", async (c) => {
    const rows = await db.select().from(routines).where(
      and(eq(routines.id, c.req.param("id")), eq(routines.tenantId, c.get("tenantId"))),
    ).limit(1);
    const routine = rows[0];
    if (!routine) return c.json({ error: "Routine not found" }, 404);

    if (routine.workflowId && toolRegistry) {
      const result = await runWorkflow(
        { db, toolRegistry },
        {
          workflowId: routine.workflowId,
          tenantId: c.get("tenantId"),
          payload: { routineId: routine.id, routineTitle: routine.title, triggerType: "routine" },
          invokedBy: "admin",
        },
      );
      return c.json({
        kind: "workflow_executed",
        runId: result.runId,
        status: result.ok ? "completed" : "failed",
        error: result.error?.message,
      });
    }

    if (!routine.assigneeAgentId) {
      return c.json({ error: "Routine has no agent or workflow target" }, 400);
    }

    // Manual routine trigger — same task-per-fire pattern as the
    // scheduler. Each fire gets its own task → its own session.
    const tenantId = c.get("tenantId");
    const taskId = generateId();
    await db.insert(tasks).values({
      id: taskId,
      tenantId,
      title: `Routine: ${routine.title}`,
      description: routine.description ?? "",
      status: "todo",
      originKind: "routine",
      originId: routine.id,
      assigneeAgentId: routine.assigneeAgentId,
    });

    const outcome = await engine.wake({
      agentId: routine.assigneeAgentId,
      tenantId,
      taskId,
      reason: "routine_triggered",
    });
    if (outcome.kind === "created") {
      await engine.enqueue(outcome.wakeupRequestId);
    }

    return c.json({ ...outcome, taskId });
  });

  // ── Workflows ──────────────────────────────────────────────────────────

  app.get("/workflows", async (c) => {
    const rows = await db.select().from(workflows).where(eq(workflows.tenantId, c.get("tenantId")));
    return c.json({ workflows: rows });
  });

  app.get("/workflows/:id", async (c) => {
    const rows = await db.select().from(workflows).where(
      and(eq(workflows.id, c.req.param("id")), eq(workflows.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Workflow not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/workflows", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(workflows).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      type: (body.type as string) ?? "user",
      governingAgentId: (body.governingAgentId as string) || null,
      blocks: (body.blocks ?? []) as Record<string, unknown>[],
      edges: (body.edges ?? []) as Record<string, unknown>[],
    });
    const rows = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.patch("/workflows/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) values.name = body.name;
    if (body.status !== undefined) values.status = body.status;
    if (body.blocks !== undefined) values.blocks = body.blocks;
    if (body.edges !== undefined) values.edges = body.edges;
    if (body.governingAgentId !== undefined) values.governingAgentId = body.governingAgentId;

    await db.update(workflows).set(values).where(
      and(eq(workflows.id, c.req.param("id")), eq(workflows.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(workflows).where(eq(workflows.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  app.delete("/workflows/:id", async (c) => {
    await db.delete(workflows).where(
      and(eq(workflows.id, c.req.param("id")), eq(workflows.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  /**
   * Manually trigger a workflow run. Useful for testing, debugging, and
   * letting users "run now" without waiting for cron.
   */
  app.post("/workflows/:id/execute", async (c) => {
    if (!toolRegistry) return c.json({ error: "v2 dispatcher not available" }, 503);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await runWorkflow(
      { db, toolRegistry },
      {
        workflowId: c.req.param("id"),
        tenantId: c.get("tenantId"),
        payload: (body.payload as Record<string, unknown> | undefined) ?? {},
        invokedBy: "admin",
      },
    );
    return c.json({
      runId: result.runId,
      status: result.ok ? "completed" : "failed",
      error: result.error?.message,
    });
  });

  // Alias used by the shell's Workflows screen.
  app.post("/workflows/:id/run", async (c) => {
    if (!toolRegistry) return c.json({ error: "v2 dispatcher not available" }, 503);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await runWorkflow(
      { db, toolRegistry },
      {
        workflowId: c.req.param("id"),
        tenantId: c.get("tenantId"),
        payload: (body.payload as Record<string, unknown> | undefined) ?? {},
        invokedBy: "admin",
      },
    );
    return c.json({
      runId: result.runId,
      status: result.ok ? "completed" : "failed",
      error: result.error?.message,
    });
  });

  /**
   * SSE stream of lifecycle events scoped to a single workflow run. Powers
   * the live DAG view. Frontend opens an EventSource on this URL and
   * invalidates its React Query cache when any event arrives.
   *
   * EventSource can't send custom Authorization headers, so this accepts
   * the session bearer as `?token=` query param as well. Read-only.
   */
  app.get("/workflow-runs/:id/events", async (c) => {
    if (!realtimeBus) return c.json({ error: "realtime bus not available" }, 503);

    let tenantId = c.get("tenantId") as string | undefined;
    if (!tenantId) {
      const queryToken = c.req.query("token");
      if (!queryToken) return c.json({ error: "missing auth" }, 401);
      const { validateSession } = await import("./auth.js");
      const session = await validateSession(db, queryToken);
      if (!session) return c.json({ error: "invalid token" }, 401);
      tenantId = session.tenantId;
    }

    const runRows = await db.select({ id: workflowRuns.id }).from(workflowRuns).where(
      and(eq(workflowRuns.id, c.req.param("id")), eq(workflowRuns.tenantId, tenantId)),
    ).limit(1);
    if (!runRows[0]) return c.json({ error: "run not found" }, 404);

    const runId = c.req.param("id");
    const { streamSSE } = await import("hono/streaming");
    const scopedTenantId = tenantId;

    return streamSSE(c, async (stream) => {
      const unsubscribe = realtimeBus.subscribe(scopedTenantId, (event) => {
        if (!event.type.startsWith("workflow:")) return;
        const payload = event.data as { runId?: string };
        if (payload.runId !== runId) return;
        stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
      });
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" });
      }, 30000);
      stream.onAbort(() => { unsubscribe(); clearInterval(heartbeat); });
      await new Promise(() => {});
    });
  });

  /**
   * Resume a paused workflow run. Called by the CRM actions executor when
   * a user approves an `agent_action` whose `proposedParams.kind` is
   * `"resume_workflow"`. Re-enters the run, finalizes the paused block
   * with user input, and walks the rest of the DAG.
   */
  app.post("/workflow-runs/:id/resume", async (c) => {
    // v1 wait-for-human resume isn't ported to v2. Workflows that
    // need human-in-the-loop should use an `agent_action` task and
    // re-trigger the workflow from a comment instead.
    void c;
    return c.json(
      { error: "Workflow resume is not supported in v2." },
      410,
    );
  });

  /**
   * Replay a past run. Loads the original run's workflowId + triggerPayload
   * and re-executes against the *current* workflow definition. That matters
   * for debugging: after you fix a block you can re-run the scenario that
   * broke without reconstructing its input.
   *
   * Note: we execute the workflow as it is *now*, not a snapshot of what
   * the definition looked like when the run first fired. Replay is a
   * "does this still happen?" tool, not a "reproduce byte-for-byte" tool.
   */
  app.post("/workflow-runs/:id/replay", async (c) => {
    if (!toolRegistry) return c.json({ error: "v2 dispatcher not available" }, 503);
    const tenantId = c.get("tenantId") as string;

    const runRows = await db.select({
      id: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      triggerPayload: workflowRuns.triggerPayload,
    }).from(workflowRuns).where(
      and(eq(workflowRuns.id, c.req.param("id")), eq(workflowRuns.tenantId, tenantId)),
    ).limit(1);

    const original = runRows[0];
    if (!original) return c.json({ error: "run not found" }, 404);

    const result = await runWorkflow(
      { db, toolRegistry },
      {
        workflowId: original.workflowId,
        tenantId,
        payload: (original.triggerPayload as Record<string, unknown> | null) ?? {},
        invokedBy: "admin",
      },
    );
    return c.json({
      runId: result.runId,
      status: result.ok ? "completed" : "failed",
      error: result.error?.message,
      replayedFromRunId: original.id,
    });
  });

  // ── Workflow runs (execution history) ──────────────────────────────────

  /**
   * Recent runs scoped to a workflow. Use this to power the "History" tab
   * on a workflow's detail page.
   */
  app.get("/workflows/:id/runs", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
    const rows = await db.select().from(workflowRuns)
      .where(and(
        eq(workflowRuns.workflowId, c.req.param("id")),
        eq(workflowRuns.tenantId, c.get("tenantId")),
      ))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(limit);
    return c.json({ runs: rows });
  });

  /**
   * All recent runs for the tenant across every workflow. Used by the
   * Workflows list view to show "last activity" and by a future
   * "Workflow activity feed" page.
   */
  app.get("/workflow-runs", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
    const rows = await db.select().from(workflowRuns)
      .where(eq(workflowRuns.tenantId, c.get("tenantId")))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(limit);
    return c.json({ runs: rows });
  });

  /**
   * Full per-block execution detail for one run. Powers the DAG trace view:
   * each block's resolved config, input context snapshot, output, timing,
   * and any error.
   */
  app.get("/workflow-runs/:id", async (c) => {
    const runRows = await db.select().from(workflowRuns)
      .where(and(
        eq(workflowRuns.id, c.req.param("id")),
        eq(workflowRuns.tenantId, c.get("tenantId")),
      ))
      .limit(1);
    const run = runRows[0];
    if (!run) return c.json({ error: "run not found" }, 404);

    const blocks = await db.select().from(workflowBlockRuns)
      .where(eq(workflowBlockRuns.workflowRunId, run.id))
      .orderBy(workflowBlockRuns.startedAt);

    return c.json({ run, blocks });
  });

  // ── Budgets ──────────────────────────────────────────────────────────────

  app.get("/budgets", async (c) => {
    const rows = await db.select().from(budgetPolicies)
      .where(eq(budgetPolicies.tenantId, c.get("tenantId")));
    return c.json({ policies: rows });
  });

  app.post("/budgets", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(budgetPolicies).values({
      id,
      tenantId: c.get("tenantId"),
      agentId: body.agentId as string | undefined,
      scope: (body.scope as string) ?? "tenant",
      period: (body.period as string) ?? "monthly",
      limitCents: body.limitCents as number,
      warnThresholdPct: (body.warnThresholdPct as number) ?? 80,
    });
    const rows = await db.select().from(budgetPolicies).where(eq(budgetPolicies.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.delete("/budgets/:id", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    await db.delete(budgetPolicies).where(
      and(eq(budgetPolicies.id, c.req.param("id")), eq(budgetPolicies.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  app.get("/budgets/incidents", async (c) => {
    const rows = await db.select().from(budgetIncidents)
      .where(eq(budgetIncidents.tenantId, c.get("tenantId")))
      .orderBy(desc(budgetIncidents.createdAt))
      .limit(50);
    return c.json({ incidents: rows });
  });

  // ── Settings ────────────────────────────────────────────────────────────

  app.get("/settings", async (c) => {
    const { tenantSettings } = await import("@boringos/db");
    const rows = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, c.get("tenantId")));
    const settings: Record<string, string | null> = {};
    for (const row of rows) settings[row.key] = row.value;
    return c.json({ settings });
  });

  app.patch("/settings", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const body = await c.req.json() as Record<string, unknown>;
    const { tenantSettings } = await import("@boringos/db");
    const tenantId = c.get("tenantId");

    for (const [key, value] of Object.entries(body)) {
      const strValue = value === null ? null : String(value);
      const existing = await db.select().from(tenantSettings).where(
        and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, key)),
      ).limit(1);

      if (existing[0]) {
        await db.update(tenantSettings).set({ value: strValue, updatedAt: new Date() }).where(eq(tenantSettings.id, existing[0].id));
      } else {
        await db.insert(tenantSettings).values({ id: generateId(), tenantId, key, value: strValue });
      }
    }

    const rows = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    const settings: Record<string, string | null> = {};
    for (const row of rows) settings[row.key] = row.value;

    // When agents are resumed, re-wake every (agent, task) pair that
    // was sitting in todo. Sessions are per-task, so the wake must
    // carry the taskId — otherwise the engine will reject it.
    if (body.agents_paused === "false" || body.agents_paused === false) {
      try {
        const pending = await db.execute(sql`
          SELECT t.assignee_agent_id AS agent_id, t.id AS task_id
            FROM tasks t
           WHERE t.tenant_id = ${tenantId}
             AND t.status = 'todo'
             AND t.assignee_agent_id IS NOT NULL
        `);
        for (const row of pending as unknown as Array<{ agent_id: string; task_id: string }>) {
          const outcome = await engine.wake({
            agentId: row.agent_id,
            tenantId,
            taskId: row.task_id,
            reason: "manual_request",
          });
          if (outcome.kind === "created") {
            await engine.enqueue(outcome.wakeupRequestId);
          }
        }
      } catch {
        // Non-fatal
      }
    }

    return c.json({ settings });
  });

  // ── Tenants ─────────────────────────────────────────────────────────────

  app.get("/tenants/current", async (c) => {
    const rows = await db.select().from(tenants).where(eq(tenants.id, c.get("tenantId"))).limit(1);
    if (!rows[0]) return c.json({ error: "Tenant not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/tenants", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(tenants).values({
      id,
      name: body.name as string,
      slug: body.slug as string,
    });
    const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  // ── Drive ───────────────────────────────────────────────────────────────

  app.get("/drive/list", async (c) => {
    const prefix = c.req.query("path");
    const rows = await db.select().from(driveFiles).where(eq(driveFiles.tenantId, c.get("tenantId")));
    let filtered = rows;
    if (prefix) filtered = rows.filter((r) => r.path.startsWith(prefix));
    return c.json({ files: filtered });
  });

  app.get("/drive/skill", async (c) => {
    // Read from most recent revision or return null
    const rows = await db.select().from(driveSkillRevisions)
      .where(eq(driveSkillRevisions.tenantId, c.get("tenantId")))
      .orderBy(desc(driveSkillRevisions.createdAt))
      .limit(1);
    return c.json({ skill: rows[0]?.content ?? null });
  });

  app.patch("/drive/skill", async (c) => {
    const body = await c.req.json() as { content: string; changedBy?: string };
    await db.insert(driveSkillRevisions).values({
      id: generateId(),
      tenantId: c.get("tenantId"),
      content: body.content,
      changedBy: body.changedBy ?? null,
    });
    return c.json({ ok: true });
  });

  app.get("/drive/skill/revisions", async (c) => {
    const rows = await db.select().from(driveSkillRevisions)
      .where(eq(driveSkillRevisions.tenantId, c.get("tenantId")))
      .orderBy(desc(driveSkillRevisions.createdAt))
      .limit(20);
    return c.json({ revisions: rows });
  });

  // ── Onboarding ──────────────────────────────────────────────────────────

  app.get("/onboarding", async (c) => {
    const rows = await db.select().from(onboardingState)
      .where(eq(onboardingState.tenantId, c.get("tenantId")))
      .limit(1);

    if (!rows[0]) {
      // Auto-create onboarding state
      const id = generateId();
      await db.insert(onboardingState).values({ id, tenantId: c.get("tenantId") });
      return c.json({ currentStep: 1, totalSteps: 5, completedSteps: [], completed: false });
    }

    return c.json({
      currentStep: rows[0].currentStep,
      totalSteps: rows[0].totalSteps,
      completedSteps: rows[0].completedSteps,
      completed: !!rows[0].completedAt,
      metadata: rows[0].metadata,
    });
  });

  app.post("/onboarding/complete-step", async (c) => {
    const body = await c.req.json() as { step: number; metadata?: Record<string, unknown> };
    const tenantId = c.get("tenantId");

    const rows = await db.select().from(onboardingState)
      .where(eq(onboardingState.tenantId, tenantId)).limit(1);

    if (!rows[0]) {
      return c.json({ error: "Onboarding not started" }, 404);
    }

    const completed = [...(rows[0].completedSteps as number[])];
    if (!completed.includes(body.step)) completed.push(body.step);

    const nextStep = body.step + 1;
    const isComplete = completed.length >= rows[0].totalSteps;

    const updates: Record<string, unknown> = {
      currentStep: isComplete ? rows[0].totalSteps : nextStep,
      completedSteps: completed,
      updatedAt: new Date(),
    };
    if (body.metadata) {
      const existing = rows[0].metadata as Record<string, unknown>;
      updates.metadata = { ...existing, [`step${body.step}`]: body.metadata };
    }
    if (isComplete) updates.completedAt = new Date();

    await db.update(onboardingState).set(updates).where(eq(onboardingState.id, rows[0].id));

    return c.json({ step: body.step, completed: isComplete, nextStep: isComplete ? null : nextStep });
  });

  // ── Evals ───────────────────────────────────────────────────────────────

  app.get("/evals", async (c) => {
    const rows = await db.select().from(evals).where(eq(evals.tenantId, c.get("tenantId")));
    return c.json({ evals: rows });
  });

  app.post("/evals", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(evals).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      description: body.description as string | undefined,
      testCases: (body.testCases as Array<{ input: string }>) ?? [],
    });
    const rows = await db.select().from(evals).where(eq(evals.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.get("/evals/:id/runs", async (c) => {
    const rows = await db.select().from(evalRuns)
      .where(and(eq(evalRuns.evalId, c.req.param("id")), eq(evalRuns.tenantId, c.get("tenantId"))))
      .orderBy(desc(evalRuns.startedAt));
    return c.json({ runs: rows });
  });

  app.post("/evals/:id/run", async (c) => {
    const body = await c.req.json() as { agentId: string };
    const evalRows = await db.select().from(evals).where(eq(evals.id, c.req.param("id"))).limit(1);
    if (!evalRows[0]) return c.json({ error: "Eval not found" }, 404);

    const id = generateId();
    const testCases = evalRows[0].testCases as Array<{ input: string }>;
    await db.insert(evalRuns).values({
      id,
      tenantId: c.get("tenantId"),
      evalId: c.req.param("id"),
      agentId: body.agentId,
      totalCases: testCases.length,
      status: "pending",
    });

    return c.json({ runId: id, totalCases: testCases.length }, 201);
  });

  // ── Inbox ───────────────────────────────────────────────────────────────

  app.get("/inbox", async (c) => {
    const status = c.req.query("status") ?? "unread";
    const assigneeUser = c.req.query("assigneeUserId");
    const resolvedAssigneeUser = assigneeUser === "me" ? c.get("userId") : assigneeUser;

    const conditions = [eq(inboxItems.tenantId, c.get("tenantId")), eq(inboxItems.status, status)];
    if (resolvedAssigneeUser) conditions.push(eq(inboxItems.assigneeUserId, resolvedAssigneeUser));

    const rows = await db.select().from(inboxItems)
      .where(and(...conditions))
      .orderBy(desc(inboxItems.createdAt))
      .limit(100);
    return c.json({ items: rows });
  });

  app.get("/inbox/:id", async (c) => {
    const rows = await db.select().from(inboxItems).where(
      and(eq(inboxItems.id, c.req.param("id")), eq(inboxItems.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Inbox item not found" }, 404);

    // Mark as read
    if (rows[0].status === "unread") {
      await db.update(inboxItems).set({ status: "read", updatedAt: new Date() }).where(eq(inboxItems.id, rows[0].id));
      // Mirror to Gmail: remove UNREAD label.
      void syncStatusChange({ db }, c.get("tenantId"), rows[0].id, "read");
    }

    return c.json(rows[0]);
  });

  app.patch("/inbox/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) values.status = body.status;
    if (body.metadata !== undefined) values.metadata = body.metadata;
    if (body.assigneeUserId !== undefined) values.assigneeUserId = body.assigneeUserId;

    // Snooze wiring: clear snooze_until when status flips off "snoozed";
    // accept an explicit snoozeUntil (ISO string) to set/extend.
    if (body.snoozeUntil !== undefined) {
      values.snoozeUntil = body.snoozeUntil
        ? new Date(body.snoozeUntil as string)
        : null;
    } else if (body.status !== undefined && body.status !== "snoozed") {
      values.snoozeUntil = null;
    }

    const itemId = c.req.param("id");
    const tenantId = c.get("tenantId");
    await db.update(inboxItems).set(values).where(
      and(eq(inboxItems.id, itemId), eq(inboxItems.tenantId, tenantId)),
    );
    // Mirror status changes to Gmail. Fire-and-forget — local state is
    // source of truth; Gmail can lag without rolling back the user's
    // action.
    if (body.status !== undefined && typeof body.status === "string") {
      void syncStatusChange({ db }, tenantId, itemId, body.status);
    }
    const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, itemId)).limit(1);
    if (!rows[0]) return c.json({ error: "Inbox item not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/inbox/:id/archive", async (c) => {
    const itemId = c.req.param("id");
    const tenantId = c.get("tenantId");
    await db.update(inboxItems).set({
      status: "archived",
      archivedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(inboxItems.id, itemId), eq(inboxItems.tenantId, tenantId)));
    void syncArchive({ db }, tenantId, itemId);
    return c.json({ ok: true });
  });

  app.post("/inbox/:id/create-task", async (c) => {
    const itemRows = await db.select().from(inboxItems).where(eq(inboxItems.id, c.req.param("id"))).limit(1);
    if (!itemRows[0]) return c.json({ error: "Inbox item not found" }, 404);

    const item = itemRows[0];
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const taskId = generateId();
    await db.insert(tasks).values({
      id: taskId,
      tenantId: c.get("tenantId"),
      title: item.subject,
      description: item.body ?? undefined,
      status: "todo",
      priority: "medium",
      assigneeUserId: (body.assigneeUserId as string) ?? c.get("userId") ?? undefined,
      originKind: "inbox",
      originId: item.id,
    });

    await db.update(inboxItems).set({ linkedTaskId: taskId, updatedAt: new Date() }).where(eq(inboxItems.id, item.id));

    return c.json({ taskId }, 201);
  });

  // ── Costs ───────────────────────────────────────────────────────────────

  app.get("/costs", async (c) => {
    const rows = await db.select().from(costEvents)
      .where(eq(costEvents.tenantId, c.get("tenantId")))
      .orderBy(desc(costEvents.createdAt))
      .limit(100);
    return c.json({ costs: rows });
  });

  // ── Entity References ────────────────────────────────────────────────────

  app.post("/entities/link", async (c) => {
    const body = await c.req.json() as { entityType: string; entityId: string; refType: string; refId: string };
    const id = generateId();
    await db.insert(entityReferences).values({
      id,
      tenantId: c.get("tenantId"),
      entityType: body.entityType,
      entityId: body.entityId,
      refType: body.refType,
      refId: body.refId,
    });
    return c.json({ id }, 201);
  });

  app.get("/entities/:type/:id/refs", async (c) => {
    const rows = await db.select().from(entityReferences).where(
      and(
        eq(entityReferences.tenantId, c.get("tenantId")),
        eq(entityReferences.entityType, c.req.param("type")),
        eq(entityReferences.entityId, c.req.param("id")),
      ),
    );

    // Group by refType
    const grouped: Record<string, string[]> = {};
    for (const row of rows) {
      if (!grouped[row.refType]) grouped[row.refType] = [];
      grouped[row.refType].push(row.refId);
    }

    return c.json({ entityType: c.req.param("type"), entityId: c.req.param("id"), refs: grouped });
  });

  app.delete("/entities/link/:id", async (c) => {
    await db.delete(entityReferences).where(
      and(eq(entityReferences.id, c.req.param("id")), eq(entityReferences.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  // ── Search ──────────────────────────────────────────────────────────────

  app.get("/search", async (c) => {
    const q = c.req.query("q");
    if (!q) return c.json({ error: "Missing q parameter" }, 400);

    const tenantId = c.get("tenantId");
    const pattern = `%${q}%`;

    // Search across multiple tables in parallel
    const [taskResults, agentResults, inboxResults] = await Promise.all([
      db.execute(
        sql`SELECT id, title, status, identifier FROM tasks WHERE tenant_id = ${tenantId} AND (title ILIKE ${pattern} OR description ILIKE ${pattern}) LIMIT 20`,
      ),
      db.execute(
        sql`SELECT id, name, role, status FROM agents WHERE tenant_id = ${tenantId} AND (name ILIKE ${pattern} OR role ILIKE ${pattern}) LIMIT 20`,
      ),
      db.execute(
        sql`SELECT id, subject, source, status FROM inbox_items WHERE tenant_id = ${tenantId} AND (subject ILIKE ${pattern} OR body ILIKE ${pattern}) LIMIT 20`,
      ),
    ]);

    return c.json({
      tasks: taskResults,
      agents: agentResults,
      inboxItems: inboxResults,
    });
  });

  return app;
}
