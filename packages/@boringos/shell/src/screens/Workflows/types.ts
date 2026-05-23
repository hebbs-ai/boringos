// SPDX-License-Identifier: AGPL-3.0-or-later
//
// workflow schema as the shell understands it. Mirrors the
// shape persisted in `workflows.{blocks,edges}` and consumed by
// `workflow.run` in @boringos/core/modules/workflow.ts.

export type BlockKind =
  | "trigger"
  | "tool"
  | "condition"
  | "for_each"
  | "delay"
  | "transform"
  | "branch"
  | "sticky"
  | "agent";

export interface Block {
  id: string;
  kind?: BlockKind | string;
  /** Legacy  rows still in DB use `type` instead of `kind`. */
  type?: string;
  /** For `kind: "tool"` — fully qualified `<module>.<tool>` name. */
  tool?: string;
  inputs?: Record<string, unknown>;
  config?: Record<string, unknown>;
  /** Optional friendly label rendered on the node. */
  name?: string;
  /** Cached canvas position (x, y) for layout persistence. */
  position?: { x: number; y: number };
}

export interface Edge {
  /** Optional client-side id; backend doesn't require it but we use it for React keys. */
  id?: string;
  sourceBlockId: string;
  targetBlockId: string;
  /** For condition: "true" | "false". */
  sourceHandle?: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description?: string | null;
  type?: string;
  status?: string;
  blocks?: Block[];
  edges?: Edge[];
  governingAgentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Trimmed JSON Schema (draft-7 subset) as emitted by GET /api/admin/tools
 * for a tool's inputs. Refs are inlined server-side, so the renderer
 * only ever sees `properties` / `items` / `enum` — never `$ref`.
 */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  /** Present on `z.union`-style schemas; the form falls back to JSON for these. */
  anyOf?: JsonSchema[];
  [key: string]: unknown;
}

export interface ToolRow {
  fullName: string;
  moduleId: string;
  description: string;
  idempotency?: string;
  costHint?: string;
  /** Tool inputs as JSON Schema; drives the per-field form. null when not derivable. */
  inputSchema?: JsonSchema | null;
}

export interface ModuleRow {
  id: string;
  name: string;
  description: string;
  tools: { name: string; description: string }[];
}

export interface AgentRow {
  id: string;
  name: string;
  role?: string;
  status?: string;
}

/** A workflow-triggerable event a module declares it emits. */
export interface EventTypeRow {
  type: string;
  description: string;
  moduleId?: string;
}

/**
 * Per-block runtime status during/after a run. Used by Canvas in run
 * mode to overlay status dots on nodes. Mirrors `workflow_block_runs`.
 */
export type BlockRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped"
  | "failed"
  | "waiting";

export interface BlockRun {
  blockId: string;
  status: BlockRunStatus;
  durationMs?: number | null;
  error?: string | null;
  output?: Record<string, unknown> | null;
  resolvedConfig?: Record<string, unknown> | null;
  inputContext?: Record<string, unknown> | null;
}
