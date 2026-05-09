import type { ContextProvider, ContextBuildEvent } from "../types.js";

export function createTaskProvider(deps: { db: unknown }): ContextProvider {
  return {
    name: "task",
    phase: "context",
    priority: 10,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      if (!event.taskId) {
        return `You are **${event.agent.name}**. Wake reason: **${event.wakeReason}**. Check your assigned tasks and proceed.`;
      }

      try {
        const { eq } = await import("drizzle-orm");
        const { tasks } = await import("@boringos/db");
        const db = deps.db as import("@boringos/db").Db;

        const rows = await db.select().from(tasks).where(eq(tasks.id, event.taskId)).limit(1);
        const task = rows[0];
        if (!task) return `Task ${event.taskId} not found.`;

        const parts = [
          `## Task: ${task.identifier ? `${task.identifier}: ` : ""}${task.title}`,
          `**ID:** ${task.id}`,
        ];
        if (task.description) {
          parts.push("", task.description);
        }
        parts.push("", `**Status:** ${task.status} | **Priority:** ${task.priority}`);
        // Surface task.metadata so persona rules that gate on flags
        // (e.g. copilot's `titleAuto` first-reply rename) can see them.
        // Compact JSON keeps the token cost low.
        const metaObj = task.metadata as Record<string, unknown> | null;
        if (metaObj && Object.keys(metaObj).length > 0) {
          parts.push("", `**Metadata:** ${JSON.stringify(metaObj)}`);
        }

        return parts.join("\n");
      } catch {
        return null;
      }
    },
  };
}
