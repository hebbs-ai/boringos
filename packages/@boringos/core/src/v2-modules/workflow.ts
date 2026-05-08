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
import { dispatch } from "@boringos/agent";
import type { ToolRegistry } from "@boringos/agent";
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

/**
 * Walks a DAG and invokes tools per block. Phase 7 of task_12.
 *
 * Supported block kinds in this iteration:
 *  - `trigger` — entry point, output = the trigger payload
 *  - `tool` — invokes the tool by full name through the dispatcher;
 *    inputs may reference upstream node outputs via `{{nodeId.field}}`
 *
 * Deferred to a polish pass:
 *  - condition / for_each / delay / transform / branch
 *
 * Returns: an object mapping each visited block id → its output.
 */
async function runWorkflowDag(
  args: {
    db: Db;
    registry: ToolRegistry;
    workflow: { id: string; blocks: unknown[]; edges: unknown[] };
    triggerPayload: Record<string, unknown>;
    ctx: ToolContext;
  },
): Promise<{ outputs: Record<string, unknown>; visited: string[]; failed?: { blockId: string; error: unknown } }> {
  type Block = {
    id: string;
    kind?: string;
    type?: string;
    tool?: string;
    inputs?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
  type Edge = {
    sourceBlockId: string;
    targetBlockId: string;
    sourceHandle?: string;
  };

  const blocks = (args.workflow.blocks as Block[]) ?? [];
  const edges = (args.workflow.edges as Edge[]) ?? [];
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const incoming = new Map<string, Set<string>>();
  for (const b of blocks) incoming.set(b.id, new Set());
  for (const e of edges) {
    incoming.get(e.targetBlockId)?.add(e.sourceBlockId);
  }

  const outputs: Record<string, unknown> = {};
  const visited: string[] = [];

  // Seed: every block with no incoming edges. There may be more
  // than one trigger root in the future; we walk all of them.
  const ready: string[] = [];
  for (const [id, ins] of incoming) if (ins.size === 0) ready.push(id);

  // Compute outgoing edges per block for traversal.
  const outgoing = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!outgoing.has(e.sourceBlockId)) outgoing.set(e.sourceBlockId, []);
    outgoing.get(e.sourceBlockId)!.push(e);
  }
  const remainingIncoming = new Map(
    Array.from(incoming.entries()).map(([id, set]) => [id, new Set(set)]),
  );

  // Blocks pruned by a `condition` block's selectedHandle aren't
  // walked. We track them so we don't fire downstream blocks
  // whose only path was through a pruned branch.
  const pruned = new Set<string>();

  // Per-block selected handle (for condition / branch outputs).
  // Edges from this block whose sourceHandle doesn't match are
  // pruned.
  const selectedHandle = new Map<string, string>();

  while (ready.length > 0) {
    const id = ready.shift()!;
    const block = blockMap.get(id);
    if (!block) continue;
    if (pruned.has(id)) {
      // Skip pruned blocks but propagate pruning downstream so
      // their descendants don't fire spuriously.
      for (const e of outgoing.get(id) ?? []) {
        pruned.add(e.targetBlockId);
        const stillIn = remainingIncoming.get(e.targetBlockId);
        if (!stillIn) continue;
        stillIn.delete(id);
        if (stillIn.size === 0) ready.push(e.targetBlockId);
      }
      continue;
    }
    visited.push(id);

    const kind = block.kind ?? block.type ?? "tool";
    let blockOutput: unknown = {};

    try {
      if (kind === "trigger") {
        blockOutput = args.triggerPayload;
      } else if (kind === "tool") {
        if (!block.tool) {
          throw new Error(`Block ${id}: kind=tool requires a 'tool' field`);
        }
        const resolvedInputs = resolveTemplates(block.inputs ?? {}, outputs);
        const dispatched = await dispatch(
          { registry: args.registry, db: args.db },
          block.tool,
          resolvedInputs,
          { ...args.ctx, invokedBy: "workflow" },
        );
        if (!dispatched.result.ok) {
          return {
            outputs,
            visited,
            failed: { blockId: id, error: dispatched.result.error },
          };
        }
        blockOutput = dispatched.result.result;
      } else if (kind === "condition") {
        // config: { field: "{{nodeId.path}}" | literal, operator,
        //          value }. Operators: equals, not_equals,
        //          truthy, falsy, contains, gt, gte, lt, lte.
        const cfg = (block.config ?? {}) as {
          field?: unknown;
          operator?: string;
          value?: unknown;
        };
        const lhs = resolveTemplates({ x: cfg.field }, outputs).x;
        const op = cfg.operator ?? "truthy";
        const rhs = cfg.value;
        let truth = false;
        switch (op) {
          case "equals":
            truth = lhs === rhs;
            break;
          case "not_equals":
            truth = lhs !== rhs;
            break;
          case "truthy":
            truth = Boolean(lhs);
            break;
          case "falsy":
            truth = !lhs;
            break;
          case "contains":
            truth =
              typeof lhs === "string" && typeof rhs === "string" && lhs.includes(rhs);
            break;
          case "gt":
            truth = typeof lhs === "number" && typeof rhs === "number" && lhs > rhs;
            break;
          case "gte":
            truth = typeof lhs === "number" && typeof rhs === "number" && lhs >= rhs;
            break;
          case "lt":
            truth = typeof lhs === "number" && typeof rhs === "number" && lhs < rhs;
            break;
          case "lte":
            truth = typeof lhs === "number" && typeof rhs === "number" && lhs <= rhs;
            break;
          default:
            throw new Error(`Block ${id}: unknown condition operator ${op}`);
        }
        const handle = truth ? "true" : "false";
        selectedHandle.set(id, handle);
        blockOutput = { result: truth, selectedHandle: handle };
      } else if (kind === "for_each") {
        // config: { items: "{{nodeId.field}}" | array, tool, inputs? }
        // Iterates the items array, dispatching the tool once per item.
        // The current item is exposed via `{{item}}` and `{{index}}`
        // in the inputs templates.
        const cfg = (block.config ?? {}) as {
          items?: unknown;
          tool?: string;
          inputs?: Record<string, unknown>;
        };
        const items = (() => {
          const resolved = resolveTemplates({ x: cfg.items }, outputs).x;
          return Array.isArray(resolved) ? resolved : [];
        })();
        if (!cfg.tool) {
          throw new Error(`Block ${id}: kind=for_each requires config.tool`);
        }
        const itemResults: unknown[] = [];
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          const perItemOutputs = { ...outputs, item, index: i };
          const resolvedInputs = resolveTemplates(cfg.inputs ?? {}, perItemOutputs);
          const dispatched = await dispatch(
            { registry: args.registry, db: args.db },
            cfg.tool,
            resolvedInputs,
            { ...args.ctx, invokedBy: "workflow" },
          );
          if (!dispatched.result.ok) {
            return {
              outputs,
              visited,
              failed: {
                blockId: id,
                error: { iteration: i, item, ...dispatched.result.error },
              },
            };
          }
          itemResults.push(dispatched.result.result);
        }
        blockOutput = { items, count: items.length, results: itemResults };
      } else if (kind === "delay") {
        // config: { ms }
        const cfg = (block.config ?? {}) as { ms?: number };
        const ms = typeof cfg.ms === "number" && cfg.ms >= 0 ? cfg.ms : 0;
        if (ms > 0) {
          await new Promise((r) => setTimeout(r, ms));
        }
        blockOutput = { waited: ms };
      } else if (kind === "transform") {
        // config: { mapping: { outKey: "{{template}}" } }
        const cfg = (block.config ?? {}) as {
          mapping?: Record<string, unknown>;
        };
        blockOutput = resolveTemplates(cfg.mapping ?? {}, outputs);
      } else if (kind === "branch") {
        // Like condition but doesn't compute truth — the upstream
        // node sets selectedHandle, this just acts as a router.
        // For now, treat identically to a passthrough.
        blockOutput = args.triggerPayload;
      } else {
        // Unknown kinds — skip, mark for visibility, downstream
        // continues unblocked.
        blockOutput = { skipped: true, reason: `unknown kind ${kind}` };
      }
    } catch (e) {
      return {
        outputs,
        visited,
        failed: {
          blockId: id,
          error: { code: "internal", message: e instanceof Error ? e.message : String(e), retryable: false },
        },
      };
    }

    outputs[id] = blockOutput;

    // Mark this block as resolved for downstream nodes.
    // For condition blocks: prune outgoing edges whose
    // sourceHandle doesn't match the selected one.
    const sel = selectedHandle.get(id);
    for (const e of outgoing.get(id) ?? []) {
      if (sel && e.sourceHandle && e.sourceHandle !== sel) {
        pruned.add(e.targetBlockId);
      }
      const stillIn = remainingIncoming.get(e.targetBlockId);
      if (!stillIn) continue;
      stillIn.delete(id);
      if (stillIn.size === 0) ready.push(e.targetBlockId);
    }
  }

  return { outputs, visited };
}

/**
 * Resolve `{{nodeId.field}}` templates in the input object.
 *
 * Two cases:
 *   - **Whole-string template** (`"{{nodeId.field}}"` is the
 *     entire value): the resolved value is returned as-is,
 *     preserving its type (number, object, array, etc.). This
 *     lets you pass an upstream array directly into a downstream
 *     `items` field.
 *   - **Interpolation** (`"prefix {{a.b}} suffix"` mixed with
 *     literal text): each `{{...}}` match is replaced with the
 *     resolved value coerced to string. Useful for templated
 *     titles / descriptions / messages.
 *
 * Walks objects and arrays recursively. Path segments support
 * letters, digits, underscore, dash, and dot. Numeric path
 * segments index into arrays (`fetch.messages.0.subject`).
 *
 * Unresolved paths leave the placeholder untouched so the
 * downstream tool sees the failure (instead of silently passing
 * `undefined`).
 */
function resolveTemplates(
  inputs: unknown,
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  const PLACEHOLDER = /\{\{([a-zA-Z0-9_.-]+)\}\}/g;

  const lookup = (path: string): { found: boolean; value: unknown } => {
    const segs = path.split(".");
    let cursor: unknown = outputs;
    for (const seg of segs) {
      if (cursor === null || cursor === undefined) return { found: false, value: undefined };
      if (Array.isArray(cursor)) {
        const idx = Number(seg);
        if (!Number.isInteger(idx)) return { found: false, value: undefined };
        cursor = cursor[idx];
      } else if (typeof cursor === "object") {
        cursor = (cursor as Record<string, unknown>)[seg];
      } else {
        return { found: false, value: undefined };
      }
    }
    return { found: true, value: cursor };
  };

  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      // Whole-string template: preserve resolved type.
      const wholeMatch = /^\{\{([a-zA-Z0-9_.-]+)\}\}$/.exec(value);
      if (wholeMatch) {
        const r = lookup(wholeMatch[1]);
        return r.found ? r.value : value;
      }
      // Interpolation: stringify each placeholder.
      if (PLACEHOLDER.test(value)) {
        return value.replace(PLACEHOLDER, (raw, path: string) => {
          const r = lookup(path);
          if (!r.found) return raw;
          if (r.value === null || r.value === undefined) return "";
          if (typeof r.value === "string") return r.value;
          if (typeof r.value === "number" || typeof r.value === "boolean")
            return String(r.value);
          try {
            return JSON.stringify(r.value);
          } catch {
            return String(r.value);
          }
        });
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = visit(v);
      }
      return out;
    }
    return value;
  };
  const result = visit(inputs);
  return (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
}

export const createWorkflowModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;
  const toolRegistry = deps.toolRegistry as ToolRegistry | undefined;

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

  const runTool: Tool = {
    name: "run",
    description:
      "Execute a saved workflow. Walks the DAG, dispatches tools per block, returns per-block outputs.",
    inputs: z.object({
      workflowId: z.string().uuid(),
      triggerPayload: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: { workflowId: string; triggerPayload?: Record<string, unknown> },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!toolRegistry) {
        return {
          ok: false,
          error: {
            code: "internal",
            message:
              "workflow.run requires the v2 toolRegistry to be available in module factory deps. " +
              "Confirm the host's BoringOS init wires `toolRegistry` into ModuleFactoryDeps.",
            retryable: false,
          },
        };
      }
      const wfRows = await db
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.workflowId))
        .limit(1);
      const workflow = wfRows[0];
      if (!workflow || workflow.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: { code: "not_found", message: "Workflow not found", retryable: false },
        };
      }

      // Open a workflow_runs row up-front so observability tools
      // see the run as soon as it starts.
      const runStartedAt = new Date();
      const inserted = await db
        .insert(workflowRuns)
        .values({
          tenantId: ctx.tenantId,
          workflowId: workflow.id,
          triggerType: "manual",
          triggerPayload: input.triggerPayload ?? {},
          status: "running",
          startedAt: runStartedAt,
        })
        .returning({ id: workflowRuns.id });
      const runId = inserted[0]?.id;

      const result = await runWorkflowDag({
        db,
        registry: toolRegistry,
        workflow: {
          id: workflow.id,
          blocks: workflow.blocks ?? [],
          edges: workflow.edges ?? [],
        },
        triggerPayload: input.triggerPayload ?? {},
        ctx,
      });

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - runStartedAt.getTime();

      if (result.failed) {
        if (runId) {
          await db
            .update(workflowRuns)
            .set({
              status: "failed",
              error: JSON.stringify(result.failed.error),
              finishedAt,
              durationMs,
            })
            .where(eq(workflowRuns.id, runId));
        }
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: `Workflow block ${result.failed.blockId} failed`,
            retryable: false,
            details: { blockId: result.failed.blockId, error: result.failed.error, outputs: result.outputs },
          },
        };
      }

      if (runId) {
        await db
          .update(workflowRuns)
          .set({ status: "completed", finishedAt, durationMs })
          .where(eq(workflowRuns.id, runId));
      }

      return {
        ok: true,
        result: { runId, outputs: result.outputs, visited: result.visited },
      };
    },
  };

  const module: Module = {
    id: "workflow",
    name: "Workflows",
    version: "0.1.0",
    description: "Saved DAGs of tool calls — list, inspect, run, get_run",
    provides: ["workflow-runtime"],
    skills: [
      {
        id: "workflow",
        source: "module",
        body: WORKFLOW_SKILL,
        priority: 70,
      },
    ],
    tools: [listTool, getTool, getRunTool, runTool],
  };

  return module;
};
