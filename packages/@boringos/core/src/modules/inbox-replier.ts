// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `inbox-replier` Module — replaces the legacy generic-replier app.
//
// Provides the operations-persona reply-drafting agent and the
// inbox-fanout workflow that wakes it on every `inbox.item_created`
// event. Drafts a generic reply (no CRM/domain context) and appends
// to `metadata.replyDrafts`. Never auto-sends.
//
// `defaultInstall: true` so a fresh tenant gets reply drafts for free,
// matching the  generic-replier behaviour before its deletion in
// task_21 Phase E.

import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  Module,
  ModuleFactory,
  ModuleLifecycle,
  ModuleFactoryDeps,
} from "@boringos/module-sdk";
import type { Db } from "@boringos/db";

const REPLIER_AGENT_ROLE = "operations";
const REPLIER_AGENT_NAME = "Generic Email Replier";
const REPLIER_WORKFLOW_NAME = "Draft generic reply for incoming items";

export const REPLIER_AGENT_INSTRUCTIONS_FOR_TEST = [
  "You are a workflow agent that decides whether to append a generic reply draft to an inbox item, and writes it via the framework tool API. You DO work; you do not answer questions. Your output is tool calls, not prose.",
  "",
  "Your task description contains classified item headers, then `---`, then the triage rationale. Read it before issuing any tool calls.",
  "",
  "REQUIRED steps in order. Use the Bash tool. Do not narrate; execute.",
  "",
  "  Step 1. Parse these two values from the task description headers:",
  "    - `inbox-item-id:` → save as ITEM_ID",
  "    - `triage-label:` → save as TRIAGE_LABEL",
  "",
  "  Step 2. SKIP immediately (go to Step 5) if TRIAGE_LABEL is `noise` or `fyi`.",
  "    These categories do not warrant a reply. Do not call `framework.inbox.read`.",
  "",
  "  Step 3. Only if you are going to draft — read the item to get sender headers and body:",
  "      curl -sS -X POST $BORINGOS_CALLBACK_URL/api/tools/framework.inbox.read \\",
  "        -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
  "        -H 'Content-Type: application/json' \\",
  "        -d \"{\\\"itemId\\\":\\\"$ITEM_ID\\\"}\"",
  "    Pull `result.from`, `result.body`, `result.metadata`, and `result.metadata.email.headers`.",
  "",
  "  Step 4. SKIP (go to Step 5 without drafting) if any of these hold:",
  "    - `metadata.email.headers.listUnsubscribe` is non-empty, OR `listId` is non-empty, OR `precedence` is `bulk`/`list`/`junk` — bulk mailer.",
  "    - `metadata.email.headers.autoSubmitted` is anything other than `null` / `no` — auto-generated mail.",
  "    - The body looks like a newsletter footer (single paragraph + 'unsubscribe' link), or `from` is `noreply@` / `no-reply@` / `notifications@` AND `replyTo` is empty.",
  "    - The `from` address is the user's own address.",
  "    Otherwise — draft a polite, generic reply (3-6 sentences, plain text, no HTML). APPEND via `framework.inbox.update`. The tool replaces `metadata` wholesale — copy every existing key, then add or extend `replyDrafts`:",
  "      curl -sS -X POST $BORINGOS_CALLBACK_URL/api/tools/framework.inbox.update \\",
  "        -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
  "        -H 'Content-Type: application/json' \\",
  "        -d '{\"itemId\":\"<ITEM_ID>\",\"metadata\":<MERGED_OBJECT_HERE>}'",
  "    Where <MERGED_OBJECT_HERE> = existing metadata + replyDrafts: [...existing.replyDrafts || [], {author: 'inbox-replier', draftedAt: '<ISO>', body: '<your draft text>'}].",
  "    Verify the response is `{\"ok\":true,...}`. If not, retry once. If still failing, your task fails.",
  "",
  "  Step 5. Mark task done — whether you drafted or skipped:",
  "      curl -sS -X POST $BORINGOS_CALLBACK_URL/api/tools/framework.tasks.patch \\",
  "        -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
  "        -H 'Content-Type: application/json' \\",
  "        -d '{\"taskId\":\"$BORINGOS_TASK_ID\",\"status\":\"done\"}'",
  "",
  "Hard rules:",
  "  - Skipping is the right answer for noise, fyi, newsletters, automated mail, and self-sent mail.",
  "  - The work is complete only after Step 5 returns success — even on a skip path.",
  "  - Never send replies (no SMTP, no Gmail send_email).",
  "  - Never overwrite `metadata.replyDrafts` — always merge.",
  "  - Never overwrite other apps' keys in metadata (preserve `triage`, `email`, `crm.lens`, etc.).",
].join("\n");

const REPLIER_AGENT_INSTRUCTIONS = REPLIER_AGENT_INSTRUCTIONS_FOR_TEST;

const REPLIER_SKILL = `# Inbox Reply Drafter

You are the generic reply drafter. For classified inbox items, decide
whether a reply makes sense and — when it does — draft a polite,
neutral suggestion and append it to the item's drafts list. **You do
not take ownership of the item.** Domain-specific modules (CRM,
Support, etc.) may also draft suggestions for the same item; the user
sees a list and picks which to send.

## Wake model

You wake on \`triage.classified\` events for items labelled \`urgent\`
or \`important\`. The replier workflow filters out \`noise\` and \`fyi\`
upstream via condition blocks, so by the time you receive a task the
item is already worth evaluating. Your task description carries
\`triage-label\` and \`triage-rationale\` in its headers, so you can
evaluate header-based skip conditions without an extra read call
unless you need the email body.

## What you do

For each classified inbox item:

1. Parse \`inbox-item-id\` and \`triage-label\` from your task description headers
2. Skip immediately if \`triage-label\` is \`noise\` or \`fyi\` (belt-and-suspenders guard)
3. If not skipping: read the item (\`framework.inbox.read\`) for headers and body
4. Skip on bulk/automated-mail signals in headers (\`listUnsubscribe\`, \`listId\`, \`precedence\`, \`autoSubmitted\`)
5. Otherwise draft a reply and append to \`metadata.replyDrafts\` via \`framework.inbox.update\`
6. Mark the task done (\`framework.tasks.patch\`) — whether you drafted or skipped

## Skip rules — be aggressive

Skip drafting if **any** of these hold:

- \`triage-label\` is \`noise\` or \`fyi\` (from task description — no read needed)
- \`metadata.email.headers.listUnsubscribe\` is non-empty — bulk mailer
- \`metadata.email.headers.listId\` is non-empty — mailing list
- \`metadata.email.headers.precedence\` is \`bulk\`, \`list\`, or \`junk\`
- \`metadata.email.headers.autoSubmitted\` is anything other than null / \`no\`
- The \`from\` address is \`noreply@\`, \`no-reply@\`, \`notifications@\`, etc. AND \`replyTo\` is empty
- The body looks like a newsletter footer
- The sender is the user themselves
`;

export interface ReplierWorkflowBlock {
  id: string;
  name: string;
  kind: string;
  type: string;
  tool?: string;
  inputs?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface ReplierWorkflowEdge {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  sourceHandle: string | null;
  sortOrder: number;
}

/**
 * Builds the replier workflow DAG.
 *
 * Trigger: `triage.classified` — fires after the triage agent writes
 * its label so the replier only runs for items that have been
 * classified, and only when the label isn't noise/fyi (filtered by
 * the two `not_equals` condition blocks before the task block).
 *
 * Exported for testability — also called from `buildLifecycle` below.
 */
export function buildReplierWorkflowBlocks(agentId: string): {
  blocks: ReplierWorkflowBlock[];
  edges: ReplierWorkflowEdge[];
} {
  const blocks: ReplierWorkflowBlock[] = [
    {
      id: "trigger",
      name: "trigger",
      kind: "trigger",
      type: "trigger",
      config: { eventType: "triage.classified" },
    },
    {
      id: "check-not-noise",
      name: "skip if noise",
      kind: "condition",
      type: "condition",
      config: {
        field: "{{trigger.label}}",
        operator: "not_equals",
        value: "noise",
      },
    },
    {
      id: "check-not-fyi",
      name: "skip if fyi",
      kind: "condition",
      type: "condition",
      config: {
        field: "{{trigger.label}}",
        operator: "not_equals",
        value: "fyi",
      },
    },
    {
      id: "task",
      name: "task",
      kind: "tool",
      type: "tool",
      tool: "framework.tasks.create",
      inputs: {
        title:
          "Draft reply for inbox item {{trigger.itemId}} ({{trigger.label}})",
        description:
          "ACTION: Use the Bash tool to draft a generic reply for this inbox item via framework.inbox.update.\n" +
          "Skip drafting only if headers indicate bulk/automated mail or a no-reply sender.\n" +
          "Otherwise: read the item, draft a polite reply (3-6 sentences), append to replyDrafts, then mark task done.\n" +
          "Do not respond with prose. Use Bash + curl. Your run is incomplete until the PATCH succeeds.\n" +
          "\n--- classified item ---\n" +
          "inbox-item-id: {{trigger.itemId}}\n" +
          "triage-label: {{trigger.label}}\n" +
          "triage-rationale: {{trigger.rationale}}\n" +
          "---",
        originKind: "inbox.draft_reply",
        originId: "{{trigger.itemId}}",
        assigneeAgentId: agentId,
      },
      config: {},
    },
  ];

  const edges: ReplierWorkflowEdge[] = [
    {
      id: "e1",
      sourceBlockId: "trigger",
      targetBlockId: "check-not-noise",
      sourceHandle: null,
      sortOrder: 0,
    },
    {
      id: "e2",
      sourceBlockId: "check-not-noise",
      targetBlockId: "check-not-fyi",
      sourceHandle: "true",
      sortOrder: 0,
    },
    {
      id: "e3",
      sourceBlockId: "check-not-fyi",
      targetBlockId: "task",
      sourceHandle: "true",
      sortOrder: 0,
    },
  ];

  return { blocks, edges };
}

interface ReplierDeps {
  db: Db;
}

function buildLifecycle(deps: ReplierDeps): ModuleLifecycle {
  const installHandler = async (ctx: { tenantId: string; moduleId: string }) => {
    const runtimes = (await deps.db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${ctx.tenantId} AND type = 'claude' LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    const runtimeId = runtimes[0]?.id;
    if (!runtimeId) {
      // eslint-disable-next-line no-console
      console.warn(
        `[inbox-replier] No Claude runtime for tenant ${ctx.tenantId}; skipping seed`,
      );
      return;
    }

    const rootRows = (await deps.db.execute(sql`
      SELECT id FROM agents
      WHERE tenant_id = ${ctx.tenantId} AND reports_to IS NULL
      ORDER BY created_at ASC LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    const rootAgentId = rootRows[0]?.id ?? null;

    await scrubInboxReplier(deps, ctx.tenantId);

    const agentId = randomUUID();
    await deps.db.execute(sql`
      INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, reports_to, created_at, updated_at)
      VALUES (${agentId}, ${ctx.tenantId}, ${REPLIER_AGENT_NAME}, ${REPLIER_AGENT_ROLE}, 'idle',
        ${REPLIER_AGENT_INSTRUCTIONS}, ${runtimeId}, ${rootAgentId}, now(), now())
    `);

    const workflowId = randomUUID();
    const { blocks, edges } = buildReplierWorkflowBlocks(agentId);
    await deps.db.execute(sql`
      INSERT INTO workflows (id, tenant_id, name, type, status, blocks, edges, created_at, updated_at)
      VALUES (${workflowId}, ${ctx.tenantId}, ${REPLIER_WORKFLOW_NAME}, 'system', 'active',
        ${JSON.stringify(blocks)}::jsonb, ${JSON.stringify(edges)}::jsonb, now(), now())
    `);
  };

  return {
    onInstall: installHandler,
    onTenantCreate: installHandler,
    async onUninstall(ctx) {
      await scrubInboxReplier(deps, ctx.tenantId);
    },
  };
}

async function scrubInboxReplier(deps: ReplierDeps, tenantId: string): Promise<void> {
  const agentFilter = sql`tenant_id = ${tenantId} AND name = ${REPLIER_AGENT_NAME} AND role = ${REPLIER_AGENT_ROLE}`;
  const workflowFilter = sql`tenant_id = ${tenantId} AND name = ${REPLIER_WORKFLOW_NAME}`;

  await deps.db.execute(sql`
    DELETE FROM cost_events WHERE run_id IN (
      SELECT id FROM agent_runs WHERE agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
    )
  `);
  await deps.db.execute(sql`
    DELETE FROM agent_runs WHERE agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
  `);
  await deps.db.execute(sql`
    DELETE FROM agent_wakeup_requests WHERE agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
  `);
  await deps.db.execute(sql`
    DELETE FROM workflow_runs WHERE workflow_id IN (SELECT id FROM workflows WHERE ${workflowFilter})
  `);
  await deps.db.execute(sql`DELETE FROM workflows WHERE ${workflowFilter}`);
  await deps.db.execute(sql`
    UPDATE tasks SET assignee_agent_id = NULL WHERE assignee_agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
  `);
  await deps.db.execute(sql`
    UPDATE tasks SET created_by_agent_id = NULL WHERE created_by_agent_id IN (SELECT id FROM agents WHERE ${agentFilter})
  `);
  await deps.db.execute(sql`DELETE FROM agents WHERE ${agentFilter}`);
}

export const createInboxReplierModule: ModuleFactory = (factoryDeps: ModuleFactoryDeps) => {
  const db = factoryDeps.db as Db;
  const deps: ReplierDeps = { db };

  const module: Module = {
    id: "inbox-replier",
    name: "Inbox Replier",
    version: "0.1.0",
    description:
      "Operations-persona agent that drafts generic reply suggestions for inbound mail (skips noise/fyi/bulk/auto). Coexists with domain-specific repliers — multiple modules can suggest, the user picks.",
    provides: ["inbox-replier"],
    dependsOn: [{ capability: "inbox" }],
    defaultInstall: true,
    skills: [
      {
        id: "inbox-replier",
        source: "module",
        body: REPLIER_SKILL,
        priority: 50,
        appliesTo: (event) => event.taskOriginKind === "inbox.draft_reply",
      },
    ],
    lifecycle: buildLifecycle(deps),
  };

  return module;
};
