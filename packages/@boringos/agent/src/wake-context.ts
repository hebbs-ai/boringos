// task_23 F2 — wake-context resolver.
//
// Single source of truth for "who is this wake for and what work is
// it about." Consumed by:
//   - the Drive workdir mount (task_23 F1) — decides which Drive
//     prefixes get symlinked into `<workDir>/drive/`
//   - the ACL gate for tool dispatches (drive-acl.ts) — relaxes
//     the `users/*` block for the resolved wake-owner
//   - the memory checkpoint hook (task_24 M3) — decides whether
//     to log to `tasks/<id>/log.md` or `users/<owner>/sessions/...`
//   - the SKILL-taught read order on wake (task_24 M4) — agents
//     read `users/<owner>/preferences.md` first if owner exists
//
// Without a single resolver these consumers will drift in their
// idea of "who owns this run." Centralise.

import { and, eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { tasks } from "@boringos/db";
import type { AgentRunJob } from "./types.js";

export interface WakeContext {
  /**
   * The user the agent is acting on behalf of, if any. Null for
   * routine-spawned, cron, webhook, or otherwise non-user-initiated
   * wakes — those agents act on tenant-scope only.
   */
  ownerUserId: string | null;
  /**
   * The task this run is bound to. Always set — every wake is
   * task-bound by engine policy (engine.ts enforces).
   */
  taskId: string;
  /** Project the task belongs to, if any. */
  projectId: string | null;
  /** Conversation session id (copilot threads), if any. */
  sessionId: string | null;
  /** Tenant the wake is scoped to. Plumbed for callers that already
   *  have the job and want a single object with everything. */
  tenantId: string;
}

/**
 * Resolve the wake's owner + work context from the job + db.
 *
 * Owner resolution walks the task → parent chain until it finds a
 * `createdByUserId`. A subtask spawned by an agent (no creator user)
 * inherits its parent's owner — otherwise an agent-spawned subtask
 * working on a user's request would lose the user context.
 */
export async function resolveWakeContext(
  db: Db,
  job: AgentRunJob,
): Promise<WakeContext | null> {
  if (!job.taskId) return null;

  // Walk task → parent chain to find the originating human owner.
  // Most wakes resolve in one hop; the loop handles agent-spawned
  // subtasks whose creator field is the agent, not the user.
  let currentTaskId: string | null = job.taskId;
  let ownerUserId: string | null = null;
  let projectId: string | null = null;
  let sessionId: string | null = null;
  // Hard cap to avoid pathological loops on malformed parent chains.
  // Real task trees are shallow (≤5 levels in practice).
  const MAX_HOPS = 16;

  type TaskRow = {
    createdByUserId: string | null;
    assigneeUserId: string | null;
    sessionId: string | null;
    parentId: string | null;
    tenantId: string;
  };

  for (let hop = 0; hop < MAX_HOPS && currentTaskId; hop++) {
    const rows: TaskRow[] = await db
      .select({
        createdByUserId: tasks.createdByUserId,
        assigneeUserId: tasks.assigneeUserId,
        sessionId: tasks.sessionId,
        parentId: tasks.parentId,
        tenantId: tasks.tenantId,
      })
      .from(tasks)
      .where(and(eq(tasks.id, currentTaskId), eq(tasks.tenantId, job.tenantId)))
      .limit(1);

    const row: TaskRow | undefined = rows[0];
    if (!row) break;

    // First seen sessionId wins — it's the leaf task's session.
    if (sessionId === null && row.sessionId) sessionId = row.sessionId;

    // Project: tasks don't have a direct projectId column today
    // (per schema). When the field is added the resolver will pick
    // it up here. For now this stays null. (Drive's projects/
    // namespace is still mounted via the task's project link if
    // task_24's project-link plumbing lands later.)

    // Owner: prefer createdByUserId on the original task; if that's
    // null, fall back to assigneeUserId (handoff tasks where the
    // user is the recipient). Walk parents only if both are null.
    if (row.createdByUserId) {
      ownerUserId = row.createdByUserId;
      break;
    }
    if (row.assigneeUserId) {
      ownerUserId = row.assigneeUserId;
      break;
    }
    if (!row.parentId) break;
    currentTaskId = row.parentId;
  }

  return {
    ownerUserId,
    taskId: job.taskId,
    projectId,
    sessionId,
    tenantId: job.tenantId,
  };
}
