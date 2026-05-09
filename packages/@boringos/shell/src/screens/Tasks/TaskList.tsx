// SPDX-License-Identifier: BUSL-1.1
//
// Tasks list pane — clickable rows. Mirrors the inbox list shape so
// muscle memory carries over.

import type { Task } from "@boringos/ui";

import { LoadingState } from "../_shared.js";
import { formatRelativeTime, originLabel, statusLabel } from "./presenter.js";

const PRIORITY_BG: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-border",
};

const STATUS_COLOR: Record<string, string> = {
  todo: "bg-bg-warm text-text-secondary",
  in_progress: "bg-accent-tint text-accent",
  blocked: "bg-rose-100 text-rose-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-bg-warm text-muted line-through",
};

export interface TaskListProps {
  tasks: Task[];
  isLoading: boolean;
  selectedId: string | null;
  needsAttention: Set<string>;
  onSelect: (id: string) => void;
}

export function TaskList({ tasks, isLoading, selectedId, needsAttention, onSelect }: TaskListProps) {
  if (isLoading) return <LoadingState />;

  return (
    <ul className="overflow-auto divide-y divide-border-subtle">
      {tasks.map((t) => {
        const selected = t.id === selectedId;
        const flagged = needsAttention.has(t.id);
        const priorityClass = PRIORITY_BG[t.priority] ?? "bg-border";
        const statusClass = STATUS_COLOR[t.status] ?? "bg-bg-warm text-muted-strong";
        return (
          <li
            key={t.id}
            data-testid="task-row"
            data-id={t.id}
            data-selected={selected ? "true" : "false"}
            onClick={() => onSelect(t.id)}
            className={`px-4 py-3 cursor-pointer border-l-2 ${
              selected
                ? "bg-accent-tint/60 border-accent"
                : flagged
                  ? "bg-rose-50/40 border-rose-400 hover:bg-rose-50/70"
                  : "border-transparent hover:bg-bg"
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${priorityClass}`}
                aria-hidden
                title={`Priority: ${t.priority}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-text truncate">
                    {t.title}
                  </span>
                  <span className="text-[10px] text-muted shrink-0 tabular-nums">
                    {formatRelativeTime(t.updatedAt)}
                  </span>
                </div>
                {t.description && (
                  <p className="text-xs text-muted truncate mt-0.5">
                    {/* Show plain text in the row preview — markdown
                        rendering is reserved for the detail pane.
                        Strip basic markup to avoid noise. */}
                    {t.description.replace(/[`*_#>]/g, "").trim()}
                  </p>
                )}
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${statusClass}`}
                  >
                    {statusLabel(t.status)}
                  </span>
                  {t.identifier && (
                    <span className="text-[10px] text-muted font-mono">
                      {t.identifier}
                    </span>
                  )}
                  <span className="text-[10px] text-muted bg-bg-warm px-1.5 py-0.5 rounded">
                    {originLabel(t.originKind)}
                  </span>
                  {flagged && (
                    <span
                      className="text-[10px] text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded font-medium"
                      title="A run on this task failed — needs attention"
                    >
                      ⚠ Needs attention
                    </span>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
