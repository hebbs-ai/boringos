// SPDX-License-Identifier: BUSL-1.1
//
// Task reply UX — driven by the next_actor state machine.
//
//   next_actor='human'  → "Waiting on you" banner + two explicit
//                          buttons: [Send back to agent] / [Mark done]
//   next_actor='agent'  → "Agent working" banner + single [Send note]
//                          button (queues a comment for the agent's
//                          next wake; does NOT force-wake mid-run)
//   next_actor=null     → task is done/cancelled — read-only.
//
// The buttons map 1:1 to backend endpoints:
//   POST /api/admin/tasks/:id/send-to-agent   { comment? }
//   POST /api/admin/tasks/:id/mark-done       { comment? }
//   POST /api/admin/tasks/:id/comments        { body }   (note while agent works)
//
// We dropped the slash-command auto-wake path. State transitions are
// always explicit button clicks — no inferred intent.

import { useState } from "react";
import { useClient } from "@boringos/ui";
import type { Task, Agent } from "@boringos/ui";

export interface TaskReplyBoxProps {
  task: Task;
  agents: Agent[];
  onPosted: () => void;
}

export function TaskReplyBox({ task, onPosted }: TaskReplyBoxProps) {
  const client = useClient();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDone = task.status === "done" || task.status === "cancelled";
  const waitingOnUser = !isDone && task.nextActor === "human";
  const agentWorking = !isDone && task.nextActor === "agent";

  if (isDone) {
    return (
      <section data-testid="task-reply-box">
        <div className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-muted">
          This task is closed. Reopen it from the action bar to continue the conversation.
        </div>
      </section>
    );
  }

  const sendToAgent = async () => {
    setError(null);
    setBusy(true);
    try {
      await client.sendTaskToAgent(task.id, body.trim() || undefined);
      setBody("");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const markDone = async () => {
    setError(null);
    setBusy(true);
    try {
      await client.markTaskDone(task.id, body.trim() || undefined);
      setBody("");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const sendNote = async () => {
    if (!body.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await client.postComment(task.id, { body });
      setBody("");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (waitingOnUser) void sendToAgent();
      else void sendNote();
    }
  };

  // Banner copy is intentionally verbatim per the design spec — no
  // creative synonyms. Predictable language matters more than clever
  // phrasing.
  const banner = waitingOnUser ? (
    <div className="rounded-t-lg bg-amber-50 border-b border-amber-200 px-3 py-2 text-xs font-medium text-amber-900">
      Waiting on you
    </div>
  ) : agentWorking ? (
    <div className="rounded-t-lg bg-accent-tint border-b border-accent px-3 py-2 text-xs font-medium text-accent">
      Agent working — your note will be queued for the next pass
    </div>
  ) : null;

  const placeholder = waitingOnUser
    ? "Write a reply, then choose Send back to agent or Mark done…  (⌘+Enter = send to agent)"
    : "Add a note for the agent to see on its next wake…  (⌘+Enter = send)";

  const hasContent = body.trim().length > 0;

  return (
    <section data-testid="task-reply-box">
      <div className="rounded-lg border border-border bg-white">
        {banner}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          rows={3}
          placeholder={placeholder}
          className="w-full text-sm px-3 py-2.5 focus:outline-none resize-y font-sans"
        />
        <div className="flex items-center justify-end gap-2 px-2 py-1.5 border-t border-border-subtle bg-bg/50 rounded-b-lg">
          {error && (
            <span className="text-[11px] text-rose-600 max-w-[200px] truncate">{error}</span>
          )}
          {waitingOnUser ? (
            <>
              <button
                type="button"
                onClick={() => void markDone()}
                disabled={busy}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-border"
              >
                {busy ? "…" : "Mark done"}
              </button>
              <button
                type="button"
                onClick={() => void sendToAgent()}
                disabled={busy}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-light disabled:bg-border"
              >
                {busy ? "…" : "Send back to agent"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void sendNote()}
              disabled={busy || !hasContent}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-light disabled:bg-border"
            >
              {busy ? "Sending…" : "Send note"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
