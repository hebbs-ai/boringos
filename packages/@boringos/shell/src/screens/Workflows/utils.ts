// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Block, BlockKind, Edge } from "./types.js";

export function authHeaders(token: string | null, tenantId: string | undefined): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

export function blockKind(b: Block): BlockKind {
  return (b.kind ?? b.type ?? "tool") as BlockKind;
}

const OPERATOR_WORDS: Record<string, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  in: "is one of",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  truthy: "is set",
  falsy: "is empty",
};

/** "label" from "{{trigger.label}}" — the human-readable tail of a path. */
function lastSegment(field?: string): string | undefined {
  if (!field || typeof field !== "string") return undefined;
  const m = /^\{\{([a-zA-Z0-9_.-]+)\}\}$/.exec(field.trim());
  const path = m ? m[1]! : field.trim();
  return path.split(".").pop() || undefined;
}

export function blockLabel(b: Block, eventLabels?: Record<string, string>): string {
  const k = blockKind(b);
  // A name that's just the kind word (e.g. a seeded "trigger") is
  // treated as auto — fall through to the friendly computed label.
  if (b.name && b.name !== k) return b.name;
  if (k === "tool" && b.tool) return b.tool.split(".").slice(-1)[0] ?? b.tool;
  if (k === "agent") return "Wake an agent";
  if (k === "trigger") {
    const ev = (b.config as { eventType?: string } | undefined)?.eventType;
    if (!ev) return "When this happens";
    const desc = eventLabels?.[ev];
    return desc ? `When ${desc.charAt(0).toLowerCase()}${desc.slice(1)}` : `When ${ev}`;
  }
  if (k === "condition") {
    const c = b.config as { field?: string; operator?: string; value?: unknown } | undefined;
    const field = lastSegment(c?.field);
    const op = c?.operator ?? "truthy";
    const word = OPERATOR_WORDS[op] ?? op;
    if (field) {
      const showVal = op !== "truthy" && op !== "falsy" && c?.value != null && c?.value !== "";
      return `If ${field} ${word}${showVal ? ` ${String(c?.value)}` : ""}`.trim();
    }
    return "Check a value";
  }
  if (k === "for_each") return "For each item";
  if (k === "delay") {
    const ms = (b.config as { ms?: number } | undefined)?.ms ?? 0;
    return ms ? `Wait ${formatMs(ms)}` : "Wait";
  }
  if (k === "transform") return "Build a value";
  if (k === "branch") return "Branch";
  if (k === "sticky") return "Note";
  return k;
}

export function blockSubLabel(b: Block): string | null {
  const k = blockKind(b);
  if (k === "tool" && b.tool) {
    const parts = b.tool.split(".");
    return parts.slice(0, -1).join(".") || b.tool;
  }
  if (k === "for_each") {
    const c = b.config as { tool?: string; items?: string } | undefined;
    return c?.tool ?? null;
  }
  return null;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

/** Stable id generator — used when adding new blocks. */
export function newBlockId(kind: BlockKind, existing: Block[]): string {
  let n = 1;
  while (existing.some((b) => b.id === `${kind}_${n}`)) n += 1;
  return `${kind}_${n}`;
}

export function defaultBlock(kind: BlockKind, id: string, tool?: string): Block {
  if (kind === "tool") {
    return { id, kind: "tool", tool: tool ?? "", inputs: {} };
  }
  if (kind === "trigger") {
    // `type: "trigger"` matters — the event→workflow router matches on
    // the legacy `type` field, so a trigger without it never fires.
    return { id, kind: "trigger", type: "trigger" };
  }
  if (kind === "condition") {
    return { id, kind: "condition", config: { field: "", operator: "truthy", value: "" } };
  }
  if (kind === "for_each") {
    return { id, kind: "for_each", config: { items: "", tool: "", inputs: {} } };
  }
  if (kind === "delay") {
    return { id, kind: "delay", config: { ms: 1000 } };
  }
  if (kind === "transform") {
    return { id, kind: "transform", config: { mapping: {} } };
  }
  if (kind === "agent") {
    return { id, kind: "agent", tool: "framework.agents.wake", inputs: {} };
  }
  return { id, kind };
}

export function edgeId(e: Edge): string {
  return e.id ?? `${e.sourceBlockId}->${e.targetBlockId}:${e.sourceHandle ?? ""}`;
}

/** Stable category color per kind — used by node accent bars + palette. */
export function kindAccent(kind: BlockKind): {
  bar: string;
  text: string;
  bg: string;
  ring: string;
  label: string;
} {
  switch (kind) {
    case "trigger":
      return { bar: "bg-violet-500", text: "text-violet-700", bg: "bg-violet-50", ring: "ring-violet-200", label: "TRIGGER" };
    case "tool":
      return { bar: "bg-sky-500", text: "text-sky-700", bg: "bg-sky-50", ring: "ring-sky-200", label: "TOOL" };
    case "agent":
      return { bar: "bg-fuchsia-500", text: "text-fuchsia-700", bg: "bg-fuchsia-50", ring: "ring-fuchsia-200", label: "AGENT" };
    case "condition":
      return { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200", label: "IF" };
    case "for_each":
      return { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200", label: "LOOP" };
    case "delay":
      return { bar: "bg-muted", text: "text-muted-strong", bg: "bg-bg", ring: "ring-border", label: "WAIT" };
    case "transform":
      return { bar: "bg-muted", text: "text-muted-strong", bg: "bg-bg", ring: "ring-border", label: "MAP" };
    case "sticky":
      return { bar: "bg-yellow-400", text: "text-yellow-800", bg: "bg-yellow-50", ring: "ring-yellow-300", label: "NOTE" };
    case "branch":
      return { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200", label: "BRANCH" };
    default:
      return { bar: "bg-muted", text: "text-muted-strong", bg: "bg-bg", ring: "ring-border", label: "BLOCK" };
  }
}

export function moduleOf(toolFullName: string | undefined): string | null {
  if (!toolFullName) return null;
  return toolFullName.split(".")[0] ?? null;
}
