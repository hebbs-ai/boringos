// SPDX-License-Identifier: BUSL-1.1
//
// Pure helpers for the Inbox screen — kept separate from React so the
// formatting/parsing logic can be unit-tested without a jsdom harness
// (same pattern as Connectors/connectorsPresenter.ts).

export type Classification =
  | "lead"
  | "reply"
  | "internal"
  | "newsletter"
  | "spam"
  | "unknown";

export interface TriageView {
  classification: Classification;
  score: number;
  rationale: string;
  classifiedAt: string | null;
}

interface ItemLike {
  metadata?: Record<string, unknown> | null;
}

interface ThreadingItem extends ItemLike {
  id: string;
  createdAt: string | Date;
  source: string;
}

/** A thread is the visible unit in the inbox list. */
export interface Thread<T extends ThreadingItem = ThreadingItem> {
  /** Stable identifier — uses metadata.threadId when present, else item.id. */
  threadId: string;
  /** All items belonging to this thread, sorted oldest → newest. */
  items: T[];
  /** Latest item (most recent createdAt) — used for the list row. */
  latest: T;
}

/** Read the threadId off an item's metadata, falling back to item.id. */
export function readThreadId(item: ThreadingItem): string {
  const m = item.metadata;
  if (m && typeof m === "object") {
    const tid = (m as { threadId?: unknown }).threadId;
    if (typeof tid === "string" && tid.length > 0) return tid;
  }
  return item.id;
}

/**
 * Group inbox items by Gmail's threadId (or any source's threadId
 * field on metadata). Items without one form singleton threads.
 *
 * Output is ordered newest → oldest by the latest message in each
 * thread, so the freshest activity bubbles to the top of the list.
 */
export function groupByThread<T extends ThreadingItem>(items: T[]): Thread<T>[] {
  const byThread = new Map<string, T[]>();
  for (const item of items) {
    const tid = readThreadId(item);
    const list = byThread.get(tid);
    if (list) list.push(item);
    else byThread.set(tid, [item]);
  }

  const threads: Thread<T>[] = [];
  for (const [threadId, group] of byThread) {
    const sorted = [...group].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    threads.push({ threadId, items: sorted, latest: sorted[sorted.length - 1]! });
  }

  threads.sort(
    (a, b) =>
      new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime(),
  );
  return threads;
}

/**
 * Read the triage block (written by generic-triage agent) off an
 * inbox item's metadata. Returns null when triage hasn't run yet —
 * caller decides what to render in that gap.
 */
export function readTriage(item: ItemLike): TriageView | null {
  const m = item.metadata;
  if (!m || typeof m !== "object") return null;
  const t = (m as { triage?: unknown }).triage;
  if (!t || typeof t !== "object") return null;
  const r = t as Record<string, unknown>;
  const cls = typeof r.classification === "string" ? r.classification : "unknown";
  return {
    classification: normalizeClassification(cls),
    score: typeof r.score === "number" ? r.score : 0,
    rationale: typeof r.rationale === "string" ? r.rationale : "",
    classifiedAt: typeof r.classifiedAt === "string" ? r.classifiedAt : null,
  };
}

function normalizeClassification(raw: string): Classification {
  const v = raw.toLowerCase();
  if (v === "lead" || v === "reply" || v === "internal" || v === "newsletter" || v === "spam") {
    return v;
  }
  return "unknown";
}

/**
 * Number of reply drafts attached by replier agents.
 * Returns 0 when no drafts.
 */
export function countDrafts(item: ItemLike): number {
  const m = item.metadata;
  if (!m || typeof m !== "object") return 0;
  const drafts = (m as { replyDrafts?: unknown }).replyDrafts;
  return Array.isArray(drafts) ? drafts.length : 0;
}

export interface ReplyDraft {
  /** Identifier the agent that wrote this draft (e.g. "generic-replier"). */
  author: string;
  draftedAt: string | null;
  body: string;
}

/** Read the replyDrafts array from metadata, normalizing missing fields. */
export function readDrafts(item: ItemLike): ReplyDraft[] {
  const m = item.metadata;
  if (!m || typeof m !== "object") return [];
  const arr = (m as { replyDrafts?: unknown }).replyDrafts;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((entry): ReplyDraft | null => {
      if (!entry || typeof entry !== "object") return null;
      const r = entry as Record<string, unknown>;
      if (typeof r.body !== "string" || r.body.length === 0) return null;
      return {
        author: typeof r.author === "string" ? r.author : "unknown",
        draftedAt: typeof r.draftedAt === "string" ? r.draftedAt : null,
        body: r.body,
      };
    })
    .filter((d): d is ReplyDraft => d !== null);
}

/**
 * Score → semantic color tier. Bands match the triage agent's skill
 * markdown:
 *   90-100  urgent       → emerald (high signal)
 *   70-89   active back-and-forth → emerald (slightly muted)
 *   50-69   ambiguous urgency     → amber
 *   20-49   informational         → slate
 *   0-19    newsletter / spam     → slate (muted)
 */
export type ScoreTier = "high" | "medium" | "low" | "muted";

export function scoreTier(score: number): ScoreTier {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  if (score >= 20) return "low";
  return "muted";
}

/** Tailwind background+text classes for a small classification chip. */
export function classificationChipClass(c: Classification): string {
  switch (c) {
    case "lead":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "reply":
      return "bg-accent-tint text-accent ring-accent-tint";
    case "internal":
      return "bg-bg-warm text-muted-strong ring-border";
    case "newsletter":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "spam":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    default:
      return "bg-bg text-muted ring-border";
  }
}

export interface SentReply {
  sentAt: string;
  body: string;
  /** Source the reply was sent through (e.g. "google.gmail" or "clipboard"). */
  via: string;
}

/**
 * Read the sentReply block off metadata. Stamped by the shell's reply
 * composer right after a successful send. Drives the "Replied" badge
 * + the "Your reply" card in the detail pane.
 */
export function readSentReply(item: ItemLike): SentReply | null {
  const m = item.metadata;
  if (!m || typeof m !== "object") return null;
  const r = (m as { sentReply?: unknown }).sentReply;
  if (!r || typeof r !== "object") return null;
  const obj = r as Record<string, unknown>;
  if (typeof obj.body !== "string" || typeof obj.sentAt !== "string") return null;
  return {
    sentAt: obj.sentAt,
    body: obj.body,
    via: typeof obj.via === "string" ? obj.via : "unknown",
  };
}

export interface ScheduledMeeting {
  eventId?: string;
  htmlLink?: string;
  startsAt: string;
  endsAt?: string;
  scheduledAt?: string;
}

/**
 * Read the scheduledMeeting block off metadata. Stamped by the
 * Schedule modal after a successful create_event. Drives the
 * "🗓 Meeting scheduled" indicator on the inbox row.
 */
export function readScheduledMeeting(item: ItemLike): ScheduledMeeting | null {
  const m = item.metadata;
  if (!m || typeof m !== "object") return null;
  const s = (m as { scheduledMeeting?: unknown }).scheduledMeeting;
  if (!s || typeof s !== "object") return null;
  const obj = s as Record<string, unknown>;
  if (typeof obj.startsAt !== "string") return null;
  return {
    eventId: typeof obj.eventId === "string" ? obj.eventId : undefined,
    htmlLink: typeof obj.htmlLink === "string" ? obj.htmlLink : undefined,
    startsAt: obj.startsAt,
    endsAt: typeof obj.endsAt === "string" ? obj.endsAt : undefined,
    scheduledAt: typeof obj.scheduledAt === "string" ? obj.scheduledAt : undefined,
  };
}

/**
 * Compose a quoted reply body. Standard email convention:
 *   <draft body>
 *
 *   On <date>, <sender> wrote:
 *   > line 1
 *   > line 2
 *
 * Drafts that already contain a quoted block (replier agents
 * sometimes paste one in) are returned as-is so we don't double-quote.
 */
export function buildQuotedReply(args: {
  draft: string;
  originalSender: string | null | undefined;
  originalDate: string | Date | null | undefined;
  originalBody: string | null | undefined;
}): string {
  const { draft, originalSender, originalDate, originalBody } = args;
  const draftClean = (draft ?? "").trimEnd();

  if (!originalBody) return draftClean;

  // Already has a quoted block?
  const lines = draftClean.split(/\r?\n/);
  const hasQuoteBlock = lines.some(
    (l, i) => l.startsWith("> ") && (lines[i + 1]?.startsWith("> ") ?? false),
  );
  if (hasQuoteBlock) return draftClean;

  const sender = (originalSender ?? "").trim() || "the sender";
  const dateStr = originalDate ? formatAbsoluteTime(originalDate) : "";

  // Strip HTML, decode common entities, dedupe blank lines, prefix `> `.
  const stripped = originalBody
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const quoted = stripped
    .split("\n")
    .map((l) => (l.length === 0 ? ">" : `> ${l}`))
    .join("\n");

  const header = dateStr ? `On ${dateStr}, ${sender} wrote:` : `${sender} wrote:`;
  const sep = draftClean.length > 0 ? "\n\n" : "";
  return `${draftClean}${sep}${header}\n${quoted}\n`;
}

/**
 * Build the HTML quote block prepended to a reply. Mirrors Gmail's
 * `<blockquote class="gmail_quote">` convention so the recipient's
 * client (which is typically Gmail) renders our reply with the same
 * collapse behaviour they're used to seeing on every other thread.
 *
 * `originalBodyHtml` is the sanitized HTML of the message we're
 * replying to (typically from `metadata.bodyHtml`). When that's
 * absent we fall back to wrapping `originalBodyPlain` in
 * `<pre>` — better than nothing, and rare in practice now that
 * the connector persists `bodyHtml` on every ingest.
 */
export function buildHtmlQuotedReply(args: {
  /** User-authored reply HTML (from the rich editor). */
  draftHtml: string;
  originalSender: string | null | undefined;
  originalDate: string | Date | null | undefined;
  originalBodyHtml: string | null | undefined;
  originalBodyPlain: string | null | undefined;
}): string {
  const { draftHtml, originalSender, originalDate, originalBodyHtml, originalBodyPlain } = args;
  const sender = (originalSender ?? "").trim() || "the sender";
  const dateStr = originalDate ? formatAbsoluteTime(originalDate) : "";
  const header = dateStr ? `On ${dateStr}, ${sender} wrote:` : `${sender} wrote:`;
  const safeHeader = escapeHtml(header);

  const inner = originalBodyHtml && originalBodyHtml.trim().length > 0
    ? originalBodyHtml
    : originalBodyPlain
      ? `<pre>${escapeHtml(originalBodyPlain)}</pre>`
      : "";

  if (!inner) return draftHtml ?? "";

  // gmail_quote class triggers Gmail's "..." collapse on the recipient
  // side. Inline style as a belt-and-suspenders for clients that
  // ignore the class hook.
  const quoted = `<div class="gmail_quote_attribution">${safeHeader}</div>` +
    `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">` +
    inner +
    `</blockquote>`;

  return `${draftHtml ?? ""}<br><br>${quoted}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert HTML to a clean plain-text fallback for the
 * `multipart/alternative` `text/plain` part. We never trust the
 * sender's plain version (some senders ship CSS-leaked junk), and
 * recipients on text-only clients shouldn't see HTML markup.
 *
 * This is intentionally minimal — it's not meant to preserve layout,
 * just produce something readable. For richer conversion we'd reach
 * for `html-to-text`; the bundle cost isn't worth it for replies.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    // Block-level boundaries → newline before strip.
    .replace(/<\/(p|div|h[1-6]|li|tr|br|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    // Strip remaining tags.
    .replace(/<[^>]+>/g, "")
    // Decode the common entities (DOMPurify already keeps these
    // valid; we just unescape so plain readers see real characters).
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Case-insensitive client-side search over a thread. Matches against
 * subject + from + body + classification of every message in the
 * thread (so a thread surfaces if any reply contains the query).
 */
export function threadMatchesQuery<T extends ThreadingItem & {
  subject?: string;
  from?: string | null;
  body?: string | null;
}>(thread: Thread<T>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return thread.items.some((item) => {
    const fields: string[] = [];
    if (item.subject) fields.push(item.subject);
    if (item.from) fields.push(item.from);
    if (item.body) fields.push(item.body);
    const triage = readTriage(item);
    if (triage) fields.push(triage.classification, triage.rationale);
    return fields.some((f) => f.toLowerCase().includes(q));
  });
}

/** Tailwind dot color for a score badge. */
export function scoreDotClass(tier: ScoreTier): string {
  switch (tier) {
    case "high":
      return "bg-emerald-500";
    case "medium":
      return "bg-amber-500";
    case "low":
      return "bg-muted";
    case "muted":
      return "bg-border";
  }
}

/**
 * Compact relative-time string for list rows. Exact phrasing chosen so
 * the column never overflows ~36 px:
 *   "now" (<60 s)
 *   "Nm"  (1-59 min)
 *   "Nh"  (1-23 h)
 *   "Nd"  (1-6 d)
 *   "Mon 3"  (≥7 d, current year — abbreviated month + day)
 *   "May 3 2025"  (different year)
 */
export function formatRelativeTime(
  raw: string | Date,
  now: Date = new Date(),
): string {
  const d = typeof raw === "string" ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = now.getTime() - d.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (d.getFullYear() === now.getFullYear()) {
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }
  return `${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

/**
 * Detail-pane absolute time. Includes weekday + time when within the
 * current week; else date + year.
 */
export function formatAbsoluteTime(
  raw: string | Date,
  now: Date = new Date(),
): string {
  const d = typeof raw === "string" ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === now.getFullYear();
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  };
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

/**
 * Pull a display name out of an RFC-2822 `From:` value:
 *   `"Jordan Cohen" <jordan@cohenlee.example>` → `Jordan Cohen`
 *   `Jordan Cohen <jordan@…>`                  → `Jordan Cohen`
 *   `jordan@…`                                 → `jordan@…`
 *   null/undefined                             → `(unknown sender)`
 */
export function parseSenderName(raw: string | null | undefined): string {
  if (!raw) return "(unknown sender)";
  const trimmed = raw.trim();
  // Quoted name: "Display Name" <email>
  const quoted = /^"([^"]+)"\s*<.+>/.exec(trimmed);
  if (quoted && quoted[1]) return quoted[1].trim();
  // Bare name: Display Name <email>
  const bare = /^([^<]+?)\s*<.+>/.exec(trimmed);
  if (bare && bare[1]) return bare[1].trim();
  return trimmed;
}

/**
 * Single-line snippet for list rows. Strips any HTML tags, collapses
 * whitespace, drops Gmail's `>` quote markers, truncates to ~120 chars.
 */
export function snippetFrom(body: string, maxChars = 120): string {
  const stripped = body
    .replace(/<[^>]+>/g, " ") // strip HTML tags
    .replace(/^>.*$/gm, "")    // drop quoted lines (>)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= maxChars) return stripped;
  return stripped.slice(0, maxChars - 1).trimEnd() + "…";
}
