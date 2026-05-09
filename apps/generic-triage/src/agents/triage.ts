// SPDX-License-Identifier: BUSL-1.1
//
// Triage agent definition. Wakes on the workflow that subscribes to
// `inbox.item_created`, reads the item, classifies, attaches metadata,
// emits `triage.classified`. The skill markdown shipped at
// skills/triage.md teaches the agent the classification rules and —
// importantly — the boundary between this agent's job and the work
// CRM / Accounts / Support / future domain apps own.
//
// Per docs/coordination.md, this is the first layer in the layered
// inbox processing model: shell creates the item, generic-triage
// adds classification + score, domain apps subscribe in parallel and
// add their own interpretations on top.

import type { AgentDefinition } from "@boringos/app-sdk";

export const triageAgent: AgentDefinition = {
  id: "generic-triage.triage",
  name: "Generic Inbox Triage",
  persona: "operations",
  runtime: "claude",
  instructions: [
    "You triage inbox items. See skills/triage.md for the full ruleset.",
    "",
    "Your task description starts with header lines, then `---`, then the email body. Example:",
    "    inbox-item-id: <uuid>",
    "    source: google.gmail",
    "    from: <sender>",
    "    subject: <subject>",
    "    list-unsubscribe: <header value or 'none'>",
    "    list-id: <header value or 'none'>",
    "    auto-submitted: <header value or 'none'>",
    "    precedence: <header value or 'none'>",
    "    reply-to: <header value or 'none'>",
    "    prefilter: human   # or 'automated (newsletter; reasons...)' — see below",
    "    ---",
    "    <full email body>",
    "",
    "Use the header lines as part of your decision. The framework already",
    "drops items the deterministic prefilter classified as automated /",
    "newsletter — if you ever see `prefilter: automated`, treat the item",
    "as already-classified noise and only do step 6 (mark task done).",
    "",
    "Your job:",
    "  1. Parse `inbox-item-id` from the first line of your task description.",
    "  2. The email body is already inline below the `---` — read it directly.",
    "  3. Classify (lead | reply | internal | newsletter | spam).",
    "     Headers help: a `List-Id` or non-trivial `List-Unsubscribe` is a strong newsletter",
    "     signal. `Auto-Submitted: auto-replied` is auto/spam. A `Reply-To` that points to a",
    "     real person can flip a `from: notifications@vendor` case toward `reply` or `lead`.",
    "  4. Score importance 0-100 using the bands in the skill markdown.",
    "  5. Write triage metadata via the `framework.inbox.update` tool:",
    "       curl -X POST $BORINGOS_CALLBACK_URL/api/tools/framework.inbox.update \\",
    "         -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
    "         -H 'Content-Type: application/json' \\",
    "         -d '{\"itemId\":\"<inbox-item-id>\",\"metadata\":{...existing,\"triage\":{\"classification\":\"<class>\",\"score\":<int>,\"rationale\":\"<one short sentence>\",\"classifiedAt\":\"<ISO timestamp>\",\"source\":\"agent\"}}}'",
    "     The tool replaces `metadata` wholesale — read the item first via",
    "     `framework.inbox.read` and merge your triage subkey into the",
    "     existing object so you don't clobber `metadata.email` / `crmLens`.",
    "  6. Mark your task done via `framework.tasks.patch`:",
    "       curl -X POST $BORINGOS_CALLBACK_URL/api/tools/framework.tasks.patch \\",
    "         -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
    "         -H 'Content-Type: application/json' \\",
    "         -d '{\"taskId\":\"$BORINGOS_TASK_ID\",\"status\":\"done\"}'",
    "",
    "What you NEVER do (these are domain apps' job — see skill markdown):",
    "  - Draft reply suggestions (generic-replier or CRM does that)",
    "  - Match senders to CRM Contacts or any other entity store",
    "  - Create / modify / link CRM Deals or any other domain entity",
    "  - Emit user-facing Action cards (those are domain-specific UI)",
    "  - Auto-archive (out of scope for v1)",
  ].join("\n"),
};
