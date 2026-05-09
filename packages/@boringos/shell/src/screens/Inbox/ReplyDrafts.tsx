// SPDX-License-Identifier: BUSL-1.1
//
// Reply drafts cards. Per metadata.replyDrafts written by replier
// agents (generic-replier today; CRM/Accounts repliers later — each
// shows up as its own card so the user can pick which voice/context
// matches what they want to send).

import type { ReplyDraft } from "./presenter.js";
import { formatAbsoluteTime } from "./presenter.js";

export interface ReplyDraftsProps {
  drafts: ReplyDraft[];
  /** Triggers the compose modal in A8; for v1 it just opens the editor. */
  onUseDraft?: (draft: ReplyDraft) => void;
  /** Drops the draft from metadata.replyDrafts. */
  onDiscardDraft?: (draft: ReplyDraft) => void | Promise<void>;
}

export function ReplyDrafts({ drafts, onUseDraft, onDiscardDraft }: ReplyDraftsProps) {
  if (drafts.length === 0) return null;

  return (
    <section
      data-testid="reply-drafts"
      className="rounded-lg border border-emerald-200 bg-emerald-50/40"
    >
      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-emerald-800 font-medium">
          ✏ Reply drafts
        </span>
        <span className="text-[10px] text-emerald-700/70 tabular-nums">
          {drafts.length}
        </span>
      </div>
      <ul className="divide-y divide-emerald-100">
        {drafts.map((draft, i) => (
          <li key={`${draft.author}-${i}`} className="px-4 py-3" data-testid="reply-draft-card">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-emerald-800">
                {labelFor(draft.author)}
              </span>
              {draft.draftedAt && (
                <span className="text-[10px] text-emerald-700/60">
                  {formatAbsoluteTime(draft.draftedAt)}
                </span>
              )}
            </div>
            <pre className="mt-2 text-sm text-text whitespace-pre-wrap font-sans leading-relaxed">
              {draft.body}
            </pre>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onUseDraft?.(draft)}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-700 text-white hover:bg-emerald-800"
              >
                Use this draft
              </button>
              <button
                type="button"
                onClick={() => void onDiscardDraft?.(draft)}
                className="text-xs font-medium px-3 py-1.5 rounded-md text-muted-strong hover:bg-bg-warm"
              >
                Discard
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Friendly label per author. Convention: each replier app stamps its
 * own id (e.g. "generic-replier", "crm.replier"). We surface the part
 * after the dot as the visible label so the user sees the concept
 * (e.g. "CRM") not the prefix.
 */
function labelFor(author: string): string {
  if (author === "generic-replier") return "Generic reply";
  if (author.startsWith("crm.")) return "CRM reply";
  if (author.startsWith("accounts.")) return "Accounts reply";
  // Fallback: last path segment, title-cased.
  const last = author.split(/[.-]/).pop() ?? author;
  return last.charAt(0).toUpperCase() + last.slice(1) + " reply";
}
