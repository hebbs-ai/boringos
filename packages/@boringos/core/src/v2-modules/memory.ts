// SPDX-License-Identifier: MIT
//
// `memory` Module — wraps the configured MemoryProvider as a
// v2 Module exposing `memory.{remember, recall, forget}` tools
// plus a SKILL.md teaching agents when to use memory.
//
// Phase 5 of task_12. v1's `memory-skill` context provider stays
// alongside (additive) until cutover.

import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";
import type { MemoryProvider } from "@boringos/memory";

const MEMORY_SKILL = `Use the memory tools to keep context that should outlive
this run.

- \`memory.remember(content, meta?)\` — write a fact, decision, or piece of
  context. Returns a memoryId. Use sparingly: every remember is searchable
  later, so noise hurts recall quality.
- \`memory.recall(query)\` — semantic search the tenant's memory. Returns the
  top matches with their content. Use when you need to know something the
  user might have told you previously, or when context smells incomplete.
- \`memory.forget(memoryId)\` — remove a memory by id. Use when a fact has
  changed (e.g., the user switched email addresses).

Don't use memory as a scratchpad — comments on the task are the right place
for in-run thinking. Memory is for cross-run continuity.`;

export const createMemoryModule: ModuleFactory = (deps) => {
  const memory = deps.memory as MemoryProvider | undefined;

  const rememberTool: Tool = {
    name: "remember",
    description: "Store a fact for cross-run recall",
    inputs: z.object({
      content: z.string(),
      tags: z.array(z.string()).optional(),
      importance: z.number().optional(),
      entityId: z.string().optional(),
    }),
    async handler(
      input: {
        content: string;
        tags?: string[];
        importance?: number;
        entityId?: string;
      },
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!memory) {
        return {
          ok: false,
          error: { code: "upstream_unavailable", message: "Memory provider not configured", retryable: false },
        };
      }
      const id = await memory.remember(input.content, {
        entityId: input.entityId,
        tags: input.tags,
        importance: input.importance,
      });
      return { ok: true, result: { memoryId: id } };
    },
  };

  const recallTool: Tool = {
    name: "recall",
    description: "Semantic search across tenant memory",
    inputs: z.object({
      query: z.string(),
      limit: z.number().int().positive().optional(),
      entityId: z.string().optional(),
    }),
    async handler(
      input: { query: string; limit?: number; entityId?: string },
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!memory) {
        return {
          ok: false,
          error: { code: "upstream_unavailable", message: "Memory provider not configured", retryable: false },
        };
      }
      const results = await memory.recall(input.query, {
        limit: input.limit,
        entityId: input.entityId,
      });
      return { ok: true, result: { results } };
    },
  };

  const forgetTool: Tool = {
    name: "forget",
    description: "Remove a memory by id",
    inputs: z.object({ memoryId: z.string() }),
    async handler(
      input: { memoryId: string },
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!memory) {
        return {
          ok: false,
          error: { code: "upstream_unavailable", message: "Memory provider not configured", retryable: false },
        };
      }
      await memory.forget(input.memoryId);
      return { ok: true, result: { ok: true } };
    },
  };

  const module: Module = {
    id: "memory",
    name: "Memory",
    version: "0.1.0",
    description: "Cross-run cognitive memory for agents",
    provides: ["memory"],
    skills: [
      {
        id: "memory",
        source: "module",
        body: MEMORY_SKILL,
        priority: 60,
      },
    ],
    tools: [rememberTool, recallTool, forgetTool],
  };

  return module;
};
