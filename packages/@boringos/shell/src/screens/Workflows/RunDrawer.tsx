// SPDX-License-Identifier: BUSL-1.1
//
// Bottom drawer that collapses to a strip and lifts up to show the
// span tree of the active run. Clicking a span pans the canvas and
// selects that block.

import { useMemo } from "react";

import type { BlockRun, V2Block } from "./types.js";
import { blockKind, kindAccent } from "./utils.js";
import type { RunDetail } from "./api.js";

export interface RunDrawerProps {
  open: boolean;
  onToggle: () => void;
  recentRuns: RunDetail["run"][];
  activeRun: RunDetail | null;
  onPickRun: (runId: string) => void;
  onPickBlock: (blockId: string) => void;
  blocks: V2Block[];
  selectedBlockId: string | null;
  onReplayRun: () => void;
}

export function RunDrawer(p: RunDrawerProps) {
  const successRate = useMemo(() => {
    const recent = p.recentRuns.slice(0, 20);
    if (recent.length === 0) return null;
    const ok = recent.filter((r) => r.status === "completed").length;
    return Math.round((ok / recent.length) * 100);
  }, [p.recentRuns]);

  const lastDuration = p.recentRuns[0]?.durationMs ?? null;

  return (
    <div
      className={`border-t border-border bg-white shrink-0 transition-[height] ${
        p.open ? "h-[280px]" : "h-7"
      }`}
    >
      {/* Strip */}
      <button
        type="button"
        onClick={p.onToggle}
        className="w-full px-4 h-7 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted hover:bg-bg"
      >
        <span className="font-semibold">Runs</span>
        {p.recentRuns.length > 0 && (
          <>
            <Sparkline runs={p.recentRuns.slice(0, 12)} />
            {successRate !== null && (
              <span className="text-muted">{successRate}% · {p.recentRuns.length}</span>
            )}
            {lastDuration !== null && (
              <span className="font-mono text-muted">{lastDuration}ms</span>
            )}
          </>
        )}
        <span className="ml-auto text-muted">{p.open ? "▼" : "▲"}</span>
      </button>

      {p.open && (
        <div className="h-[calc(280px-1.75rem)] flex">
          {/* Left: recent runs list */}
          <div className="w-44 shrink-0 border-r border-border-subtle overflow-y-auto">
            <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted font-semibold border-b border-border-subtle">
              Recent
            </div>
            {p.recentRuns.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-muted">No runs yet.</div>
            ) : (
              <ul>
                {p.recentRuns.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => p.onPickRun(r.id)}
                      className={`w-full text-left px-3 py-1 text-[11px] flex items-center gap-2 ${
                        p.activeRun?.run.id === r.id
                          ? "bg-bg-warm text-text"
                          : "text-muted-strong hover:bg-bg"
                      }`}
                    >
                      <RunStatusDot status={r.status} />
                      <span className="font-mono">{r.id.slice(0, 6)}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted">
                        {r.durationMs ?? "—"}ms
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right: span tree of active run */}
          <div className="flex-1 overflow-y-auto">
            {!p.activeRun ? (
              <div className="px-3 py-3 text-[11px] text-muted">Pick a run on the left.</div>
            ) : (
              <SpanTree
                run={p.activeRun}
                blocks={p.blocks}
                selectedBlockId={p.selectedBlockId}
                onPickBlock={p.onPickBlock}
                onReplayRun={p.onReplayRun}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RunStatusDot({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-rose-500"
        : status === "running"
          ? "bg-amber-400 animate-pulse"
          : "bg-border";
  return <span className={`w-1.5 h-1.5 rounded-full ${cls}`} />;
}

function SpanTree({
  run,
  blocks,
  selectedBlockId,
  onPickBlock,
  onReplayRun,
}: {
  run: RunDetail;
  blocks: V2Block[];
  selectedBlockId: string | null;
  onPickBlock: (id: string) => void;
  onReplayRun: () => void;
}) {
  const blockMap = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  // Compute total run duration for relative bars.
  const totalMs = run.run.durationMs ?? Math.max(1, sumDurations(run.blocks));
  const startedAt = new Date(run.run.startedAt ?? Date.now()).getTime();

  return (
    <div>
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle text-[11px]">
        <RunStatusDot status={run.run.status} />
        <code className="font-mono text-text-secondary">{run.run.id.slice(0, 8)}</code>
        <span className="text-muted">·</span>
        <span className="text-muted">{run.run.triggerType ?? "manual"}</span>
        {run.run.durationMs !== null && (
          <span className="font-mono text-muted">· {run.run.durationMs}ms</span>
        )}
        <button
          type="button"
          onClick={onReplayRun}
          className="ml-auto text-muted hover:text-text px-2 py-0.5 rounded border border-border hover:border-border text-[10px]"
        >
          ↻ Replay
        </button>
      </header>

      {run.run.error && (
        <div className="mx-3 mt-2 rounded bg-rose-50 border border-rose-200 px-2 py-1.5 text-[10px] text-rose-700 font-mono break-all">
          {run.run.error}
        </div>
      )}

      <div className="px-2 py-1">
        {run.blocks.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-muted">
            (no per-block records — older runs may not have block-level traces)
          </div>
        ) : (
          run.blocks.map((br, idx) => {
            const block = blockMap.get(br.blockId);
            const k = block ? blockKind(block) : "tool";
            const accent = kindAccent(k as Parameters<typeof kindAccent>[0]);
            const ms = br.durationMs ?? 0;
            const widthPct = totalMs > 0 ? Math.max(2, Math.min(100, (ms / totalMs) * 100)) : 2;
            return (
              <button
                key={`${br.blockId}-${idx}`}
                type="button"
                onClick={() => onPickBlock(br.blockId)}
                className={`group w-full text-left px-2 py-1 rounded text-[11px] flex items-center gap-2 ${
                  selectedBlockId === br.blockId ? "bg-bg-warm" : "hover:bg-bg"
                }`}
              >
                <BlockStatusDot status={br.status} />
                <span className={`text-[8px] font-semibold tracking-wider ${accent.text} w-12`}>
                  {accent.label}
                </span>
                <code className="font-mono text-text-secondary w-28 truncate">{br.blockId}</code>
                <div className="flex-1 relative h-2 bg-bg-warm rounded-full overflow-hidden">
                  <div
                    className={`absolute top-0 left-0 h-full ${accent.bar}`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-muted w-12 text-right">
                  {ms}ms
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function BlockStatusDot({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-rose-500"
        : status === "running"
          ? "bg-amber-400 animate-pulse"
          : status === "skipped"
            ? "bg-border"
            : status === "waiting"
              ? "bg-violet-400"
              : "bg-border";
  return <span className={`w-1.5 h-1.5 rounded-full ${cls}`} />;
}

function Sparkline({ runs }: { runs: RunDetail["run"][] }) {
  // Reverse so oldest is on the left.
  const ordered = [...runs].reverse();
  return (
    <span className="flex items-center gap-[2px]">
      {ordered.map((r) => (
        <span
          key={r.id}
          title={`${r.status} · ${r.durationMs ?? "?"}ms`}
          className={`w-[3px] h-3 rounded-sm ${
            r.status === "completed"
              ? "bg-emerald-500"
              : r.status === "failed"
                ? "bg-rose-500"
                : r.status === "running"
                  ? "bg-amber-400"
                  : "bg-border"
          }`}
        />
      ))}
    </span>
  );
}

function sumDurations(blocks: BlockRun[]): number {
  return blocks.reduce((acc, b) => acc + (b.durationMs ?? 0), 0);
}
