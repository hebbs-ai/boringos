// SPDX-License-Identifier: MIT
//
// `workflow` Module — exposes workflow operations as tools so
// agents (and other tools) can list, run, and inspect workflows
// from the unified `/api/tools/*` surface.
//
// Phase 5 of task_12. The actual DAG execution stays in the
// existing WorkflowEngine; these tools are thin wrappers.

import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { workflows, workflowRuns } from "@boringos/db";
import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";

const WORKFLOW_SKILL = `Workflows are saved DAGs of tool calls. Use these
when you need to:

- Compose tool calls into a reusable pipeline (\`workflow.run\`)
- Look up what's already been built (\`workflow.list\`, \`workflow.get\`)
- Inspect a specific run's per-block outputs (\`workflow.get_run\`)

The visual editor in the shell is the primary author surface; from an agent
you can trigger an existing workflow but you generally shouldn't be
authoring new ones programmatically — that's a human-curation task.`;

export const createWorkflowModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;

  const listTool: Tool = {
    name: "list",
    description: "List workflows for the current tenant",
    inputs: z.object({}),
    async handler(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
      const rows = await db
        .select()
        .from(workflows)
        .where(eq(workflows.tenantId, ctx.tenantId));
      return { ok: true, result: { workflows: rows } };
    },
  };

  const getTool: Tool = {
    name: "get",
    description: "Read a workflow definition by id",
    inputs: z.object({ workflowId: z.string().uuid() }),
    async handler(
      input: { workflowId: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.workflowId))
        .limit(1);
      const wf = rows[0];
      if (!wf || wf.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "not_found", message: "Workflow not found", retryable: false },
        };
      }
      return { ok: true, result: { workflow: wf } };
    },
  };

  const getRunTool: Tool = {
    name: "get_run",
    description: "Read a specific workflow run with its per-block outputs",
    inputs: z.object({ runId: z.string().uuid() }),
    async handler(
      input: { runId: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, input.runId))
        .limit(1);
      const run = rows[0];
      if (!run || run.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "not_found", message: "Workflow run not found", retryable: false },
        };
      }
      return { ok: true, result: { run } };
    },
  };

  const module: Module = {
    id: "workflow",
    name: "Workflows",
    version: "0.1.0",
    description: "Saved DAGs of tool calls — list, inspect, and trigger",
    provides: ["workflow-runtime"],
    skills: [
      {
        id: "workflow",
        source: "module",
        body: WORKFLOW_SKILL,
        priority: 70,
      },
    ],
    tools: [listTool, getTool, getRunTool],
  };

  return module;
};
