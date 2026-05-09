// SPDX-License-Identifier: BUSL-1.1
//
// Per-tab empty state for Tasks. The default empty list is a teaching
// moment — celebrate when there's nothing waiting, point users to the
// next thing to do otherwise.

import { Link } from "react-router-dom";

import { EmptyState } from "../_shared.js";
import type { TaskTab } from "./presenter.js";

export interface TaskEmptyStateProps {
  tab: TaskTab;
  /** Triggers the New-task modal — passed in by the parent screen. */
  onNewTask?: () => void;
}

function NewTaskButton({ onClick }: { onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-light"
    >
      + New task
    </button>
  );
}

export function TaskEmptyState({ tab, onNewTask }: TaskEmptyStateProps) {
  switch (tab) {
    case "my-todos":
      return (
        <EmptyState
          title="Inbox zero on tasks too."
          description="Nothing waiting on you right now. Add a task or delegate something via Copilot."
          cta={
            <div className="flex items-center gap-2">
              <NewTaskButton onClick={onNewTask} />
              <Link
                to="/copilot"
                className="text-xs font-medium px-3 py-1.5 rounded-md text-text-secondary hover:bg-bg-warm"
              >
                Open Copilot
              </Link>
            </div>
          }
        />
      );
    case "watching":
      return (
        <EmptyState
          title="Nothing in flight."
          description="When you ask an agent to do something, it'll show up here while it's working."
          cta={<NewTaskButton onClick={onNewTask} />}
        />
      );
    case "done":
      return (
        <EmptyState
          title="No completed tasks yet."
          description="Tasks you finish or that agents finish for you in the last 30 days will land here."
        />
      );
    case "system":
      return (
        <EmptyState
          title="No automated tasks."
          description="Connect a connector under Connectors to start ingesting work — emails to triage, messages to draft, etc."
          cta={
            <Link
              to="/connectors"
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-light"
            >
              Open Connectors
            </Link>
          }
        />
      );
    case "all":
    default:
      return (
        <EmptyState
          title="No tasks yet."
          description="Tasks are created by you, by agents, or by workflows."
          cta={<NewTaskButton onClick={onNewTask} />}
        />
      );
  }
}
