// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `workflow` Module — exposes workflow operations as tools so
// agents (and other tools) can list, run, and inspect workflows
// from the unified `/api/tools/*` surface.
//
// Phase 5 of task_12. The actual DAG execution stays in the
// existing WorkflowEngine; these tools are thin wrappers.

import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { workflows, workflowRuns, workflowBlockRuns } from "@boringos/db";
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
import type { RealtimeBus } from "../realtime.js";

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
 * Supported block kinds:
 *  - `trigger` — entry point, output = the trigger payload
 *  - `tool` / `agent` — dispatch a tool by full name (agent defaults to
 *    framework.agents.wake); inputs reference upstream outputs via
 *    `{{nodeId.field}}`
 *  - `condition` — branches the run on a comparison (see evaluateCondition)
 *  - `for_each` — iterate an array, dispatch a tool per item
 *  - `delay` — wait N ms · `transform` — reshape outputs · `sticky` — note
 *  - `branch` — passthrough router (downstream pruned by upstream handle)
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
    /** When provided, per-block runs are persisted + SSE events are emitted. */
    runId?: string;
    realtimeBus?: RealtimeBus | null;
    /**
     * Pre-seeded outputs (e.g. from a fork: upstream blocks copied
     * forward from the source run). Blocks with ids in this map
     * skip dispatch and reuse the cached output.
     */
    seedOutputs?: Record<string, unknown>;
    /**
     * If set, blocks are skipped until we reach `startAtBlockId`.
     * Used by fork-from-here. The seedOutputs feed downstream
     * templates so their resolved configs match the original run.
     */
    startAtBlockId?: string;
    /** When forking from a block, the inputs override for that block. */
    startAtInputsOverride?: Record<string, unknown>;
  },
): Promise<{ outputs: Record<string, unknown>; visited: string[]; failed?: { blockId: string; error: unknown } }> {
  type Block = {
    id: string;
    name?: string;
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

  const outputs: Record<string, unknown> = { ...(args.seedOutputs ?? {}) };
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

  // ── per-block trace + event helpers ────────────────────────────────────
  const realtimeBus = args.realtimeBus ?? null;
  const persistBlockRuns = !!args.runId;

  const emitEvent = (type: string, data: Record<string, unknown>) => {
    if (!realtimeBus) return;
    realtimeBus.publish({
      type,
      tenantId: args.ctx.tenantId,
      data: { runId: args.runId, ...data },
      timestamp: new Date().toISOString(),
    });
  };

  const recordBlockStart = async (
    block: Block,
    inputContext: Record<string, unknown>,
    resolvedConfig: Record<string, unknown>,
  ): Promise<string | null> => {
    if (!persistBlockRuns) return null;
    const startedAt = new Date();
    const inserted = await args.db
      .insert(workflowBlockRuns)
      .values({
        workflowRunId: args.runId!,
        tenantId: args.ctx.tenantId,
        blockId: block.id,
        blockName: block.name ?? block.id,
        blockType: block.kind ?? block.type ?? "tool",
        status: "running",
        resolvedConfig,
        inputContext,
        startedAt,
      })
      .returning({ id: workflowBlockRuns.id });
    return inserted[0]?.id ?? null;
  };

  const recordBlockEnd = async (
    blockRunId: string | null,
    block: Block,
    status: "completed" | "failed" | "skipped" | "waiting",
    output: unknown,
    error: unknown,
    startedAtMs: number,
    selectedHandleVal?: string,
  ): Promise<void> => {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAtMs;
    if (persistBlockRuns && blockRunId) {
      await args.db
        .update(workflowBlockRuns)
        .set({
          status,
          output: (output ?? null) as Record<string, unknown> | null,
          error: error ? (typeof error === "string" ? error : JSON.stringify(error)) : null,
          selectedHandle: selectedHandleVal ?? null,
          finishedAt,
          durationMs,
        })
        .where(eq(workflowBlockRuns.id, blockRunId));
    }
    const eventType =
      status === "completed"
        ? "workflow:block_completed"
        : status === "failed"
          ? "workflow:block_failed"
          : status === "waiting"
            ? "workflow:block_waiting"
            : "workflow:block_skipped";
    emitEvent(eventType, {
      blockId: block.id,
      blockType: block.kind ?? block.type ?? "tool",
      durationMs,
      status,
      error: error ?? undefined,
    });
  };

  // Reached the start-at-block flag, used by fork mode to skip
  // walking blocks that should reuse their seedOutputs as-is.
  let reachedStart = !args.startAtBlockId;

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

    // Fork-from-here gate: until we reach the start-at block,
    // every block with a seeded output skips dispatch and uses the
    // seed; blocks without a seed still dispatch normally so we
    // can fork from a side branch.
    if (!reachedStart && id === args.startAtBlockId) {
      reachedStart = true;
    }

    const kind = block.kind ?? block.type ?? "tool";
    let blockOutput: unknown = {};
    let blockHandled = false;

    // Check pinned-output / seeded-output short-circuits.
    const pinnedCfg = (block.config as { pinned?: boolean; pinnedOutput?: unknown } | undefined) ?? {};
    const seededOutput =
      Object.prototype.hasOwnProperty.call(args.seedOutputs ?? {}, id) ? (args.seedOutputs as Record<string, unknown>)[id] : undefined;
    const isPinned = pinnedCfg.pinned === true && pinnedCfg.pinnedOutput !== undefined;
    const useShortCircuit = seededOutput !== undefined || isPinned;

    const startedAtMs = Date.now();

    if (useShortCircuit) {
      blockOutput = seededOutput !== undefined ? seededOutput : pinnedCfg.pinnedOutput;
      blockHandled = true;
      emitEvent("workflow:block_started", {
        blockId: id,
        blockType: kind,
        cached: true,
      });
      const blockRunId = persistBlockRuns
        ? await recordBlockStart(block, {}, { cachedOutputUsed: true })
        : null;
      await recordBlockEnd(blockRunId, block, "skipped", blockOutput, null, startedAtMs);
    }

    let blockRunId: string | null = null;
    let inputSnapshot: Record<string, unknown> = {};
    let resolvedConfigSnap: Record<string, unknown> = {};

    try {
      if (blockHandled) {
        // already short-circuited
      } else if (kind === "trigger") {
        inputSnapshot = { trigger: args.triggerPayload };
        resolvedConfigSnap = {};
        blockRunId = await recordBlockStart(block, inputSnapshot, resolvedConfigSnap);
        emitEvent("workflow:block_started", { blockId: id, blockType: kind });
        blockOutput = args.triggerPayload;
      } else if (kind === "tool") {
        if (!block.tool) {
          throw new Error(`Block ${id}: kind=tool requires a 'tool' field`);
        }
        const inputsToUse =
          args.startAtInputsOverride && id === args.startAtBlockId
            ? args.startAtInputsOverride
            : block.inputs ?? {};
        const resolvedInputs = resolveTemplates(inputsToUse, outputs);
        inputSnapshot = { ...outputs };
        resolvedConfigSnap = { tool: block.tool, inputs: resolvedInputs };
        blockRunId = await recordBlockStart(block, inputSnapshot, resolvedConfigSnap);
        emitEvent("workflow:block_started", { blockId: id, blockType: kind, tool: block.tool });
        const dispatched = await dispatch(
          { registry: args.registry, db: args.db },
          block.tool,
          resolvedInputs,
          { ...args.ctx, invokedBy: "workflow" },
        );
        if (!dispatched.result.ok) {
          await recordBlockEnd(blockRunId, block, "failed", null, dispatched.result.error, startedAtMs);
          return {
            outputs,
            visited,
            failed: { blockId: id, error: dispatched.result.error },
          };
        }
        blockOutput = dispatched.result.result;
      } else if (kind === "condition") {
        // config: { field: "{{nodeId.path}}" | literal, operator, value }.
        // Both field (LHS) and value (RHS) are template-resolved, so a
        // condition can compare two upstream values. Operators: equals,
        // not_equals, truthy, falsy, contains, gt, gte, lt, lte, in.
        // Comparison is type-tolerant (see evaluateCondition) so the
        // editor's friendly inputs work even when a value arrives as a
        // string — e.g. "5" > 3, or "noise, fyi" for `in`.
        const cfg = (block.config ?? {}) as {
          field?: unknown;
          operator?: string;
          value?: unknown;
        };
        inputSnapshot = { ...outputs };
        resolvedConfigSnap = { ...cfg };
        blockRunId = await recordBlockStart(block, inputSnapshot, resolvedConfigSnap);
        emitEvent("workflow:block_started", { blockId: id, blockType: kind });
        const lhs = resolveTemplates({ x: cfg.field }, outputs).x;
        const rhs = resolveTemplates({ x: cfg.value }, outputs).x;
        const truth = evaluateCondition(cfg.operator ?? "truthy", lhs, rhs);
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
        inputSnapshot = { ...outputs };
        resolvedConfigSnap = { tool: cfg.tool, items, count: items.length };
        blockRunId = await recordBlockStart(block, inputSnapshot, resolvedConfigSnap);
        emitEvent("workflow:block_started", { blockId: id, blockType: kind, count: items.length });
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
            await recordBlockEnd(
              blockRunId,
              block,
              "failed",
              { results: itemResults, failedAt: i },
              { iteration: i, item, ...dispatched.result.error },
              startedAtMs,
            );
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
        inputSnapshot = { ...outputs };
        resolvedConfigSnap = { ms };
        blockRunId = await recordBlockStart(block, inputSnapshot, resolvedConfigSnap);
        emitEvent("workflow:block_started", { blockId: id, blockType: kind, ms });
        if (ms > 0) {
          await new Promise((r) => setTimeout(r, ms));
        }
        blockOutput = { waited: ms };
      } else if (kind === "transform") {
        // config: { mapping: { outKey: "{{template}}" } }
        const cfg = (block.config ?? {}) as {
          mapping?: Record<string, unknown>;
        };
        inputSnapshot = { ...outputs };
        resolvedConfigSnap = { mapping: cfg.mapping ?? {} };
        blockRunId = await recordBlockStart(block, inputSnapshot, resolvedConfigSnap);
        emitEvent("workflow:block_started", { blockId: id, blockType: kind });
        blockOutput = resolveTemplates(cfg.mapping ?? {}, outputs);
      } else if (kind === "agent") {
        // Wake an agent on a task. Same dispatch path as a tool block,
        // defaulting to framework.agents.wake when no tool is set.
        const toolName = block.tool ?? "framework.agents.wake";
        const inputsToUse =
          args.startAtInputsOverride && id === args.startAtBlockId
            ? args.startAtInputsOverride
            : block.inputs ?? {};
        const resolvedInputs = resolveTemplates(inputsToUse, outputs);
        inputSnapshot = { ...outputs };
        resolvedConfigSnap = { tool: toolName, inputs: resolvedInputs };
        blockRunId = await recordBlockStart(block, inputSnapshot, resolvedConfigSnap);
        emitEvent("workflow:block_started", { blockId: id, blockType: kind, tool: toolName });
        const dispatched = await dispatch(
          { registry: args.registry, db: args.db },
          toolName,
          resolvedInputs,
          { ...args.ctx, invokedBy: "workflow" },
        );
        if (!dispatched.result.ok) {
          await recordBlockEnd(blockRunId, block, "failed", null, dispatched.result.error, startedAtMs);
          return {
            outputs,
            visited,
            failed: { blockId: id, error: dispatched.result.error },
          };
        }
        blockOutput = dispatched.result.result;
      } else if (kind === "branch") {
        // Like condition but doesn't compute truth — the upstream
        // node sets selectedHandle, this just acts as a router.
        // For now, treat identically to a passthrough.
        inputSnapshot = { ...outputs };
        blockRunId = await recordBlockStart(block, inputSnapshot, {});
        emitEvent("workflow:block_started", { blockId: id, blockType: kind });
        blockOutput = args.triggerPayload;
      } else if (kind === "sticky") {
        // Sticky notes never execute — record as skipped, no output.
        inputSnapshot = {};
        blockRunId = await recordBlockStart(block, inputSnapshot, {});
        emitEvent("workflow:block_started", { blockId: id, blockType: kind });
        blockOutput = null;
        await recordBlockEnd(blockRunId, block, "skipped", null, null, startedAtMs);
        blockHandled = true;
      } else {
        // Unknown kinds — skip, mark for visibility, downstream
        // continues unblocked.
        inputSnapshot = {};
        blockRunId = await recordBlockStart(block, inputSnapshot, { reason: `unknown kind ${kind}` });
        emitEvent("workflow:block_started", { blockId: id, blockType: kind });
        blockOutput = { skipped: true, reason: `unknown kind ${kind}` };
        await recordBlockEnd(blockRunId, block, "skipped", blockOutput, null, startedAtMs);
        blockHandled = true;
      }
    } catch (e) {
      const err = { code: "internal", message: e instanceof Error ? e.message : String(e), retryable: false };
      await recordBlockEnd(blockRunId, block, "failed", null, err, startedAtMs);
      return {
        outputs,
        visited,
        failed: { blockId: id, error: err },
      };
    }

    if (!blockHandled) {
      const sel = selectedHandle.get(id);
      await recordBlockEnd(blockRunId, block, "completed", blockOutput, null, startedAtMs, sel);
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

  // Synthetic time vars — `{{now}}` (ISO timestamp) and `{{today}}`
  // (YYYY-MM-DD) — available in any workflow node's inputs/templates
  // without the workflow author having to wire a node for them.
  // Time-conditional workflows ("if today is Monday" / "schedule for
  // 2 hours from now") get this for free.
  const nowDate = new Date();
  const synth: Record<string, unknown> = {
    now: nowDate.toISOString(),
    today: nowDate.toISOString().slice(0, 10),
  };

  const lookup = (path: string): { found: boolean; value: unknown } => {
    const segs = path.split(".");
    // Top-level synthetic var? Resolve from `synth` first; node
    // outputs win over synthetics if a node happens to be named
    // "now" / "today" (unlikely but explicit).
    if (segs.length === 1 && !(segs[0]! in outputs) && segs[0]! in synth) {
      return { found: true, value: synth[segs[0]!] };
    }
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

/**
 * Evaluate a `condition` block's operator against resolved LHS/RHS.
 *
 * Comparison is intentionally type-tolerant: the visual editor lets
 * non-technical authors type plain values, so a numeric comparison
 * must still work when the value arrives as the string "5", and `in`
 * must accept a comma-separated string ("noise, fyi") as well as a
 * real array. Exported for unit testing.
 */
export function evaluateCondition(op: string, lhs: unknown, rhs: unknown): boolean {
  const asNum = (v: unknown): number =>
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v)
        : NaN;
  const numericPair = (a: unknown, b: unknown): [number, number] | null => {
    const na = asNum(a);
    const nb = asNum(b);
    return Number.isFinite(na) && Number.isFinite(nb) ? [na, nb] : null;
  };
  // Numeric comparison when both sides look numeric, else string eq.
  const looseEq = (a: unknown, b: unknown): boolean => {
    const pair = numericPair(a, b);
    return pair ? pair[0] === pair[1] : String(a ?? "") === String(b ?? "");
  };
  // RHS for `in`: a real array passes through; a string is split on
  // commas so "noise, fyi" works from a plain text field.
  const toList = (v: unknown): unknown[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string")
      return v.split(",").map((s) => s.trim()).filter((s) => s !== "");
    return v == null ? [] : [v];
  };
  switch (op) {
    case "equals":
      return looseEq(lhs, rhs);
    case "not_equals":
      return !looseEq(lhs, rhs);
    case "truthy":
      return Boolean(lhs);
    case "falsy":
      return !lhs;
    case "contains":
      return String(lhs ?? "").includes(String(rhs ?? ""));
    case "gt": {
      const pair = numericPair(lhs, rhs);
      return pair ? pair[0] > pair[1] : false;
    }
    case "gte": {
      const pair = numericPair(lhs, rhs);
      return pair ? pair[0] >= pair[1] : false;
    }
    case "lt": {
      const pair = numericPair(lhs, rhs);
      return pair ? pair[0] < pair[1] : false;
    }
    case "lte": {
      const pair = numericPair(lhs, rhs);
      return pair ? pair[0] <= pair[1] : false;
    }
    case "in":
      return toList(rhs).some((item) => looseEq(lhs, item));
    default:
      throw new Error(`Unknown condition operator: ${op}`);
  }
}

export const createWorkflowModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;
  const toolRegistry = deps.toolRegistry as ToolRegistry | undefined;
  // Read realtimeBus lazily — populated by the host after the
  // module factory runs.
  const getRealtimeBus = () => (deps.realtimeBus as RealtimeBus | null | undefined) ?? null;

  const emit = (type: string, tenantId: string, data: Record<string, unknown>) => {
    const bus = getRealtimeBus();
    if (!bus) return;
    bus.publish({ type, tenantId, data, timestamp: new Date().toISOString() });
  };

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
              "workflow.run requires the toolRegistry to be available in module factory deps. " +
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

      emit("workflow:run_started", ctx.tenantId, {
        runId,
        workflowId: workflow.id,
      });

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
        runId,
        realtimeBus: getRealtimeBus(),
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
        emit("workflow:run_failed", ctx.tenantId, {
          runId,
          workflowId: workflow.id,
          failedBlockId: result.failed.blockId,
          durationMs,
        });
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
      emit("workflow:run_completed", ctx.tenantId, {
        runId,
        workflowId: workflow.id,
        durationMs,
      });

      return {
        ok: true,
        result: { runId, outputs: result.outputs, visited: result.visited },
      };
    },
  };

  // ── workflow.fork_run — time-travel replay ─────────────────────────────
  // Fork a past run from a specific block with edited inputs. Upstream
  // block outputs are copied forward from the source run; downstream
  // blocks (including the fork point) re-execute against the fresh
  // outputs map. Powers the "Replay from this step" UX.
  const forkRunTool: Tool = {
    name: "fork_run",
    description:
      "Fork a past workflow run from a specific block, optionally overriding that block's inputs. Reuses upstream outputs from the source run.",
    inputs: z.object({
      runId: z.string().uuid(),
      fromBlockId: z.string(),
      editedInputs: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: { runId: string; fromBlockId: string; editedInputs?: Record<string, unknown> },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!toolRegistry) {
        return {
          ok: false,
          error: { code: "internal", message: "workflow.fork_run requires toolRegistry", retryable: false },
        };
      }
      // Load source run + its workflow definition (current).
      const srcRows = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, input.runId))
        .limit(1);
      const srcRun = srcRows[0];
      if (!srcRun || srcRun.tenantId !== ctx.tenantId) {
        return { ok: false, error: { code: "not_found", message: "Source run not found", retryable: false } };
      }
      const wfRows = await db
        .select()
        .from(workflows)
        .where(eq(workflows.id, srcRun.workflowId))
        .limit(1);
      const wf = wfRows[0];
      if (!wf || wf.tenantId !== ctx.tenantId) {
        return { ok: false, error: { code: "not_found", message: "Workflow not found", retryable: false } };
      }
      // Pull upstream block outputs from source run's block_runs.
      const blockRows = await db
        .select()
        .from(workflowBlockRuns)
        .where(eq(workflowBlockRuns.workflowRunId, srcRun.id));
      const seedOutputs: Record<string, unknown> = {};
      for (const br of blockRows) {
        if (br.blockId === input.fromBlockId) continue;
        if (br.status === "completed" && br.output != null) {
          seedOutputs[br.blockId] = br.output;
        }
      }

      const runStartedAt = new Date();
      const inserted = await db
        .insert(workflowRuns)
        .values({
          tenantId: ctx.tenantId,
          workflowId: wf.id,
          triggerType: "fork",
          triggerPayload: { forkedFromRunId: srcRun.id, fromBlockId: input.fromBlockId },
          status: "running",
          startedAt: runStartedAt,
        })
        .returning({ id: workflowRuns.id });
      const runId = inserted[0]?.id;
      emit("workflow:run_started", ctx.tenantId, {
        runId,
        workflowId: wf.id,
        forkedFromRunId: srcRun.id,
      });

      const result = await runWorkflowDag({
        db,
        registry: toolRegistry,
        workflow: {
          id: wf.id,
          blocks: wf.blocks ?? [],
          edges: wf.edges ?? [],
        },
        triggerPayload: (srcRun.triggerPayload as Record<string, unknown> | null) ?? {},
        ctx,
        runId,
        realtimeBus: getRealtimeBus(),
        seedOutputs,
        startAtBlockId: input.fromBlockId,
        startAtInputsOverride: input.editedInputs,
      });

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - runStartedAt.getTime();

      if (result.failed) {
        if (runId) {
          await db
            .update(workflowRuns)
            .set({ status: "failed", error: JSON.stringify(result.failed.error), finishedAt, durationMs })
            .where(eq(workflowRuns.id, runId));
        }
        emit("workflow:run_failed", ctx.tenantId, { runId, workflowId: wf.id, durationMs });
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: `Forked workflow block ${result.failed.blockId} failed`,
            retryable: false,
            details: { runId, blockId: result.failed.blockId, error: result.failed.error },
          },
        };
      }

      if (runId) {
        await db
          .update(workflowRuns)
          .set({ status: "completed", finishedAt, durationMs })
          .where(eq(workflowRuns.id, runId));
      }
      emit("workflow:run_completed", ctx.tenantId, { runId, workflowId: wf.id, durationMs });
      return { ok: true, result: { runId, forkedFromRunId: srcRun.id, outputs: result.outputs } };
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
    tools: [listTool, getTool, getRunTool, runTool, forkRunTool],
  };

  return module;
};
