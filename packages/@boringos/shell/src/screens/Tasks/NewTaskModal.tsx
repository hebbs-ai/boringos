// SPDX-License-Identifier: BUSL-1.1
//
// "+ New task" modal. Manual task creation from the Tasks screen.
// All other task origins (inbox.*, routine, copilot, agent_action,
// human_todo) are agent / framework driven; this surface is the
// single human-driven entry point and so always uses
// origin_kind="manual".

import { useEffect, useMemo, useState } from "react";
import { useClient } from "@boringos/ui";
import type { Agent, Task } from "@boringos/ui";

const PRIORITIES = ["low", "medium", "high"] as const;

export interface NewTaskModalProps {
  onClose: () => void;
  /** Fired with the new task id on success so the parent can select it. */
  onCreated: (taskId: string) => void;
  agents: Agent[];
  /** Optional — when present, the new task is created as a subtask. */
  parentId?: string;
}

const ASSIGN_ME = "__me__";
// The single human-facing assistant per tenant. Tenants may rename
// the agent ("Chief of Staff" → "Atlas"), so resolve by role rather
// than name.
const CHIEF_OF_STAFF_ROLE = "chief-of-staff";

export function NewTaskModal({ onClose, onCreated, agents, parentId }: NewTaskModalProps) {
  const client = useClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  // Default to Chief of Staff — that's the user's personal AI proxy
  // and the 90% case for "+ New task" is "ask my agent to do X."
  // Fall back to "Me" only when the tenant hasn't been provisioned
  // with a CoS agent (rare; mostly self-hosted edge cases).
  const defaultAssignee = useMemo(
    () => agents.find((a) => a.role === CHIEF_OF_STAFF_ROLE)?.id ?? ASSIGN_ME,
    [agents],
  );
  const [assignee, setAssignee] = useState<string>(defaultAssignee);
  const [wakeNow, setWakeNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc to close + ⌘+Enter to submit (matches inbox composer + reply box).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const isAgent = assignee !== ASSIGN_ME;
  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const submit = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      const created: Task = await client.createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assigneeAgentId: isAgent ? assignee : undefined,
        // assigneeUserId omitted on purpose — the admin endpoint
        // defaults it to c.get("userId") when neither agent nor user
        // is supplied, which gives us "assigned to me" for free.
        parentId,
        originKind: "manual",
      });
      // Wake the agent immediately if requested. The framework
      // accepts this as a separate /assign call so we get the same
      // path as in-place reassignment.
      if (isAgent && wakeNow) {
        await client.assignTask(created.id, assignee, true);
      }
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="new-task-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-white shadow-xl ring-1 ring-slate-200 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {parentId ? "New subtask" : "New task"}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Description supports markdown · ⌘+Enter to submit
          </p>
        </header>

        <div className="px-5 py-4 space-y-3 overflow-auto">
          <Field label="Title">
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={busy}
              placeholder="What needs to happen?"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Description (optional, markdown)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={busy}
              rows={5}
              placeholder="Context, acceptance criteria, notes…"
              className={`${INPUT_CLASS} font-sans`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
                disabled={busy}
                className={INPUT_CLASS}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Assignee">
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                disabled={busy}
                className={INPUT_CLASS}
              >
                <option value={ASSIGN_ME}>Me</option>
                {sortedAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {isAgent && (
            <label className="flex items-center gap-2 text-xs text-slate-700 mt-1">
              <input
                type="checkbox"
                checked={wakeNow}
                onChange={(e) => setWakeNow(e.target.checked)}
                disabled={busy}
                className="rounded border-slate-300"
              />
              Wake the agent now
              <span className="text-slate-400">
                — fires immediately so the agent starts on this task
              </span>
            </label>
          )}

          {error && (
            <div className="rounded-md bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 pb-4 pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !title.trim()}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const INPUT_CLASS =
  "mt-1 w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}
