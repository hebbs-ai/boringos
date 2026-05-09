// SPDX-License-Identifier: BUSL-1.1

import type { V2Block, V2BlockKind, V2Edge } from "./types.js";

export function authHeaders(token: string | null, tenantId: string | undefined): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

export function blockKind(b: V2Block): V2BlockKind {
  return (b.kind ?? b.type ?? "tool") as V2BlockKind;
}

export function blockLabel(b: V2Block): string {
  if (b.name) return b.name;
  const k = blockKind(b);
  if (k === "tool" && b.tool) return b.tool.split(".").slice(-1)[0] ?? b.tool;
  if (k === "agent") return "wake agent";
  if (k === "trigger") return "trigger";
  if (k === "condition") {
    const c = b.config as { field?: string; operator?: string; value?: unknown } | undefined;
    if (c?.field && c?.operator) return `if ${c.operator} ${c.value ?? ""}`.trim();
    return "if";
  }
  if (k === "for_each") return "for each";
  if (k === "delay") {
    const ms = (b.config as { ms?: number } | undefined)?.ms ?? 0;
    return ms ? `wait ${formatMs(ms)}` : "delay";
  }
  if (k === "transform") return "transform";
  return k;
}

export function blockSubLabel(b: V2Block): string | null {
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
export function newBlockId(kind: V2BlockKind, existing: V2Block[]): string {
  let n = 1;
  while (existing.some((b) => b.id === `${kind}_${n}`)) n += 1;
  return `${kind}_${n}`;
}

export function defaultBlock(kind: V2BlockKind, id: string, tool?: string): V2Block {
  if (kind === "tool") {
    return { id, kind: "tool", tool: tool ?? "", inputs: {} };
  }
  if (kind === "trigger") {
    return { id, kind: "trigger" };
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
    return { id, kind: "tool", tool: "framework.agents.wake", inputs: {} };
  }
  return { id, kind };
}

export function edgeId(e: V2Edge): string {
  return e.id ?? `${e.sourceBlockId}->${e.targetBlockId}:${e.sourceHandle ?? ""}`;
}

/** Stable category color per kind — used by node accent bars + palette. */
export function kindAccent(kind: V2BlockKind): {
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
