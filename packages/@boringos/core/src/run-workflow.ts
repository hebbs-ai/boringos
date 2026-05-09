// SPDX-License-Identifier: MIT
//
// Tiny shim that runs a saved workflow through the v2 dispatcher's
// `workflow.run` tool. Replaces every call site that used to invoke
// `workflowEngine.execute(...)`. Lives in core because the scheduler,
// admin routes, and event-dispatcher all need it.

import type { Db } from "@boringos/db";
import type { ToolRegistry } from "@boringos/agent";
import { dispatch } from "@boringos/agent";

export interface RunWorkflowDeps {
  db: Db;
  toolRegistry: ToolRegistry;
}

export interface RunWorkflowOptions {
  workflowId: string;
  tenantId: string;
  agentId?: string;
  /** Trigger payload — exposed to the DAG as `{{trig.*}}`. */
  payload?: Record<string, unknown>;
  /** Source of the dispatch — feeds tool_calls.invoked_by. */
  invokedBy?: "routine" | "workflow" | "admin" | "internal" | "agent";
}

export interface RunWorkflowResult {
  ok: boolean;
  runId?: string;
  outputs?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export async function runWorkflow(
  deps: RunWorkflowDeps,
  opts: RunWorkflowOptions,
): Promise<RunWorkflowResult> {
  const dispatched = await dispatch(
    { registry: deps.toolRegistry, db: deps.db },
    "workflow.run",
    { workflowId: opts.workflowId, triggerPayload: opts.payload ?? {} },
    {
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      invokedBy: opts.invokedBy ?? "internal",
    },
  );
  if (dispatched.result.ok) {
    const r = dispatched.result.result as { runId?: string; outputs?: Record<string, unknown> };
    return { ok: true, runId: r.runId, outputs: r.outputs };
  }
  return { ok: false, error: dispatched.result.error };
}
