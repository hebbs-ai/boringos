// SPDX-License-Identifier: BUSL-1.1
//
// Action toolbar in the task detail header. Buttons are text-first so
// the affordance is obvious; mirrors the inbox toolbar's idiom.

import { useEffect, useRef, useState } from "react";
import { useClient } from "@boringos/ui";
import type { Task, Agent } from "@boringos/ui";

const PRIORITIES = ["low", "medium", "high"] as const;
type Priority = (typeof PRIORITIES)[number];

export interface TaskActionToolbarProps {
  task: Task;
  agents: Agent[];
  onChanged: () => void;
}

export function TaskActionToolbar({ task, agents, onChanged }: TaskActionToolbarProps) {
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const reassignRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click.
  useEffect(() => {
    if (!reassignOpen) return;
    function onDoc(e: MouseEvent) {
      if (reassignRef.current && !reassignRef.current.contains(e.target as Node)) {
        setReassignOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [reassignOpen]);

  const setStatus = async (status: "done" | "todo") => {
    setBusy(true);
    try {
      await client.updateTask(task.id, { status });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const cyclePriority = async () => {
    const idx = PRIORITIES.indexOf(task.priority as Priority);
    const next = PRIORITIES[(idx + 1) % PRIORITIES.length]!;
    setBusy(true);
    try {
      await client.updateTask(task.id, { priority: next });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const reassign = async (agentId: string) => {
    setReassignOpen(false);
    setBusy(true);
    try {
      // assignTask wakes the agent on the task if `wake: true`.
      await client.assignTask(task.id, agentId, false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const wake = async () => {
    if (!task.assigneeAgentId) return;
    setBusy(true);
    try {
      await client.wakeAgent(task.assigneeAgentId, task.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this task? This cannot be undone.")) return;
    setBusy(true);
    try {
      await client.deleteTask(task.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const isDone = task.status === "done";

  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => void setStatus(isDone ? "todo" : "done")}
        disabled={busy}
        className={`text-xs font-medium px-3 py-1.5 rounded-md text-white disabled:opacity-50 ${
          isDone ? "bg-muted hover:bg-muted-strong" : "bg-emerald-600 hover:bg-emerald-700"
        }`}
        title={isDone ? "Reopen" : "Mark done (e)"}
      >
        {isDone ? "↺ Reopen" : "✓ Mark done"}
      </button>

      <div ref={reassignRef} className="relative">
        <button
          type="button"
          onClick={() => setReassignOpen((v) => !v)}
          disabled={busy || agents.length === 0}
          className="text-xs font-medium px-3 py-1.5 rounded-md text-text-secondary hover:bg-bg-warm disabled:opacity-50"
          title="Reassign to a different agent"
        >
          ↻ Reassign ▾
        </button>
        {reassignOpen && (
          <div className="absolute z-20 top-full left-0 mt-1 w-56 rounded-md bg-white shadow-lg ring-1 ring-border overflow-hidden max-h-72 overflow-y-auto">
            {agents.length === 0 ? (
              <div className="text-[11px] text-muted px-3 py-2">No agents available.</div>
            ) : (
              agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => void reassign(a.id)}
                  className={`w-full text-left text-xs px-3 py-2 hover:bg-bg ${
                    a.id === task.assigneeAgentId ? "bg-accent-tint text-accent" : ""
                  }`}
                >
                  <div className="font-medium">{a.name}</div>
                  {a.role && <div className="text-[10px] text-muted">{a.role}</div>}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => void cyclePriority()}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-md text-text-secondary hover:bg-bg-warm disabled:opacity-50"
        title="Cycle priority (low → medium → high → low)"
      >
        ⋮ Priority: {task.priority}
      </button>

      {task.assigneeAgentId && task.status !== "done" && (
        <button
          type="button"
          onClick={() => void wake()}
          disabled={busy}
          className="text-xs font-medium px-3 py-1.5 rounded-md text-text-secondary hover:bg-bg-warm disabled:opacity-50"
          title="Manually wake the assigned agent (use when it looks stuck)"
        >
          ↯ Wake
        </button>
      )}

      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-50 ml-auto"
        title="Delete task"
      >
        🗑 Delete
      </button>
    </div>
  );
}
