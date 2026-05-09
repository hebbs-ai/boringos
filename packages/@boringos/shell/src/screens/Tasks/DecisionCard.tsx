// SPDX-License-Identifier: BUSL-1.1
//
// Approval decision affordance for `agent_action` tasks. Two states:
//
//   1. Pending — proposed-params summary, Approve / Reject buttons,
//      optional comment textarea. Submitting hits
//      POST /api/admin/tasks/:id/decision and posts the comment to
//      the PARENT task so the requesting agent's session resumes
//      with it in context.
//
//   2. Decided — collapses to a slim banner ("✓ Approved by X · 2h
//      ago"), with the decision comment shown below. Stays visible
//      so the audit trail is obvious.

import { useState } from "react";
import { useClient } from "@boringos/ui";
import type { Task } from "@boringos/ui";

import { Markdown } from "../../components/Markdown.js";
import {
  formatRelativeTime,
  readApprovalDecision,
  readProposedParams,
  summarizeProposedParams,
} from "./presenter.js";

export interface DecisionCardProps {
  task: Task;
  /** Fires after a successful decision so the parent can refetch. */
  onDecided: () => void;
}

export function DecisionCard({ task, onDecided }: DecisionCardProps) {
  const decision = readApprovalDecision(task);
  if (decision) {
    return <DecidedBanner decision={decision} />;
  }
  return <PendingPanel task={task} onDecided={onDecided} />;
}

function DecidedBanner({ decision }: { decision: NonNullable<ReturnType<typeof readApprovalDecision>> }) {
  const isApprove = decision.decision === "approve";
  return (
    <section
      data-testid="decision-card-decided"
      className={`rounded-lg ring-1 px-4 py-3 ${
        isApprove
          ? "bg-emerald-50/60 ring-emerald-200"
          : "bg-rose-50/60 ring-rose-200"
      }`}
    >
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`text-[10px] uppercase tracking-wider font-medium ${
            isApprove ? "text-emerald-800" : "text-rose-800"
          }`}
        >
          {isApprove ? "✓ Approved" : "✗ Rejected"}
        </span>
        <span className="text-slate-500">
          {formatRelativeTime(decision.decidedAt)}
        </span>
      </div>
      {decision.comment && (
        <div className="mt-2">
          <Markdown source={decision.comment} compact className="text-slate-800" />
        </div>
      )}
    </section>
  );
}

function PendingPanel({ task, onDecided }: { task: Task; onDecided: () => void }) {
  const client = useClient();
  const params = readProposedParams(task);
  const summary = summarizeProposedParams(params);

  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (kind: "approve" | "reject") => {
    setError(null);
    setBusy(true);
    try {
      await client.decideTask(task.id, kind, comment.trim() || undefined);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="decision-card-pending"
      className="rounded-lg ring-1 ring-amber-200 bg-amber-50/40 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-amber-800 font-medium">
          ⚠ Decision needed
        </span>
        <span className="text-xs text-slate-700">{summary}</span>
      </div>

      {params && Object.keys(params).length > 0 && (
        <details className="mt-2">
          <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-900">
            Show proposed parameters
          </summary>
          <pre className="mt-1.5 text-[11px] text-slate-700 bg-white rounded px-2.5 py-1.5 ring-1 ring-slate-200 whitespace-pre-wrap font-mono overflow-x-auto">
{JSON.stringify(params, null, 2)}
          </pre>
        </details>
      )}

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        disabled={busy}
        rows={2}
        placeholder="Optional note — conditions, reasoning, alternative the agent should consider…"
        className="mt-2 w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-sans"
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500">
          Your note posts on the original task and wakes the requesting
          agent.
        </span>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-[11px] text-rose-600 max-w-[180px] truncate">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={() => void decide("reject")}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
          >
            ✗ Reject
          </button>
          <button
            type="button"
            onClick={() => void decide("approve")}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Deciding…" : "✓ Approve"}
          </button>
        </div>
      </div>
    </section>
  );
}
