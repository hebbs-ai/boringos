import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { routines, tasks } from "@boringos/db";
import type { AgentEngine, ToolRegistry } from "@boringos/agent";
import { generateId } from "@boringos/shared";
import { runWorkflow } from "./run-workflow.js";

export interface RoutineScheduler {
  start(): void;
  stop(): void;
}

/**
 * Simple interval-based routine scheduler.
 * Checks every 60 seconds for routines whose cron expression matches the current minute.
 *
 * Routines can target either an agent (assigneeAgentId) or a workflow (workflowId).
 * When targeting a workflow, the workflow runs through the v2 dispatcher's
 * `workflow.run` tool — the same path admin-triggered runs use.
 */
export function createRoutineScheduler(
  db: Db,
  engine: AgentEngine,
  toolRegistry?: ToolRegistry,
): RoutineScheduler {
  let interval: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    const activeRoutines = await db.select().from(routines).where(eq(routines.status, "active"));

    for (const routine of activeRoutines) {
      if (shouldRun(routine.cronExpression, routine.timezone ?? "UTC")) {
        try {
          if (routine.workflowId && toolRegistry) {
            // Workflow-triggered routine — go through v2 dispatch.
            await runWorkflow(
              { db, toolRegistry },
              {
                workflowId: routine.workflowId,
                tenantId: routine.tenantId,
                payload: {
                  routineId: routine.id,
                  routineTitle: routine.title,
                  triggerType: "routine",
                },
                invokedBy: "routine",
              },
            );
          } else if (routine.assigneeAgentId) {
            // Agent-triggered routine — every wake must be bound to a
            // task, so create a fresh task per fire. The task is the
            // session boundary; subsequent fires get fresh sessions.
            const taskId = generateId();
            await db.insert(tasks).values({
              id: taskId,
              tenantId: routine.tenantId,
              title: `Routine: ${routine.title}`,
              description: routine.description ?? "",
              status: "todo",
              originKind: "routine",
              originId: routine.id,
              assigneeAgentId: routine.assigneeAgentId,
            });

            const outcome = await engine.wake({
              agentId: routine.assigneeAgentId,
              tenantId: routine.tenantId,
              taskId,
              reason: "routine_triggered",
            });

            if (outcome.kind === "created") {
              await engine.enqueue(outcome.wakeupRequestId);
            }
          }

          await db.update(routines).set({
            lastTriggeredAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(routines.id, routine.id));
        } catch {
          // Routine trigger failure — silently skip this tick
        }
      }
    }
  }

  return {
    start() {
      // Check every 60 seconds
      interval = setInterval(() => tick().catch(() => {}), 60_000);
      // Also run immediately on start
      tick().catch(() => {});
    },

    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },
  };
}

/**
 * Simple cron expression matcher.
 * Supports standard 5-field: minute hour day-of-month month day-of-week
 * Supports: *, specific numbers, and * / step patterns (e.g., * /5 for every 5 minutes)
 */
function shouldRun(cronExpression: string, _timezone: string): boolean {
  const now = new Date();
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return (
    matchField(minute!, now.getMinutes()) &&
    matchField(hour!, now.getHours()) &&
    matchField(dayOfMonth!, now.getDate()) &&
    matchField(month!, now.getMonth() + 1) &&
    matchField(dayOfWeek!, now.getDay())
  );
}

function matchField(field: string, value: number): boolean {
  if (field === "*") return true;

  // Step: */5 means every 5
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2));
    return value % step === 0;
  }

  // Exact match
  return parseInt(field) === value;
}
