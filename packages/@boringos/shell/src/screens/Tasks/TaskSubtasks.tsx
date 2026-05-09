// SPDX-License-Identifier: BUSL-1.1
//
// Subtasks rolled up under a parent. The framework already supports
// `parent_id` on tasks and exposes a `parentId` filter via the admin
// list endpoint. Click a subtask → parent row's onSelect bubbles back
// up so we re-open the detail with the child id.

import { useQuery } from "@tanstack/react-query";
import { useClient } from "@boringos/ui";
import type { Task } from "@boringos/ui";

import { statusLabel } from "./presenter.js";

export interface TaskSubtasksProps {
  parentId: string;
  /** Used for the "View" jump-to button. */
  onSelect: () => void;
}

export function TaskSubtasks({ parentId, onSelect: _onSelect }: TaskSubtasksProps) {
  const client = useClient();
  // No dedicated parentId filter on the list endpoint today; we
  // fetch everything and filter client-side. Cheap enough for now;
  // promote to server-side filter if we ever blow past a few hundred
  // tasks per tenant.
  const { data: all } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => client.getTasks(),
  });
  const subtasks = (all ?? []).filter((t: Task) => t.parentId === parentId);

  if (subtasks.length === 0) return null;

  const done = subtasks.filter((s) => s.status === "done").length;

  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-wider text-muted font-medium">
        Subtasks ({done}/{subtasks.length})
      </h3>
      <ul className="mt-1.5 divide-y divide-border-subtle rounded-md border border-border">
        {subtasks.map((s) => (
          <li key={s.id} className="px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text truncate">
                {s.title}
              </div>
              {s.description && (
                <div className="text-[11px] text-muted truncate mt-0.5">
                  {s.description.replace(/[`*_#>]/g, "").trim()}
                </div>
              )}
            </div>
            <span
              className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${
                s.status === "done"
                  ? "bg-emerald-100 text-emerald-800"
                  : s.status === "blocked"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-bg-warm text-text-secondary"
              }`}
            >
              {statusLabel(s.status)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
