// SPDX-License-Identifier: MIT
//
// `inbox` Module — wraps inbox CRUD as v2 tools beyond what the
// `framework` module ships. Framework already has `inbox.read`
// and `inbox.update` (task_12 §14). This module adds the
// listing + archive + create-task operations the triage path
// needs.
//
// Phase 5 of task_12.

import { and, eq, desc } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { inboxItems, tasks } from "@boringos/db";
import { generateId } from "@boringos/shared";
import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";

const INBOX_SKILL = `The inbox holds incoming messages from connectors
(emails, Slack mentions, etc.) before they're triaged. Use the inbox tools
to:

- \`inbox.list(status?)\` — see pending items, optionally filtered by
  status (unread / read / snoozed / archived / superseded)
- \`inbox.archive(itemId)\` — mark handled
- \`inbox.create_task(itemId, title, ...)\` — convert an item into an
  actionable task

Triage rule: each inbound message becomes either a task (if it requires
work) or gets archived (if it's noise / FYI / obsoleted by a later message).
Don't leave items in unread indefinitely — that's where attention rots.`;

export const createInboxModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;

  const listTool: Tool = {
    name: "list",
    description: "List inbox items for the current tenant",
    inputs: z.object({
      status: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
    async handler(
      input: { status?: string; limit?: number },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const filter = input.status
        ? and(
            eq(inboxItems.tenantId, ctx.tenantId),
            eq(inboxItems.status, input.status),
          )
        : eq(inboxItems.tenantId, ctx.tenantId);
      const rows = await db
        .select()
        .from(inboxItems)
        .where(filter)
        .orderBy(desc(inboxItems.createdAt))
        .limit(input.limit ?? 50);
      return { ok: true, result: { items: rows } };
    },
  };

  const archiveTool: Tool = {
    name: "archive",
    description: "Archive an inbox item (it's handled or no longer relevant)",
    inputs: z.object({ itemId: z.string().uuid() }),
    async handler(
      input: { itemId: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.id, input.itemId))
        .limit(1);
      const item = rows[0];
      if (!item || item.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "not_found", message: "Inbox item not found", retryable: false },
        };
      }
      await db
        .update(inboxItems)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(inboxItems.id, input.itemId));
      return { ok: true, result: { ok: true } };
    },
  };

  const createTaskTool: Tool = {
    name: "create_task",
    description: "Convert an inbox item into a task",
    inputs: z.object({
      itemId: z.string().uuid(),
      title: z.string(),
      description: z.string().optional(),
      assigneeAgentId: z.string().uuid().optional(),
      assigneeUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: {
        itemId: string;
        title: string;
        description?: string;
        assigneeAgentId?: string;
        assigneeUserId?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const itemRows = await db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.id, input.itemId))
        .limit(1);
      const item = itemRows[0];
      if (!item || item.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "not_found", message: "Inbox item not found", retryable: false },
        };
      }
      const taskId = generateId();
      await db.insert(tasks).values({
        id: taskId,
        tenantId: ctx.tenantId,
        title: input.title,
        description: input.description,
        status: "todo",
        priority: "medium",
        assigneeAgentId: input.assigneeAgentId,
        assigneeUserId: input.assigneeUserId,
        createdByAgentId: ctx.agentId,
        originKind: "inbox",
        originId: input.itemId,
      });
      // Mark the inbox item read so it doesn't re-trigger triage.
      await db
        .update(inboxItems)
        .set({ status: "read", updatedAt: new Date() })
        .where(eq(inboxItems.id, input.itemId));
      return { ok: true, result: { taskId } };
    },
  };

  const module: Module = {
    id: "inbox",
    name: "Inbox",
    version: "0.1.0",
    description: "Inbound messages from connectors, awaiting triage",
    provides: ["inbox"],
    skills: [
      {
        id: "inbox",
        source: "module",
        body: INBOX_SKILL,
        priority: 68,
      },
    ],
    tools: [listTool, archiveTool, createTaskTool],
  };

  return module;
};
