// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sleek per-kind node renderers. Aim: small, mono, low-contrast,
// status visible at a glance via a dot — not a bulky ring.

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

import type { BlockRunStatus, Block, BlockKind } from "./types.js";
import { blockKind, blockLabel, blockSubLabel, kindAccent } from "./utils.js";

export interface BlockNodeData extends Record<string, unknown> {
  block: Block;
  selected?: boolean;
  status?: BlockRunStatus | null;
  durationMs?: number | null;
  pinned?: boolean;
  eventLabels?: Record<string, string>;
}

const STATUS_DOT: Record<BlockRunStatus, string> = {
  pending: "bg-border",
  running: "bg-amber-400 animate-pulse",
  completed: "bg-emerald-500",
  skipped: "bg-border opacity-50",
  failed: "bg-rose-500",
  waiting: "bg-violet-400",
};

function StatusDot({ status }: { status?: BlockRunStatus | null }) {
  if (!status) return null;
  return <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />;
}

function NodeShell({
  kind,
  selected,
  hasInput = true,
  hasOutput = true,
  branched = false,
  pinned = false,
  status,
  durationMs,
  children,
}: {
  kind: BlockKind;
  selected?: boolean;
  hasInput?: boolean;
  hasOutput?: boolean;
  branched?: boolean;
  pinned?: boolean;
  status?: BlockRunStatus | null;
  durationMs?: number | null;
  children: React.ReactNode;
}) {
  const accent = kindAccent(kind);
  return (
    <div
      className={`group relative w-[152px] rounded-md border bg-white shadow-sm transition-shadow ${
        selected
          ? `border-accent shadow-md ring-2 ${accent.ring}`
          : status === "failed"
            ? "border-rose-300"
            : status === "completed"
              ? "border-emerald-200"
              : status === "running"
                ? "border-amber-300"
                : "border-border hover:border-border"
      }`}
    >
      {/* Left accent bar — category color */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md ${accent.bar}`} />

      {/* Pin chip, top-right */}
      {pinned && (
        <span
          title="Output pinned for dev runs"
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white"
        />
      )}

      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-1.5 !h-1.5 !min-w-0 !min-h-0 !-left-[3px] !bg-border !border-0"
        />
      )}

      {/* Body */}
      <div className="pl-3 pr-2 py-1.5">{children}</div>

      {/* Right handles */}
      {hasOutput && !branched && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-1.5 !h-1.5 !min-w-0 !min-h-0 !-right-[3px] !bg-border !border-0"
        />
      )}
      {branched && (
        <>
          <Handle
            type="source"
            id="true"
            position={Position.Right}
            style={{ top: "38%" }}
            className="!w-2 !h-2 !min-w-0 !min-h-0 !-right-[4px] !bg-emerald-500 !border-0"
          />
          <Handle
            type="source"
            id="false"
            position={Position.Right}
            style={{ top: "72%" }}
            className="!w-2 !h-2 !min-w-0 !min-h-0 !-right-[4px] !bg-rose-500 !border-0"
          />
        </>
      )}

      {/* Status footer (run mode only) */}
      {(status || durationMs) && (
        <div className="absolute -bottom-4 left-3 flex items-center gap-1 text-[9px] text-muted font-mono">
          <StatusDot status={status} />
          {durationMs !== null && durationMs !== undefined && <span>{formatDur(durationMs)}</span>}
        </div>
      )}
    </div>
  );
}

function formatDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

// ── Per-kind node bodies ──────────────────────────────────────────────────

export function BlockNode({ data }: NodeProps<Node<BlockNodeData>>) {
  const block = data.block;
  const k = blockKind(block);
  const accent = kindAccent(k);
  const branched = k === "condition";
  const hasInput = k !== "trigger";

  if (k === "sticky") return <StickyNode data={data} />;

  const label = blockLabel(block, data.eventLabels);
  const sub = blockSubLabel(block);

  return (
    <NodeShell
      kind={k}
      selected={data.selected}
      branched={branched}
      hasInput={hasInput}
      pinned={data.pinned}
      status={data.status}
      durationMs={data.durationMs}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`text-[8px] font-semibold tracking-wider ${accent.text}`}>
          {accent.label}
        </span>
        {data.status && <span className="ml-auto"><StatusDot status={data.status} /></span>}
      </div>
      <div className="text-[11px] font-medium text-text leading-tight truncate">
        {label}
      </div>
      {sub && (
        <div className="text-[9px] font-mono text-muted leading-tight truncate mt-0.5">
          {sub}
        </div>
      )}
    </NodeShell>
  );
}

function StickyNode({ data }: { data: BlockNodeData }) {
  const cfg = (data.block.config ?? {}) as { text?: string };
  return (
    <div
      className={`w-[176px] min-h-[80px] rounded-sm bg-yellow-100 border border-yellow-300 shadow-sm px-2.5 py-2 text-[11px] text-yellow-900 whitespace-pre-wrap ${
        data.selected ? "ring-2 ring-yellow-400" : ""
      }`}
    >
      {cfg.text || (
        <span className="text-yellow-700/60 italic">Note — click to edit</span>
      )}
    </div>
  );
}

export const nodeTypes = { block: BlockNode } as const;
