// SPDX-License-Identifier: BUSL-1.1
//
// Tasks detail pane — header + markdown description + conversation
// thread + inline reply box + subtasks + activity log. The action
// toolbar (Mark done, Reassign, Set priority, etc.) lives in
// TaskActionToolbar.

import { useQuery } from "@tanstack/react-query";
import { useClient } from "@boringos/ui";
import type { TaskWithComments } from "@boringos/ui";
import type { Agent } from "@boringos/ui";

import { Markdown } from "../../components/Markdown.js";
import { LoadingState } from "../_shared.js";
import { DecisionCard } from "./DecisionCard.js";
import { TaskActionToolbar } from "./TaskActionToolbar.js";
import { TaskCommentsThread } from "./TaskCommentsThread.js";
import { TaskReplyBox } from "./TaskReplyBox.js";
import { TaskSubtasks } from "./TaskSubtasks.js";
import { formatRelativeTime, originLabel, statusLabel } from "./presenter.js";

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

const STATUS_COLORS: Record<string, string> = {
  todo: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-800",
  blocked: "bg-rose-100 text-rose-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-100 text-slate-500",
};

export interface TaskDetailProps {
  taskId: string | null;
  meId: string;
  /** Fired after any mutation so the parent can refetch lists. */
  onChanged: () => void;
}

export function TaskDetail({ taskId, meId, onChanged }: TaskDetailProps) {
  const client = useClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks", taskId],
    queryFn: async () => {
      if (!taskId) return null;
      return client.getTask(taskId);
    },
    enabled: !!taskId,
  });

  // Agents list — used to render comment author names + the reassign
  // dropdown. One fetch shared via cache.
  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: () => client.getAgents(),
  });
  const agentsById = new Map<string, Agent>();
  for (const a of agentsData ?? []) agentsById.set(a.id, a);

  if (!taskId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-slate-500">Select a task to read.</p>
      </div>
    );
  }
  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-rose-600">Couldn't load task.</p>
      </div>
    );
  }

  const tw: TaskWithComments = data;
  const t = tw.task;
  const statusClass = STATUS_COLORS[t.status] ?? "bg-slate-100";
  const priorityClass = PRIORITY_COLORS[t.priority] ?? "bg-slate-100";
  const assignee =
    t.assigneeAgentId
      ? agentsById.get(t.assigneeAgentId)?.name ?? "Agent"
      : t.assigneeUserId
        ? "You"
        : "Unassigned";

  return (
    <div className="flex-1 overflow-auto">
      <header className="sticky top-0 bg-white border-b border-slate-100 px-6 pt-5 pb-4 z-10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900 leading-tight">
              {t.title}
            </h2>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
              <span
                className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${statusClass}`}
              >
                {statusLabel(t.status)}
              </span>
              <span
                className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${priorityClass}`}
              >
                {t.priority}
              </span>
              {t.identifier && (
                <span className="text-[10px] font-mono text-slate-400">
                  {t.identifier}
                </span>
              )}
              <span>·</span>
              <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                {originLabel(t.originKind)}
              </span>
              <span>·</span>
              <span>Assignee: {assignee}</span>
              <span>·</span>
              <span title={new Date(t.createdAt).toLocaleString()}>
                Updated {formatRelativeTime(t.updatedAt)}
              </span>
            </div>
          </div>
        </div>
        <TaskActionToolbar
          task={t}
          agents={agentsData ?? []}
          onChanged={onChanged}
        />
      </header>

      <div className="px-6 py-4 space-y-5">
        {/* Decision card: only renders for `agent_action` tasks. Sits
            above the description so the affordance is the first thing
            the user sees when opening an approval-request task. */}
        {t.originKind === "agent_action" && (
          <DecisionCard task={t} onDecided={onChanged} />
        )}

        {t.description && (
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              Description
            </h3>
            <div className="mt-1.5">
              <Markdown source={t.description} className="text-slate-800" />
            </div>
          </section>
        )}

        <TaskSubtasks parentId={t.id} onSelect={onChanged} />

        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
            Conversation
          </h3>
          <div className="mt-2">
            <TaskCommentsThread
              comments={tw.comments}
              agentsById={agentsById}
              meId={meId}
            />
          </div>
        </section>

        <TaskReplyBox
          task={t}
          agents={agentsData ?? []}
          onPosted={onChanged}
        />
      </div>
    </div>
  );
}
