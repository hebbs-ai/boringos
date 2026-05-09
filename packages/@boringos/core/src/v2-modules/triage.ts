// SPDX-License-Identifier: MIT
//
// `triage` capability module — wraps the inbox-classification
// workflow under a stable tool namespace. Pure consumer: no
// schema, no own data, no 3rd-party broker.
//
// Phase 9 of task_12. First module to exercise `dependsOn`
// capability resolution against another module's `provides`. The
// `inbox` module declares `provides: ["inbox"]`, so this module's
// `dependsOn: [{ capability: "inbox" }]` only resolves when an
// inbox provider is registered.
//
// The module wraps two operations the triage agent uses every
// run; the agent itself makes the classification decision based
// on the SKILL rubric.

import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { inboxItems } from "@boringos/db";
import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";

const TRIAGE_SKILL = `Triage classifies inbound messages so the user knows
what to act on. Every unread inbox item gets exactly one of four labels:

- **urgent** — needs the user to act in the next ~hour. Examples:
  customer escalation, deal at risk, infra incident, calendar conflict
  affecting the next meeting.
- **important** — needs the user to read + decide today, but not in the
  next hour. Examples: vendor proposal, hiring update, board prep.
- **fyi** — informational, no decision needed. Examples: shipping
  confirmation, newsletter, calendar accept from someone reliable.
- **noise** — auto-archive material. Examples: marketing blasts,
  duplicates of a previous thread, system notifications already
  surfaced elsewhere.

Procedure for each item:

1. \`triage.next_pending()\` returns the next unread item. If null, you're
   done — post a comment on your task and end the run.
2. Read the item's full content with \`inbox.read({ itemId })\` if the
   subject + snippet aren't enough.
3. Classify with \`triage.classify({ itemId, label, reason })\`. The
   reason is one short sentence the user will read; lead with WHY,
   not WHAT.
4. Action based on label:
   - **urgent**: \`inbox.create_task({ itemId, title, priority: "high",
     assigneeUserId: <task creator> })\` and continue.
   - **important**: \`inbox.create_task({ itemId, title })\`. Default
     priority is medium.
   - **fyi**: \`inbox.update({ itemId, status: "read" })\`. No task.
   - **noise**: \`inbox.archive({ itemId })\`. No task, gone from the
     inbox.

5. Repeat from step 1. Process at most 20 items per run; if more
   remain, post a comment summarizing what's left and let the next wake
   pick up.

Conventions:
- Don't spend more than a few seconds on \`fyi\` and \`noise\` items.
  These are the majority — fast classification is more important than
  perfect rationale.
- Thread-aware: if an item is part of a thread you've already triaged,
  classify based on the thread's most recent state, not the message
  alone. The framework supersedes earlier thread items automatically.
- When in doubt between two labels, pick the higher-attention one
  (urgent > important > fyi > noise). False positives waste 30
  seconds; false negatives miss decisions.`;

interface TriageDeps {
  db: Db;
  /** Read at call time. Lets `classify` emit `triage.classified`
   *  so the generic-replier knows when to wake. */
  factoryDeps: { eventBus?: unknown };
}

function makeNextPending(deps: TriageDeps): Tool {
  return {
    name: "next_pending",
    description:
      "Return the next unread inbox item that hasn't been triaged yet, or null if the queue is empty",
    inputs: z.object({
      excludeItemIds: z.array(z.string().uuid()).optional(),
    }),
    async handler(
      input: { excludeItemIds?: string[] },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      // Pull the oldest unread item that has no `triage` field
      // in metadata yet. Filtering on jsonb is portable across
      // Postgres versions via the `?` operator on the
      // `metadata` column. We use raw SQL here because Drizzle's
      // jsonb introspection is limited.
      const exclude = input.excludeItemIds ?? [];
      const excludeClause =
        exclude.length > 0
          ? sql`AND ${inboxItems.id}::text NOT IN ${sql.raw(
              `(${exclude.map((id) => `'${id}'`).join(",")})`,
            )}`
          : sql``;
      const rows = await deps.db.execute(sql`
        SELECT id, source, source_id, subject, body, "from",
               metadata, status, created_at
          FROM inbox_items
         WHERE tenant_id = ${ctx.tenantId}
           AND status = 'unread'
           AND (metadata IS NULL OR (metadata->>'triage') IS NULL)
           ${excludeClause}
         ORDER BY created_at ASC
         LIMIT 1
      `);
      const list = rows as unknown as Array<Record<string, unknown>>;
      if (!Array.isArray(list) || list.length === 0) {
        return { ok: true, result: { item: null } };
      }
      return { ok: true, result: { item: list[0] } };
    },
  };
}

function makeClassify(deps: TriageDeps): Tool {
  return {
    name: "classify",
    description:
      "Write a triage classification onto an inbox item's metadata.triage block",
    inputs: z.object({
      itemId: z.string().uuid(),
      label: z.enum(["urgent", "important", "fyi", "noise"]),
      reason: z.string().min(1).max(500),
    }),
    async handler(
      input: { itemId: string; label: string; reason: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await deps.db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.id, input.itemId))
        .limit(1);
      const item = rows[0];
      if (!item) {
        return {
          ok: false,
          error: { code: "not_found", message: "Inbox item not found", retryable: false },
        };
      }
      if (item.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: {
            code: "permission_denied",
            message: "Inbox item belongs to another tenant",
            retryable: false,
          },
        };
      }

      const existingMeta = (item.metadata ?? {}) as Record<string, unknown>;
      const newMeta = {
        ...existingMeta,
        triage: {
          label: input.label,
          reason: input.reason,
          classifiedByAgentId: ctx.agentId ?? null,
          classifiedAt: new Date().toISOString(),
        },
      };

      await deps.db
        .update(inboxItems)
        .set({ metadata: newMeta, updatedAt: new Date() })
        .where(
          and(
            eq(inboxItems.id, input.itemId),
            eq(inboxItems.tenantId, ctx.tenantId),
          ),
        );

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
              // The `triage` v2 module uses urgent/important/fyi/noise
              // labels (its own taxonomy); the replier gate expects
              // lead/reply/internal/newsletter/spam. Both shapes go
              // through under their own keys so the gate can match
              // whichever the writer used.
              classification: input.label,
              label: input.label,
              source: "agent",
              rationale: input.reason,
            },
          });
        } catch (err) {
          console.warn(
            `[triage.classify] triage.classified emit failed for item=${input.itemId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      return {
        ok: true,
        result: { itemId: input.itemId, label: input.label },
      };
    },
  };
}

export const createTriageModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;
  const triageDeps: TriageDeps = { db, factoryDeps: deps };

  const module: Module = {
    id: "triage",
    name: "Inbox triage",
    version: "0.1.0",
    description:
      "Classify inbound messages into urgent / important / fyi / noise — wraps inbox operations under a stable tool namespace",
    provides: ["triage"],
    dependsOn: [{ capability: "inbox" }],
    skills: [
      {
        id: "triage",
        source: "module",
        body: TRIAGE_SKILL,
        priority: 88,
      },
    ],
    tools: [makeNextPending(triageDeps), makeClassify(triageDeps)],
  };

  return module;
};
