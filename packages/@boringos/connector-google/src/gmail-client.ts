// Local connector-protocol types (formerly in /connector).
export interface ActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Email headers that signal automated / bulk mail. Surfaced on every
 * message so downstream code (forward-sync, triage prefilter, agents)
 * can decide whether to treat the message as human-authored without
 * re-reading the raw payload. Keys mirror the canonical RFC names
 * lowercased; values are the raw header string when present.
 *
 * `messageId`, `inReplyTo`, `references` are tracked so threading
 * decisions don't re-fetch the message.
 */
export interface EmailHeaders {
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
  listId: string | null;
  autoSubmitted: string | null;
  precedence: string | null;
  returnPath: string | null;
  replyTo: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
}

function emptyHeaders(): EmailHeaders {
  return {
    listUnsubscribe: null,
    listUnsubscribePost: null,
    listId: null,
    autoSubmitted: null,
    precedence: null,
    returnPath: null,
    replyTo: null,
    messageId: null,
    inReplyTo: null,
    references: null,
  };
}

function extractEmailHeaders(
  rawHeaders: Array<{ name: string; value: string }> | undefined,
): EmailHeaders {
  if (!rawHeaders || rawHeaders.length === 0) return emptyHeaders();
  const get = (name: string) =>
    rawHeaders.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value
      ?? null;
  return {
    listUnsubscribe: get("List-Unsubscribe"),
    listUnsubscribePost: get("List-Unsubscribe-Post"),
    listId: get("List-Id"),
    autoSubmitted: get("Auto-Submitted"),
    precedence: get("Precedence"),
    returnPath: get("Return-Path"),
    replyTo: get("Reply-To"),
    messageId: get("Message-ID") ?? get("Message-Id"),
    inReplyTo: get("In-Reply-To"),
    references: get("References"),
  };
}

/** Decode a base64url-encoded Gmail body part to UTF-8 text. */
function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

type GmailPayload = {
  body?: { data?: string };
  mimeType?: string;
  parts?: Array<{ mimeType: string; body?: { data?: string }; parts?: Array<{ mimeType: string; body?: { data?: string } }> }>;
};

/** Extract both plain-text and HTML bodies from a Gmail message payload. */
function extractBodies(
  payload?: GmailPayload,
): { plain: string | null; html: string | null } {
  if (!payload) return { plain: null, html: null };

  // Single-part message — body is directly on the payload
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/html") {
      return { plain: null, html: decoded };
    }
    return { plain: decoded, html: null };
  }

  if (!payload.parts) return { plain: null, html: null };

  // Multipart — collect both text/plain and text/html
  let plain: string | null = null;
  let html: string | null = null;

  for (const part of payload.parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      plain = decodeBase64Url(part.body.data);
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html = decodeBase64Url(part.body.data);
    }
    // Nested multipart (e.g. multipart/alternative inside multipart/mixed)
    if (part.parts) {
      for (const sub of part.parts) {
        if (sub.mimeType === "text/plain" && sub.body?.data && !plain) {
          plain = decodeBase64Url(sub.body.data);
        } else if (sub.mimeType === "text/html" && sub.body?.data && !html) {
          html = decodeBase64Url(sub.body.data);
        }
      }
    }
  }

  return { plain, html };
}

/** Extract the best plain-text body from a Gmail message payload. Backward-compatible wrapper. */
function extractBody(
  payload?: GmailPayload,
): string | null {
  const { plain, html } = extractBodies(payload);
  return plain ?? html ?? null;
}

/**
 * Build an outgoing MIME message for Gmail's `messages.send`. Returns
 * a UTF-8 string the caller base64url-encodes.
 *
 * Shape decisions:
 *   - Default to `multipart/alternative` when both HTML and plain are
 *     provided so any client renders something correct (Gmail picks
 *     HTML, text-only clients fall back to plain).
 *   - Single-part `text/html` or `text/plain` when only one is given —
 *     we never invent the missing alternative on the connector side
 *     because the caller has more context for derivation (the shell
 *     uses `htmlToPlainText`; agents that send plain skip HTML).
 *   - Quoted-printable bodies for both parts so non-ASCII (em-dashes,
 *     smart quotes, accents — common in real replies) survives the
 *     8bit-MIME boundary without mojibake on older clients.
 *
 * The returned string uses CRLF as RFC 5322 mandates.
 */
export function buildOutgoingMime(args: {
  to: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const { to, subject, bodyText, bodyHtml, inReplyTo, references } = args;

  const headers: string[] = [];
  headers.push(`To: ${to}`);
  headers.push(`Subject: ${encodeMimeHeader(subject)}`);
  headers.push("MIME-Version: 1.0");
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  // Prefer multipart when we have both. Falls back to single-part
  // for callers that only supply one side.
  const hasHtml = typeof bodyHtml === "string" && bodyHtml.length > 0;
  const hasText = typeof bodyText === "string" && bodyText.length > 0;

  if (hasHtml && hasText) {
    const boundary = `=_b_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      encodeQuotedPrintable(bodyText!),
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      encodeQuotedPrintable(bodyHtml!),
      `--${boundary}--`,
      "",
    ];
    return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n");
  }

  if (hasHtml) {
    headers.push("Content-Type: text/html; charset=utf-8");
    headers.push("Content-Transfer-Encoding: quoted-printable");
    return headers.join("\r\n") + "\r\n\r\n" + encodeQuotedPrintable(bodyHtml!);
  }

  // Default: text/plain, even when bodyText is missing — produces an
  // empty message instead of a header-only MIME (some MTAs reject the
  // latter).
  headers.push("Content-Type: text/plain; charset=utf-8");
  headers.push("Content-Transfer-Encoding: quoted-printable");
  return headers.join("\r\n") + "\r\n\r\n" + encodeQuotedPrintable(bodyText ?? "");
}

/**
 * Quoted-printable encode per RFC 2045 §6.7. Encodes:
 *   - Bytes outside printable ASCII (33–60, 62–126), incl. `=` itself
 *   - Trailing whitespace on each line
 *   - CRLF preserved as a hard line break
 * And soft-wraps lines longer than 76 chars with `=\r\n`.
 *
 * Why this and not raw 8bit / base64:
 *   - Raw 8bit breaks older relays
 *   - Base64 makes the body unreadable in raw view, hurts debugging
 *   - QP keeps ASCII-mostly bodies legible while staying RFC-safe
 */
export function encodeQuotedPrintable(input: string): string {
  // Turn JS strings into UTF-8 bytes, then encode each byte.
  const bytes = Buffer.from(input.replace(/\r?\n/g, "\r\n"), "utf-8");
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // CR/LF pair → preserve as a hard line break.
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      out.push("\r\n");
      i++;
      continue;
    }
    // Tab + space stay literal except at end-of-line (handled below).
    if (b === 0x09 || b === 0x20) {
      out.push(String.fromCharCode(b));
      continue;
    }
    // Printable ASCII range, excluding `=`.
    if (b >= 0x21 && b <= 0x7e && b !== 0x3d) {
      out.push(String.fromCharCode(b));
      continue;
    }
    // Everything else → =XX.
    out.push("=" + b.toString(16).toUpperCase().padStart(2, "0"));
  }
  let encoded = out.join("");

  // Encode trailing whitespace on each line — RFC requires it.
  encoded = encoded.replace(/([ \t])(?=\r\n|$)/g, (m) =>
    m === " " ? "=20" : "=09",
  );

  // Soft-wrap lines longer than 76 chars (75 + soft-break).
  const wrapped: string[] = [];
  for (const line of encoded.split("\r\n")) {
    let remaining = line;
    while (remaining.length > 75) {
      // Don't split a `=XX` triplet across the soft break.
      let breakAt = 75;
      if (remaining.charAt(breakAt - 1) === "=") breakAt = 74;
      else if (remaining.charAt(breakAt - 2) === "=") breakAt = 73;
      wrapped.push(remaining.slice(0, breakAt) + "=");
      remaining = remaining.slice(breakAt);
    }
    wrapped.push(remaining);
  }
  return wrapped.join("\r\n");
}

/**
 * Encode a header value with non-ASCII characters using RFC 2047
 * encoded-words. Subjects with accents / em-dashes / emoji break
 * without this; pure-ASCII subjects pass through unchanged so the
 * raw form stays readable in inspection tools.
 */
function encodeMimeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7f]/.test(value)) return value;
  const b64 = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

export class GmailClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case "list_emails": return this.listEmails(inputs.query as string | undefined, inputs.maxResults as number | undefined);
      case "read_email": return this.readEmail(inputs.messageId as string);
      case "send_email": return this.sendEmail(
        inputs.to as string,
        inputs.subject as string,
        // New callers pass `bodyHtml` + `bodyText` (preferred — produces
        // multipart/alternative). Old callers pass plain `body`. Either
        // shape works; the builder picks the richer one when available.
        {
          bodyText: (inputs.bodyText as string | undefined) ?? (inputs.body as string | undefined),
          bodyHtml: inputs.bodyHtml as string | undefined,
        },
      );
      case "search_emails": return this.listEmails(inputs.query as string, inputs.maxResults as number | undefined);
      case "get_thread": return this.getThread(inputs.threadId as string);
      case "archive_email": return this.archiveEmail(inputs.messageId as string);
      case "modify_email": return this.modifyEmail(
        inputs.messageId as string,
        (inputs.addLabelIds as string[] | undefined) ?? [],
        (inputs.removeLabelIds as string[] | undefined) ?? [],
      );
      case "ensure_label": return this.ensureLabel(inputs.name as string);
      case "list_history": return this.listHistory(
        inputs.startHistoryId as string,
        inputs.maxResults as number | undefined,
      );
      case "reply_email": return this.replyEmail(
        inputs.messageId as string,
        inputs.threadId as string,
        inputs.to as string,
        inputs.subject as string,
        {
          bodyText: (inputs.bodyText as string | undefined) ?? (inputs.body as string | undefined),
          bodyHtml: inputs.bodyHtml as string | undefined,
        },
      );
      default: return { success: false, error: `Unknown Gmail action: ${action}` };
    }
  }

  /**
   * Generic message-modify wrapper. Adds/removes labels on a Gmail
   * message. Used by Hebbs→Gmail sync to mirror archive / read /
   * unread / snooze state to the underlying Gmail message.
   */
  private async modifyEmail(
    messageId: string,
    addLabelIds: string[],
    removeLabelIds: string[],
  ): Promise<ActionResult> {
    if (!messageId) return { success: false, error: "messageId is required" };
    if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
      return { success: true, data: { id: messageId, noop: true } };
    }
    const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    });
    if (!res.ok) return { success: false, error: `Gmail modify failed: ${res.status}` };
    const data = (await res.json()) as Record<string, unknown>;
    return { success: true, data: { id: messageId, labelIds: data.labelIds } };
  }

  /**
   * Find a label by name; create it if missing. Used to lazily
   * provision the `Hebbs/Snoozed` label on first snooze.
   */
  private async ensureLabel(name: string): Promise<ActionResult> {
    if (!name) return { success: false, error: "name is required" };

    const listRes = await this.api(`${GMAIL_API}/labels`);
    if (!listRes.ok) {
      return { success: false, error: `Gmail labels list failed: ${listRes.status}` };
    }
    const listData = (await listRes.json()) as { labels?: Array<{ id: string; name: string }> };
    const existing = (listData.labels ?? []).find((l) => l.name === name);
    if (existing) {
      return { success: true, data: { id: existing.id, name: existing.name, created: false } };
    }

    const createRes = await fetch(`${GMAIL_API}/labels`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    });
    if (!createRes.ok) {
      return { success: false, error: `Gmail label create failed: ${createRes.status}` };
    }
    const created = (await createRes.json()) as { id: string; name: string };
    return { success: true, data: { id: created.id, name: created.name, created: true } };
  }

  /**
   * Reverse-sync: list label-added/-removed/-deleted events since
   * `startHistoryId`. Caller persists the returned `historyId` cursor
   * for the next call.
   */
  private async listHistory(
    startHistoryId: string,
    maxResults?: number,
  ): Promise<ActionResult> {
    if (!startHistoryId) return { success: false, error: "startHistoryId is required" };

    const allEvents: Array<{
      messageId: string;
      labelsAdded?: string[];
      labelsRemoved?: string[];
      deleted?: boolean;
    }> = [];
    let pageToken: string | undefined;
    let latestHistoryId = startHistoryId;
    let pages = 0;
    const max = maxResults ?? 500;

    do {
      const params = new URLSearchParams({ startHistoryId });
      params.set("historyTypes", "labelAdded");
      params.append("historyTypes", "labelRemoved");
      params.append("historyTypes", "messageDeleted");
      if (pageToken) params.set("pageToken", pageToken);

      const res = await this.api(`${GMAIL_API}/history?${params}`);
      if (!res.ok) {
        // 404 means startHistoryId is too old — caller should re-seed.
        return { success: false, error: `Gmail history failed: ${res.status}` };
      }
      const data = (await res.json()) as {
        history?: Array<{
          id: string;
          messages?: Array<{ id: string }>;
          labelsAdded?: Array<{ message: { id: string }; labelIds: string[] }>;
          labelsRemoved?: Array<{ message: { id: string }; labelIds: string[] }>;
          messagesDeleted?: Array<{ message: { id: string } }>;
        }>;
        historyId?: string;
        nextPageToken?: string;
      };

      for (const h of data.history ?? []) {
        if (h.id) latestHistoryId = h.id;
        for (const e of h.labelsAdded ?? []) {
          allEvents.push({ messageId: e.message.id, labelsAdded: e.labelIds });
        }
        for (const e of h.labelsRemoved ?? []) {
          allEvents.push({ messageId: e.message.id, labelsRemoved: e.labelIds });
        }
        for (const e of h.messagesDeleted ?? []) {
          allEvents.push({ messageId: e.message.id, deleted: true });
        }
      }
      if (data.historyId) latestHistoryId = data.historyId;
      pageToken = data.nextPageToken;
      pages += 1;
      if (allEvents.length >= max || pages >= 20) break;
    } while (pageToken);

    return {
      success: true,
      data: { events: allEvents, historyId: latestHistoryId },
    };
  }

  private async listEmails(query?: string, maxResults?: number): Promise<ActionResult> {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("maxResults", String(maxResults ?? 10));

    const res = await this.api(`${GMAIL_API}/messages?${params}`);
    if (!res.ok) return { success: false, error: `Gmail API error: ${res.status}` };

    const data = await res.json() as Record<string, unknown>;
    const rawMessages = (data.messages ?? []) as Array<{ id: string; threadId: string }>;

    // Enrich each message with full content (subject, from, body, date)
    const enriched = await Promise.all(
      rawMessages.map(async (msg) => {
        try {
          const fullRes = await this.api(
            `${GMAIL_API}/messages/${msg.id}?format=full`,
          );
          if (!fullRes.ok) return { id: msg.id, threadId: msg.threadId, subject: null, from: null, body: null, bodyHtml: null, snippet: null, date: null, labelIds: [] as string[] };

          const fullData = await fullRes.json() as {
            id: string;
            threadId: string;
            snippet?: string;
            labelIds?: string[];
            payload?: GmailPayload & {
              headers?: Array<{ name: string; value: string }>;
            };
          };

          const headers = fullData.payload?.headers ?? [];
          const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

          // Extract both plain and HTML body from payload
          const { plain, html } = extractBodies(fullData.payload);

          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: getHeader("Subject"),
            from: getHeader("From"),
            date: getHeader("Date"),
            body: plain ?? html,
            bodyHtml: html,
            snippet: fullData.snippet ?? null,
            labelIds: fullData.labelIds ?? [],
            headers: extractEmailHeaders(headers),
          };
        } catch {
          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: null,
            from: null,
            body: null,
            bodyHtml: null,
            snippet: null,
            date: null,
            labelIds: [] as string[],
            headers: emptyHeaders(),
          };
        }
      }),
    );

    return { success: true, data: { messages: enriched, resultSizeEstimate: data.resultSizeEstimate } };
  }

  private async readEmail(messageId: string): Promise<ActionResult> {
    const res = await this.api(`${GMAIL_API}/messages/${messageId}?format=full`);
    if (!res.ok) return { success: false, error: `Gmail API error: ${res.status}` };

    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: data as Record<string, unknown> };
  }

  private async getThread(threadId: string): Promise<ActionResult> {
    const res = await this.api(`${GMAIL_API}/threads/${threadId}?format=full`);
    if (!res.ok) return { success: false, error: `Gmail API error: ${res.status}` };

    const data = await res.json() as {
      id: string;
      messages?: Array<{
        id: string;
        threadId: string;
        snippet?: string;
        payload?: GmailPayload & {
          headers?: Array<{ name: string; value: string }>;
        };
      }>;
    };

    const messages = (data.messages ?? []).map((msg) => {
      const headers = msg.payload?.headers ?? [];
      const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
      const { plain, html } = extractBodies(msg.payload);

      return {
        id: msg.id,
        threadId: msg.threadId,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        date: getHeader("Date"),
        bodyPlain: plain,
        bodyHtml: html,
        snippet: msg.snippet ?? null,
        headers: extractEmailHeaders(headers),
      };
    });

    return { success: true, data: { threadId, messages } };
  }

  private async archiveEmail(messageId: string): Promise<ActionResult> {
    const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    });

    if (!res.ok) return { success: false, error: `Gmail archive failed: ${res.status}` };
    return { success: true, data: { id: messageId } };
  }

  private async replyEmail(
    messageId: string,
    threadId: string,
    to: string,
    subject: string,
    body: { bodyText?: string; bodyHtml?: string },
  ): Promise<ActionResult> {
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
    const mime = buildOutgoingMime({
      to,
      subject: replySubject,
      inReplyTo: messageId,
      references: messageId,
      bodyText: body.bodyText,
      bodyHtml: body.bodyHtml,
    });
    const raw = Buffer.from(mime, "utf-8").toString("base64url");

    const res = await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ raw, threadId }),
    });

    if (!res.ok) return { success: false, error: `Gmail reply failed: ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { id: data.id } };
  }

  private async sendEmail(
    to: string,
    subject: string,
    body: { bodyText?: string; bodyHtml?: string },
  ): Promise<ActionResult> {
    const mime = buildOutgoingMime({
      to,
      subject,
      bodyText: body.bodyText,
      bodyHtml: body.bodyHtml,
    });
    const raw = Buffer.from(mime, "utf-8").toString("base64url");

    const res = await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ raw }),
    });

    if (!res.ok) return { success: false, error: `Gmail send failed: ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { id: data.id } };
  }

  private api(url: string): Promise<Response> {
    return fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }
}
