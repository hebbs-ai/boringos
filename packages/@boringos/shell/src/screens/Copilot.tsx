// SPDX-License-Identifier: BUSL-1.1
//
// Copilot screen — v2 implementation. The legacy `/api/copilot/*`
// API was deleted; copilot conversations are now tasks with
// `originKind: "copilot"` assigned to the per-tenant copilot
// agent. This screen:
//
//   - Lists existing copilot tasks (left pane)
//   - Renders the active task's comment thread (right pane)
//   - Sends a new message by posting a comment, which auto-wakes
//     the copilot agent. The agent's reply lands as a comment on
//     the same task (auto-post-result pipeline)
//   - Polls every 3s while a thread is open so new comments arrive
//     without manual refresh
//
// To start a fresh conversation, click "New session" — the
// framework's `copilot.start_session` tool creates a task seeded
// with the user's first message.

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../auth/AuthProvider.js";
import { useTasks, useTask, useAgents } from "@boringos/ui";
import { ScreenBody, ScreenHeader, EmptyState, LoadingState } from "./_shared.js";
import { Markdown } from "../components/Markdown.js";

interface Comment {
  id: string;
  body: string;
  authorAgentId?: string | null;
  authorUserId?: string | null;
  createdAt: string | Date;
}

interface CopilotTaskRow {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

export function Copilot() {
  const { user } = useAuth();
  const { agents } = useAgents();
  const { tasks: allTasks } = useTasks();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter to copilot tasks (assigned to the copilot agent for
  // this tenant, or originKind="copilot"). Sort newest-first.
  const copilotAgent = useMemo(
    () => (agents ?? []).find((a) => a.role === "copilot"),
    [agents],
  );

  const copilotTasks = useMemo<CopilotTaskRow[]>(() => {
    if (!allTasks) return [];
    return (allTasks as unknown as Array<{
      id: string;
      title: string;
      status: string;
      assigneeAgentId?: string | null;
      originKind?: string;
      updatedAt?: string | Date;
      createdAt?: string | Date;
    }>)
      .filter(
        (t) => t.assigneeAgentId === copilotAgent?.id || t.originKind === "copilot",
      )
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        updatedAt: String(t.updatedAt ?? t.createdAt ?? ""),
      }))
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  }, [allTasks, copilotAgent?.id]);

  // Auto-select the most recent thread when the list loads.
  useEffect(() => {
    if (!activeId && copilotTasks.length > 0) setActiveId(copilotTasks[0].id);
  }, [activeId, copilotTasks]);

  return (
    <>
      <ScreenHeader title="Copilot" subtitle="Threaded conversations with your copilot agent" />
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar: thread list */}
        <nav className="w-64 border-r border-border-subtle overflow-y-auto shrink-0 flex flex-col">
          <NewSessionButton
            disabled={!copilotAgent}
            onCreated={(taskId) => setActiveId(taskId)}
          />
          {copilotTasks.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted">
              No conversations yet. Click "New session" to start.
            </div>
          ) : (
            <ul>
              {copilotTasks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(t.id)}
                    className={`block w-full text-left px-3 py-2 text-sm transition-colors border-l-2 ${
                      activeId === t.id
                        ? "bg-bg-warm text-text border-accent font-medium"
                        : "text-text-secondary hover:bg-bg border-transparent"
                    }`}
                  >
                    <div className="truncate">{t.title || "(untitled)"}</div>
                    <div className="text-[10px] text-muted mt-0.5 uppercase tracking-wide">
                      {t.status}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        {/* Active thread */}
        <ScreenBody>
          {!activeId ? (
            <EmptyState
              title="No conversation selected"
              description="Pick a thread on the left or start a new session."
            />
          ) : (
            <ActiveThread
              taskId={activeId}
              copilotAgentId={copilotAgent?.id}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              setBusy={setBusy}
              error={error}
              setError={setError}
            />
          )}
        </ScreenBody>
      </div>
    </>
  );
}

function NewSessionButton(props: { disabled: boolean; onCreated: (taskId: string) => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (props.disabled || !token) return;
    setBusy(true);
    try {
      // Use the v2 framework.tasks.create flow via admin API.
      // This goes through /api/admin/tasks (session-authed) →
      // creates a task with originKind="copilot" → the assignee
      // copilot agent is woken automatically.
      const res = await fetch("/api/admin/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          // Placeholder shown until the user's first message arrives —
          // the comments endpoint replaces this with a heuristic from
          // the first message, and the copilot persona refines it on
          // first reply (gated by metadata.titleAuto).
          title: "New conversation",
          originKind: "copilot",
          metadata: { titleAuto: true },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const body = (await res.json()) as { id: string };
      props.onCreated(body.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={props.disabled || busy}
      onClick={start}
      className="m-3 px-3 py-1.5 rounded-md bg-accent text-white text-sm hover:bg-accent-light disabled:opacity-50"
    >
      {busy ? "..." : "+ New session"}
    </button>
  );
}

function ActiveThread(props: {
  taskId: string;
  copilotAgentId?: string;
  draft: string;
  setDraft: (s: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const { task, comments, postComment, isLoading } = useTask(props.taskId);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

  // Poll while the task is open — invalidate the task query so
  // useQuery refetches. 3s is responsive enough for an in-flight
  // copilot run without thrashing.
  useEffect(() => {
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["task", props.taskId] });
    }, 3000);
    return () => clearInterval(id);
  }, [queryClient, props.taskId]);

  // Auto-scroll to the latest comment.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [comments?.length]);

  const send = useCallback(async () => {
    if (!props.draft.trim() || props.busy) return;
    props.setBusy(true);
    props.setError(null);
    try {
      await postComment(props.draft.trim());
      props.setDraft("");
    } catch (e) {
      props.setError(e instanceof Error ? e.message : String(e));
    } finally {
      props.setBusy(false);
    }
  }, [postComment, props]);

  if (isLoading) return <LoadingState />;
  if (!task) return <EmptyState title="Thread not found" description="" />;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-1 pb-3 mb-3 border-b border-border-subtle">
        <div className="text-sm font-medium text-text">{task.title}</div>
        <div className="text-xs text-muted mt-0.5">
          {task.status} · {(comments ?? []).length} message{(comments ?? []).length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {(comments ?? []).length === 0 ? (
          <div className="text-xs text-muted px-2 py-8 text-center">
            No messages yet. Send the first one below.
          </div>
        ) : (
          ((comments ?? []) as unknown as Comment[]).map((c) => {
            const fromCopilot = !!c.authorAgentId && c.authorAgentId === props.copilotAgentId;
            return (
              <div
                key={c.id}
                className={`flex ${fromCopilot ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                    fromCopilot
                      ? "bg-bg-warm text-text"
                      : "bg-accent text-white"
                  }`}
                >
                  <Markdown source={c.body} compact />
                  <div
                    className={`text-[10px] mt-1 ${
                      fromCopilot ? "text-muted" : "text-white/70"
                    }`}
                  >
                    {fromCopilot ? "copilot" : "you"} ·{" "}
                    {new Date(c.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="mt-3 pt-3 border-t border-border-subtle">
        {props.error && (
          <div className="mb-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {props.error}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            rows={2}
            value={props.draft}
            onChange={(e) => props.setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Type a message · ⌘↩ to send"
            className="flex-1 resize-none rounded-md border border-border px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent-tint"
          />
          <button
            type="button"
            disabled={!props.draft.trim() || props.busy}
            onClick={send}
            className="self-end px-3 py-2 rounded-md bg-accent text-white text-sm hover:bg-accent-light disabled:opacity-50"
          >
            {props.busy ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
