// Local type — the v1 connector framework was deleted.
export interface ActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

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

export class GmailClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case "list_emails": return this.listEmails(inputs.query as string | undefined, inputs.maxResults as number | undefined);
      case "read_email": return this.readEmail(inputs.messageId as string);
      case "send_email": return this.sendEmail(inputs.to as string, inputs.subject as string, inputs.body as string);
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
        inputs.body as string,
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
          if (!fullRes.ok) return { id: msg.id, threadId: msg.threadId, subject: null, from: null, body: null, bodyHtml: null, snippet: null, date: null };

          const fullData = await fullRes.json() as {
            id: string;
            threadId: string;
            snippet?: string;
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
          };
        } catch {
          return { id: msg.id, threadId: msg.threadId, subject: null, from: null, body: null, bodyHtml: null, snippet: null, date: null };
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
    body: string,
  ): Promise<ActionResult> {
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${replySubject}\r\nIn-Reply-To: ${messageId}\r\nReferences: ${messageId}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString("base64url");

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

  private async sendEmail(to: string, subject: string, body: string): Promise<ActionResult> {
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString("base64url");

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
