// SPDX-License-Identifier: BUSL-1.1
//
// Reply composer modal. Pre-filled from the inbox item being replied
// to; sends via the Gmail connector for google.gmail items, falls back
// to copy-to-clipboard for non-email sources (Slack DMs etc — those
// will get their own send paths in later phases).

import { useEffect, useMemo, useState } from "react";
import type { InboxItem } from "@boringos/ui";
import { useClient } from "@boringos/ui";

import type { ReplyDraft } from "./presenter.js";
import { buildQuotedReply } from "./presenter.js";

export interface ReplyComposerProps {
  item: InboxItem;
  /** Optional draft to pre-fill body. */
  initialDraft?: ReplyDraft | null;
  onClose: () => void;
  /** Fired after a successful send so the parent can refresh / dismiss. */
  onSent?: (sentBody: string) => void;
}

/** Extract the bare email address from an RFC-2822-ish "Name <email>" string. */
function extractEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  const match = /<([^>]+)>/.exec(raw);
  if (match && match[1]) return match[1].trim();
  // No angle brackets — assume the whole string is the email.
  return raw.trim();
}

/** Compose a Re: subject (only prepend "Re:" once). */
function rePrefix(subject: string): string {
  const trimmed = (subject ?? "").trim();
  if (/^re:\s/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed || "(no subject)"}`;
}

export function ReplyComposer({
  item,
  initialDraft,
  onClose,
  onSent,
}: ReplyComposerProps) {
  const client = useClient();

  const defaultTo = useMemo(() => extractEmail(item.from), [item.from]);
  const defaultSubject = useMemo(() => rePrefix(item.subject ?? ""), [item.subject]);
  const isGmail = item.source === "google.gmail";

  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(() =>
    buildQuotedReply({
      draft: initialDraft?.body ?? "",
      originalSender: item.from,
      originalDate: item.createdAt,
      originalBody: item.body,
    }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const handleSend = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!isGmail) {
        await navigator.clipboard.writeText(body);
        setSent(true);
        onSent?.(body);
        return;
      }
      const result = await client.invokeAction("google", "gmail.send_email", {
        to,
        subject,
        body,
      });
      if (!result.success) {
        throw new Error(result.error ?? "Send failed");
      }
      setSent(true);
      onSent?.(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="reply-composer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-white shadow-xl ring-1 ring-slate-200 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {sent ? "Sent." : isGmail ? "Reply via Gmail" : "Reply (copy)"}
          </h2>
          {!isGmail && !sent && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              Sending isn't wired for {item.source}; clicking Send will copy
              the draft to your clipboard.
            </p>
          )}
        </header>

        <div className="px-5 py-4 space-y-3 overflow-auto">
          {sent ? (
            <div className="rounded-md bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 text-sm text-emerald-800">
              {isGmail ? "Reply sent." : "Reply copied to clipboard."}
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                  To
                </label>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={busy}
                  className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={busy}
                  className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                  Body
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={busy}
                  rows={10}
                  placeholder="Write your reply…"
                  className="mt-1 w-full text-sm border border-slate-200 rounded-md px-2.5 py-2 font-sans focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              {error && (
                <div className="rounded-md bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="px-5 pb-4 pt-2 flex items-center justify-end gap-2">
          {sent ? (
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
            >
              Close
            </button>
          ) : (
            <>
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
                onClick={() => void handleSend()}
                disabled={busy || !body.trim() || !to.trim()}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300"
              >
                {busy ? (isGmail ? "Sending…" : "Copying…") : isGmail ? "Send" : "Copy"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
