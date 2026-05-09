// SPDX-License-Identifier: MIT
//
// `copilot` Module — wraps the per-tenant copilot agent as a v2
// Module. The copilot's bootstrap (auto-create the agent, route
// browser messages to it) continues to live in v1 paths during
// the migration; this module just exposes a `start_session` tool
// so agents can spawn a copilot session, and ships a SKILL.md
// teaching when to delegate to copilot.
//
// Phase 6 of task_12. /api/copilot/* stays alongside until cutover
// for parity.

import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { agents as agentsTable, tasks } from "@boringos/db";
import { generateId } from "@boringos/shared";
import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";

const COPILOT_SKILL = `Copilot is the tenant's built-in conversational
assistant. It can both **operate** the platform (manage agents, tasks,
runs, modules via the admin API) and **build** (read and edit code, run
shell commands).

When to delegate to copilot:
- The user asks an open-ended platform question ("what agents do I have?",
  "show recent runs", "edit this prompt")
- A task could span multiple subsystems and the user wants conversational
  flow rather than a structured form
- A new tenant is being onboarded and needs guidance

When NOT to delegate:
- A specific tool exists for the operation — call it directly
- The work belongs to a domain agent (sales-rep for CRM, devops for
  deploys) — assign there instead
- The operation is critical and requires approval — create an
  agent_action task, not a copilot session

To start a copilot session:
\`copilot.start_session({ title?, initialMessage? })\` — creates a task
with originKind="copilot" and assigneeAgentId pointing at the tenant's
copilot agent. Optionally seeds it with an initial message that the
copilot agent reads on first wake.`;

/**
 * Heuristic placeholder title from the user's first message.
 *
 * Goal: produce something the user recognizes ("oh that's the AI news
 * thread") in the sidebar *immediately* — before the agent has even
 * replied. The persona's first-reply rule will refine this into a 3–6
 * word summary.
 *
 * Rules:
 *   - Strip leading question words ("What/Can/How/Tell me/Could you")
 *     so the title is content-bearing, not interrogative.
 *   - Collapse whitespace and punctuation noise.
 *   - Truncate at the first sentence boundary OR ~50 chars (whichever
 *     hits first), preserving word boundaries.
 *   - Empty / single-word messages fall back to "New conversation."
 */
function derivePlaceholderTitle(raw: string | undefined): string {
  if (!raw) return "New conversation";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "New conversation";

  // Strip a leading interrogative phrase. Order matters — multi-word
  // phrases first so "Can you" wins over "Can".
  const stripped = collapsed
    .replace(
      /^(can\s+you|could\s+you|tell\s+me|show\s+me|help\s+me|help\s+with|please|hey|hi|hello|i\s+want\s+to|i\s+would\s+like\s+to|i'd\s+like\s+to|what's|whats|what\s+is|what|how\s+do\s+i|how\s+can\s+i|how|why|when|where)\b[\s,:.-]*/i,
      "",
    )
    .trim();

  // Cut at first sentence end (?, !, .) for naturalness.
  const sentenceEnd = stripped.search(/[?!.]/);
  let candidate = sentenceEnd > 0 ? stripped.slice(0, sentenceEnd) : stripped;

  // Hard cap at ~50 chars on a word boundary.
  const MAX = 50;
  if (candidate.length > MAX) {
    const cut = candidate.slice(0, MAX);
    const lastSpace = cut.lastIndexOf(" ");
    candidate = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + "…";
  }
  candidate = candidate.trim();

  // If we ended up with nothing useful (e.g., user typed "Hi"), fall
  // back rather than ship an empty title.
  if (candidate.length < 3) return "New conversation";

  // Sentence case: capitalize first letter, leave the rest as-is so
  // proper nouns survive.
  return candidate.charAt(0).toUpperCase() + candidate.slice(1);
}

export const createCopilotModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;

  const startSessionTool: Tool = {
    name: "start_session",
    description: "Create a copilot task and seed it with an optional first message",
    inputs: z.object({
      title: z.string().optional(),
      initialMessage: z.string().optional(),
    }),
    async handler(
      input: { title?: string; initialMessage?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      // Look up the tenant's copilot agent. The framework
      // auto-provisions one per tenant (boringos.ts +
      // tenant-provisioning.ts).
      const copilotRows = await db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.tenantId, ctx.tenantId),
            eq(agentsTable.role, "copilot"),
          ),
        )
        .limit(1);
      const copilotAgentId = copilotRows[0]?.id;
      if (!copilotAgentId) {
        return {
          ok: false,
          error: {
            code: "not_found",
            message:
              "No copilot agent for this tenant. The framework auto-provisions one on tenant creation; if missing, the tenant predates that hook.",
            retryable: false,
          },
        };
      }

      // Title resolution. If the caller gave us one, trust it (and
      // skip auto-renaming downstream — `titleAuto=false`). Otherwise
      // derive a placeholder from the first message so the sidebar
      // shows something content-bearing immediately, and mark
      // `titleAuto=true` so the copilot persona's first-reply rule
      // knows to refine it. Empty/short messages fall back to a
      // generic "New conversation" — better than literal "Copilot
      // session" because at least it doesn't suggest "this is the
      // template, replace it."
      const userProvidedTitle =
        typeof input.title === "string" && input.title.trim().length > 0;
      const finalTitle = userProvidedTitle
        ? input.title!.trim()
        : derivePlaceholderTitle(input.initialMessage);
      const titleAuto = !userProvidedTitle;

      const taskId = generateId();
      await db.insert(tasks).values({
        id: taskId,
        tenantId: ctx.tenantId,
        title: finalTitle,
        description: input.initialMessage ?? null,
        status: "todo",
        priority: "medium",
        assigneeAgentId: copilotAgentId,
        createdByAgentId: ctx.agentId,
        originKind: "copilot",
        metadata: { titleAuto },
      });

      // If an initial message was supplied, post it as a comment
      // so the copilot's prompt picks it up the same way it does
      // for browser-driven sessions.
      if (input.initialMessage) {
        const { taskComments } = await import("@boringos/db");
        await db.insert(taskComments).values({
          id: generateId(),
          taskId,
          tenantId: ctx.tenantId,
          body: input.initialMessage,
          authorAgentId: ctx.agentId,
        });
      }

      return { ok: true, result: { taskId, copilotAgentId } };
    },
  };

  const module: Module = {
    id: "copilot",
    name: "Copilot",
    version: "0.1.0",
    description: "Conversational assistant — wraps the per-tenant copilot agent",
    provides: ["copilot"],
    skills: [
      {
        id: "copilot",
        source: "module",
        body: COPILOT_SKILL,
        priority: 85,
      },
    ],
    tools: [startSessionTool],
  };

  return module;
};
