// SPDX-License-Identifier: BUSL-1.1

import type { AgentRun } from "@boringos/ui";
import { formatRelative } from "../presenter.js";

export function RunsTab({ runs }: { runs: AgentRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        No runs yet for this agent.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-white">
      {runs.slice(0, 20).map((run) => (
        <li key={run.id} className="flex items-center gap-3 px-3 py-2">
          <RunStatus status={run.status} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-text">
              {run.startedAt
                ? new Date(run.startedAt).toLocaleString()
                : "queued"}
            </div>
            <div className="truncate text-[11px] text-muted">
              {run.error || run.errorCode || run.model || run.id.slice(0, 8)}
            </div>
          </div>
          <div className="text-[11px] text-muted tabular-nums">
            {formatRelative(run.startedAt ?? run.createdAt)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function RunStatus({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-500",
    running: "bg-accent animate-pulse",
    failed: "bg-red-500",
    cancelled: "bg-muted",
    pending: "bg-amber-400",
    skipped: "bg-border",
  };
  const cls = map[status] ?? "bg-border";
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
      title={status}
      aria-label={status}
    />
  );
}
