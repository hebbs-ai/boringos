import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { agents, tasks } from "@boringos/db";
import { generateId } from "@boringos/shared";

/**
 * Find the best direct report to delegate a task to.
 *
 * Three tiers, resolved in order:
 *  A) routing-tag match — task's requiredTag (explicit) or tag name found in title/description
 *  B) role heuristic — hardcoded keyword-to-role regex (original behavior)
 *  C) LLM router — optional, requires forceLLM or tenant opt-in; currently a stub that returns null
 *
 * Routing tags live on `agents.routingTags` (jsonb string array). They are NOT the
 * same as prompt skills (modules + company_skills); they are operator-set hints
 * the router uses to send a task to the right agent. See task_15 §1 for context.
 *
 * Load-aware tiebreak: among tied candidates, prefer the agent with fewer in-flight tasks.
 */
export interface DelegateQuery {
  title: string;
  description?: string;
  requiredTag?: string;
  forceLLM?: boolean;
}

export async function findDelegateForTask(
  db: Db,
  agentId: string,
  titleOrQuery: string | DelegateQuery,
): Promise<string | null> {
  const query: DelegateQuery = typeof titleOrQuery === "string"
    ? { title: titleOrQuery }
    : titleOrQuery;

  const reports = (await db.select().from(agents).where(eq(agents.reportsTo, agentId))) as Array<{
    id: string;
    role: string;
    status: string;
    routingTags: string[] | null;
  }>;
  if (reports.length === 0) return null;

  const eligible = reports.filter((r) => r.status !== "paused" && r.status !== "archived");
  if (eligible.length === 0) return null;

  // Tier A: routing-tag match
  const tierA = matchByRoutingTag(query, eligible);
  if (tierA.length > 0) {
    return await tiebreakByLoad(db, tierA);
  }

  // Tier B: role heuristic
  const tierB = matchByRole(query, eligible);
  if (tierB.length > 0) {
    return await tiebreakByLoad(db, tierB);
  }

  // Tier C: LLM router (opt-in, currently a stub)
  if (query.forceLLM) {
    const llmPick = await llmRouterStub(query, eligible);
    if (llmPick) return llmPick;
  }

  // Fallback: least-loaded idle report
  const idle = eligible.filter((r) => r.status === "idle");
  if (idle.length > 0) {
    return await tiebreakByLoad(db, idle.map((r) => r.id));
  }
  return eligible[0]?.id ?? null;
}

function matchByRoutingTag(
  query: DelegateQuery,
  reports: Array<{ id: string; routingTags: string[] | null }>,
): string[] {
  const matches: string[] = [];
  const haystack = `${query.title} ${query.description ?? ""}`.toLowerCase();
  for (const r of reports) {
    const tags = r.routingTags ?? [];
    if (query.requiredTag && tags.includes(query.requiredTag)) {
      matches.push(r.id);
      continue;
    }
    // Any routing tag mentioned in the task title/description
    if (tags.some((s) => s && haystack.includes(s.toLowerCase()))) {
      matches.push(r.id);
    }
  }
  return matches;
}

function matchByRole(query: DelegateQuery, reports: Array<{ id: string; role: string }>): string[] {
  const titleLower = `${query.title} ${query.description ?? ""}`.toLowerCase();
  const scores = new Map<string, number>();
  for (const r of reports) {
    let score = 0;
    if (/code|build|fix|implement|test|bug|feature|deploy|ci|refactor/.test(titleLower) && r.role === "engineer") score += 3;
    if (/devops|infra|deploy|pipeline|docker|k8s/.test(titleLower) && r.role === "devops") score += 3;
    if (/research|analyze|investigate|find|explore|discover/.test(titleLower) && r.role === "researcher") score += 3;
    if (/design|ux|ui|wireframe|mockup|prototype/.test(titleLower) && r.role === "designer") score += 3;
    if (/test|qa|quality|verify|validate|regression/.test(titleLower) && r.role === "qa") score += 3;
    if (/plan|roadmap|prioritize|spec|requirement|stakeholder/.test(titleLower) && r.role === "pm") score += 3;
    if (/write|content|blog|social|marketing|copy/.test(titleLower) && r.role === "content-creator") score += 3;
    if (/budget|cost|invoice|financial|expense|revenue/.test(titleLower) && r.role === "finance") score += 3;
    if (score > 0) scores.set(r.id, score);
  }
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0]?.[1];
  return top ? sorted.filter(([, s]) => s === top).map(([id]) => id) : [];
}

async function tiebreakByLoad(db: Db, candidateIds: string[]): Promise<string> {
  if (candidateIds.length === 1) return candidateIds[0];
  const activeTasks = await db.select({ assigneeAgentId: tasks.assigneeAgentId, status: tasks.status })
    .from(tasks)
    .where(and(inArray(tasks.assigneeAgentId, candidateIds), inArray(tasks.status, ["todo", "in_progress"])));
  const load = new Map<string, number>(candidateIds.map((id) => [id, 0]));
  for (const row of activeTasks) {
    if (row.assigneeAgentId) load.set(row.assigneeAgentId, (load.get(row.assigneeAgentId) ?? 0) + 1);
  }
  const sorted = [...load.entries()].sort((a, b) => a[1] - b[1]);
  return sorted[0][0];
}

/**
 * Tier C stub — LLM-based router. Disabled by default.
 * Apps opt in by passing `forceLLM: true` and wiring a real implementation via framework config.
 * Returning null lets the fallback path pick the least-loaded idle report.
 */
async function llmRouterStub(
  _query: DelegateQuery,
  _reports: Array<{ id: string; role: string; routingTags: string[] | null }>,
): Promise<string | null> {
  return null;
}

/**
 * Escalate a blocked task to the agent's boss.
 * Creates a new task assigned to the boss explaining the blocker.
 */
export async function escalateToManager(
  db: Db,
  agentId: string,
  blockedTaskId: string,
  reason?: string,
): Promise<string | null> {
  const agentRows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const agent = agentRows[0];
  if (!agent?.reportsTo) return null;

  const taskRows = await db.select().from(tasks).where(eq(tasks.id, blockedTaskId)).limit(1);
  const task = taskRows[0];
  if (!task) return null;

  return createHandoffTask(db, {
    fromAgentId: agentId,
    toAgentId: agent.reportsTo,
    parentTaskId: blockedTaskId,
    title: `[Escalation] ${agent.name} blocked on: ${task.title}`,
    description: [
      `Agent **${agent.name}** (${agent.role}) is blocked on task **${task.identifier ?? task.id}**: ${task.title}`,
      "",
      reason ? `**Reason:** ${reason}` : "No reason provided.",
      "",
      `Please review and unblock, then notify ${agent.name} when resolved.`,
    ].join("\n"),
    originKind: "escalation",
    priority: "high",
  });
}

/**
 * Create a handoff subtask from one agent to another.
 * Posts a comment on the parent task noting the handoff.
 * Enforces a 3-handoff-per-tree limit; on overflow, marks the root blocked and returns null.
 */
export async function createHandoffTask(
  db: Db,
  params: {
    fromAgentId: string;
    toAgentId: string;
    parentTaskId: string;
    title: string;
    description?: string;
    originKind?: "handoff" | "escalation";
    priority?: "low" | "medium" | "high" | "urgent";
  },
): Promise<string | null> {
  const { taskComments } = await import("@boringos/db");
  const { fromAgentId, toAgentId, parentTaskId } = params;

  // Walk up the parent chain to check depth of handoff-origin tasks.
  const tree = await walkParentChain(db, parentTaskId);
  const handoffDepth = tree.filter((t) => t.originKind === "handoff" || t.originKind === "escalation").length;
  if (handoffDepth >= 3) {
    // Cycle guard — block root and stop.
    const root = tree[tree.length - 1] ?? tree[0];
    if (root) {
      await db.update(tasks).set({ status: "blocked", updatedAt: new Date() }).where(eq(tasks.id, root.id));
    }
    return null;
  }

  const agentRows = await db.select().from(agents).where(inArray(agents.id, [fromAgentId, toAgentId]));
  const fromAgent = agentRows.find((a) => a.id === fromAgentId);
  const toAgent = agentRows.find((a) => a.id === toAgentId);

  const parentRows = await db.select().from(tasks).where(eq(tasks.id, parentTaskId)).limit(1);
  const parent = parentRows[0];
  if (!parent) return null;

  const subtaskId = generateId();
  await db.insert(tasks).values({
    id: subtaskId,
    tenantId: parent.tenantId,
    title: params.title,
    description: params.description,
    status: "todo",
    priority: params.priority ?? "medium",
    assigneeAgentId: toAgentId,
    parentId: parentTaskId,
    originKind: params.originKind ?? "handoff",
    originId: parentTaskId,
  });

  // Note the handoff on the parent task for visibility.
  await db.insert(taskComments).values({
    id: generateId(),
    taskId: parentTaskId,
    tenantId: parent.tenantId,
    body: `Handed off to **${toAgent?.name ?? "agent"}** by ${fromAgent?.name ?? "agent"}.${params.description ? `\n\n${params.description}` : ""}`,
    authorAgentId: fromAgentId,
  });

  return subtaskId;
}

async function walkParentChain(db: Db, taskId: string): Promise<Array<{ id: string; originKind: string | null; parentId: string | null }>> {
  const chain: Array<{ id: string; originKind: string | null; parentId: string | null }> = [];
  let cursor: string | null = taskId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const rows: Array<{ id: string; originKind: string | null; parentId: string | null }> = await db
      .select({ id: tasks.id, originKind: tasks.originKind, parentId: tasks.parentId })
      .from(tasks).where(eq(tasks.id, cursor)).limit(1) as Array<{ id: string; originKind: string | null; parentId: string | null }>;
    const row = rows[0];
    if (!row) break;
    chain.push(row);
    cursor = row.parentId;
  }
  return chain;
}

/**
 * Task 07: Validate reparenting to prevent cycles and structural violations.
 * Returns { valid: true } or { valid: false, reason: string }
 */
export async function validateReparenting(
  db: Db,
  agentId: string,
  newParentId: string | null,
  tenantId: string,
): Promise<{ valid: true } | { valid: false; reason: string }> {
  // Fetch the agent being reparented
  const agentRows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1) as Array<{ source: string; reportsTo: string | null }>;
  const agent = agentRows[0];
  if (!agent) return { valid: false, reason: "Agent not found" };

  // Shell agents cannot be reparented
  if (agent.source === "shell") {
    return { valid: false, reason: "Framework agents (source='shell') cannot be reparented" };
  }

  // Reject self as parent
  if (newParentId === agentId) {
    return { valid: false, reason: "Agent cannot be its own parent" };
  }

  // If newParentId is null, only CoS can have null parent (enforced by DB constraint)
  if (newParentId === null) {
    return { valid: false, reason: "Only the Chief of Staff can have no parent" };
  }

  // Build org tree to check for cycles
  const allAgents = await db.select({ id: agents.id, reportsTo: agents.reportsTo })
    .from(agents).where(eq(agents.tenantId, tenantId)) as Array<{ id: string; reportsTo: string | null }>;

  // Check if newParentId is a descendant of agentId (would create a cycle)
  const isDescendant = (parentId: string, childId: string): boolean => {
    let current = childId;
    while (current) {
      if (current === parentId) return true;
      const parent = allAgents.find((a) => a.id === current);
      current = parent?.reportsTo ?? null as any;
    }
    return false;
  };

  if (isDescendant(agentId, newParentId)) {
    return { valid: false, reason: "Reparenting would create a cycle in the hierarchy" };
  }

  return { valid: true };
}
