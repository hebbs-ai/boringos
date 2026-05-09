// SPDX-License-Identifier: BUSL-1.1
//
// Tasks — two-pane layout (list + detail).
// Tabs are intent-based (My todos / Watching / Done / System / All)
// per docs/blockers/done/task_05_tasks_rich_ux.md.

import { useEffect, useMemo, useState } from "react";
import { useTasks, useClient } from "@boringos/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ScreenBody, ScreenHeader } from "../_shared.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { NewTaskModal } from "./NewTaskModal.js";
import { TaskList } from "./TaskList.js";
import { TaskDetail } from "./TaskDetail.js";
import { TaskEmptyState } from "./TaskEmptyState.js";
import {
  TAB_LABEL,
  TAB_ORDER,
  countsByTab,
  filterForTab,
  type TaskTab,
} from "./presenter.js";
import { useNeedsAttention } from "./useNeedsAttention.js";

export function Tasks() {
  const { user } = useAuth();
  const meId = user?.id ?? "";
  const client = useClient();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TaskTab>("my-todos");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const { tasks, isLoading } = useTasks();
  const allTasks = tasks ?? [];

  // Agents list — needed for the New-task modal's assignee picker.
  // Cached query so the dropdown opens instantly.
  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: () => client.getAgents(),
  });
  const agents = agentsData ?? [];

  const needsAttention = useNeedsAttention(allTasks);

  const filtered = useMemo(
    () => filterForTab(allTasks, tab, meId, needsAttention),
    [allTasks, tab, meId, needsAttention],
  );
  const counts = useMemo(
    () => countsByTab(allTasks, meId, needsAttention),
    [allTasks, meId, needsAttention],
  );

  // When the tab changes or the selected task no longer belongs in
  // the visible list, drop the selection so the detail pane resets.
  useEffect(() => {
    if (!selectedId) return;
    if (!filtered.some((t) => t.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  // Auto-select first task on initial load.
  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0]!.id);
  }, [filtered, selectedId]);

  const selected = filtered.find((t) => t.id === selectedId) ?? null;

  // Refetch comments + task when the user sends a reply etc.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    if (selectedId) {
      queryClient.invalidateQueries({ queryKey: ["tasks", selectedId] });
    }
  };

  return (
    <>
      <ScreenHeader
        title="Tasks"
        subtitle="Things waiting on you, and things in flight"
        actions={
          <>
            <div className="flex items-center gap-1 rounded-md border border-border bg-white p-0.5">
              {TAB_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-2.5 py-1 text-xs rounded inline-flex items-center gap-1 ${
                    tab === t
                      ? "bg-bg-warm text-text font-medium"
                      : "text-muted hover:text-text"
                  }`}
                >
                  {TAB_LABEL[t]}
                  {counts[t] > 0 && (
                    <span
                      className={`text-[10px] tabular-nums px-1 rounded ${
                        tab === t ? "bg-border-subtle text-text-secondary" : "bg-bg-warm text-muted"
                      }`}
                    >
                      {counts[t]}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-light"
            >
              + New task
            </button>
          </>
        }
      />
      <ScreenBody>
        <div className="flex h-[calc(100vh-160px)] gap-4">
          <div className="w-96 border border-border rounded-lg bg-white overflow-hidden flex flex-col">
            {filtered.length === 0 && !isLoading ? (
              <TaskEmptyState tab={tab} onNewTask={() => setComposeOpen(true)} />
            ) : (
              <TaskList
                tasks={filtered}
                isLoading={isLoading}
                selectedId={selectedId}
                needsAttention={needsAttention}
                onSelect={setSelectedId}
              />
            )}
          </div>

          <div className="flex-1 border border-border rounded-lg bg-white overflow-hidden flex flex-col min-w-0">
            <TaskDetail
              taskId={selected?.id ?? null}
              meId={meId}
              onChanged={refresh}
            />
          </div>
        </div>
      </ScreenBody>

      {composeOpen && (
        <NewTaskModal
          agents={agents}
          onClose={() => setComposeOpen(false)}
          onCreated={(newId) => {
            setComposeOpen(false);
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            setSelectedId(newId);
          }}
        />
      )}
    </>
  );
}
