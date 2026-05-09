// SPDX-License-Identifier: BUSL-1.1
//
// Reply composer modal. Gmail-parity layout:
//   - Empty rich editor at the top, cursor inside
//   - Quoted message collapsed under a "Show original" toggle
//   - Send produces multipart/alternative (text/html + text/plain) so
//     the recipient sees rich formatting in any client
//
// Why we no longer use the sender's plain MIME part:
//   - It's frequently broken (CSS leaks, missing whitespace, etc.)
//   - The recipient is typically on Gmail and renders HTML anyway
//   - We can derive a clean plain-text fallback from our own HTML
//     editor output via `htmlToPlainText` in the presenter

import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import type { InboxItem } from "@boringos/ui";
import { useClient } from "@boringos/ui";

import type { ReplyDraft } from "./presenter.js";
import {
  buildHtmlQuotedReply,
  htmlToPlainText,
} from "./presenter.js";
import { RichTextEditor } from "./RichTextEditor.js";

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

/** Read the HTML body the connector ingested into metadata.bodyHtml. */
function readBodyHtml(item: InboxItem): string | null {
  const m = item.metadata;
  if (!m || typeof m !== "object") return null;
  const html = (m as { bodyHtml?: unknown }).bodyHtml;
  return typeof html === "string" && html.length > 0 ? html : null;
}

function readSourceMessageId(item: InboxItem): string | null {
  return typeof item.sourceId === "string" && item.sourceId.length > 0
    ? item.sourceId
    : null;
}

function readThreadId(item: InboxItem): string | null {
  const m = item.metadata;
  if (!m || typeof m !== "object") return null;
  const t = (m as { threadId?: unknown }).threadId;
  return typeof t === "string" && t.length > 0 ? t : null;
}

/** Reuse the inbox renderer's allow-list — same posture for outgoing
 *  HTML so we never ship attribute-handlers / scripts to the recipient. */
const SEND_PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "a", "p", "br", "strong", "em", "b", "i", "u", "s",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "table", "thead", "tbody", "tr", "td", "th", "tfoot",
    "img", "hr",
    "span", "div",
    "small", "sub", "sup",
  ],
  ALLOWED_ATTR: [
    "href", "title", "alt", "src",
    "width", "height",
    "colspan", "rowspan",
    "class", "style",
    // gmail_quote attribution survives; recipients' clients use it.
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button"],
  FORBID_ATTR: [
    "onerror", "onload", "onclick", "onmouseover", "onmouseout",
    "onfocus", "onblur",
  ],
};

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

  // Editor state. The Tiptap component owns its own DOM state — we
  // mirror it into React so Send / Discard can read the latest HTML
  // without reaching into the editor instance.
  const initialDraftHtml = useMemo(() => initialDraft?.body ?? "", [initialDraft]);
  const [draftHtml, setDraftHtml] = useState(initialDraftHtml);

  const [showQuote, setShowQuote] = useState(false);

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

  const originalBodyHtml = useMemo(() => readBodyHtml(item), [item]);
  const originalBodyPlain = item.body ?? null;
  const sourceMessageId = useMemo(() => readSourceMessageId(item), [item]);
  const threadId = useMemo(() => readThreadId(item), [item]);

  // Preview of the quoted block shown when "Show original" is on.
  // We sanitize even on display because some original HTML carries
  // inline styles we don't want bleeding into the composer chrome.
  const sanitizedOriginal = useMemo(() => {
    if (!originalBodyHtml) return null;
    return DOMPurify.sanitize(originalBodyHtml, SEND_PURIFY_CONFIG) as unknown as string;
  }, [originalBodyHtml]);

  const handleSend = async () => {
    setError(null);
    setBusy(true);
    try {
      // Build the outgoing HTML: editor draft on top, quoted block
      // underneath. Quote is included whether or not the user expanded
      // it in the UI — recipients want the context.
      const composedHtml = buildHtmlQuotedReply({
        draftHtml,
        originalSender: item.from,
        originalDate: item.createdAt,
        originalBodyHtml,
        originalBodyPlain,
      });

      // Sanitize before send so we never ship attribute handlers /
      // scripts the editor or paste step might have introduced.
      const safeHtml = DOMPurify.sanitize(composedHtml, SEND_PURIFY_CONFIG) as unknown as string;
      // Plain-text alternative is derived from the HTML, NOT from
      // the sender's broken plain part. Recipients on text-only
      // clients see the same content as the HTML (sans formatting).
      const plainText = htmlToPlainText(safeHtml);

      if (!isGmail) {
        await navigator.clipboard.writeText(plainText);
        setSent(true);
        onSent?.(plainText);
        return;
      }

      // Prefer the dedicated reply path when we have the Gmail message
      // id + thread id — keeps the In-Reply-To / References / threadId
      // wiring intact so Gmail surfaces our reply inside the original
      // thread instead of as a fresh email.
      const useReply = sourceMessageId !== null && threadId !== null;
      const result = useReply
        ? await client.invokeAction("google", "gmail.reply_email", {
            messageId: sourceMessageId,
            threadId,
            to,
            subject,
            bodyHtml: safeHtml,
            bodyText: plainText,
          })
        : await client.invokeAction("google", "gmail.send_email", {
            to,
            subject,
            bodyHtml: safeHtml,
            bodyText: plainText,
          });
      if (!result.success) {
        throw new Error(result.error ?? "Send failed");
      }
      setSent(true);
      onSent?.(plainText);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canSend = !busy && !!to.trim() && htmlToPlainText(draftHtml).length > 0;

  return (
    <div
      data-testid="reply-composer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-accent/40 px-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white shadow-xl ring-1 ring-border flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 pt-4 pb-3 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-text">
            {sent ? "Sent." : isGmail ? "Reply via Gmail" : "Reply (copy)"}
          </h2>
          {!isGmail && !sent && (
            <p className="text-[11px] text-muted mt-0.5">
              Sending isn't wired for {item.source}; clicking Send will copy
              the draft to your clipboard as plain text.
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
                <label className="text-[10px] uppercase tracking-wider text-muted font-medium">
                  To
                </label>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={busy}
                  className="mt-1 w-full text-sm border border-border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted font-medium">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={busy}
                  className="mt-1 w-full text-sm border border-border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted font-medium">
                  Message
                </label>
                <div className="mt-1">
                  <RichTextEditor
                    initialHtml={initialDraftHtml}
                    onChange={setDraftHtml}
                    disabled={busy}
                    placeholder="Write your reply…"
                  />
                </div>
              </div>

              {(originalBodyHtml || originalBodyPlain) && (
                <div className="text-xs">
                  <button
                    type="button"
                    onClick={() => setShowQuote((v) => !v)}
                    className="text-muted hover:text-text"
                  >
                    {showQuote ? "Hide quoted message" : "Show quoted message"}
                  </button>
                  {showQuote && (
                    <div className="mt-2 border-l-2 border-border pl-3 max-h-48 overflow-auto text-[12px] text-muted-strong">
                      {sanitizedOriginal ? (
                        <div
                          // The quoted block is sender-controlled HTML
                          // already stripped by SEND_PURIFY_CONFIG.
                          // eslint-disable-next-line react/no-danger
                          dangerouslySetInnerHTML={{ __html: sanitizedOriginal }}
                        />
                      ) : (
                        <pre className="whitespace-pre-wrap font-sans">
                          {originalBodyPlain ?? ""}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}

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
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-light"
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="text-xs font-medium px-3 py-1.5 rounded-md text-muted-strong hover:bg-bg-warm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!canSend}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-light disabled:bg-border"
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
