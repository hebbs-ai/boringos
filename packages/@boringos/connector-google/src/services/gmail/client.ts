// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed GmailClient (v2). Uses fetchWithAuth for all HTTP calls,
// giving free 401 retry. Accepts a TokenSource so callers can pass
// either a static string or an async token-provider function.

import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { GmailMessage, Thread, HistoryEvent } from "./types.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listMessages(opts?: { query?: string; maxResults?: number; labelIds?: string[] }): Promise<GmailMessage[]> {
    const params = new URLSearchParams();
    if (opts?.query) params.set("q", opts.query);
    if (opts?.maxResults) params.set("maxResults", String(opts.maxResults));
    if (opts?.labelIds) opts.labelIds.forEach((id) => params.append("labelIds", id));
    const url = `${GMAIL_API}/messages?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Gmail listMessages failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { messages?: { id: string; threadId: string }[] };
    return (body.messages ?? []).map((m) => ({
      id: m.id,
      threadId: m.threadId,
      labelIds: [],
      snippet: "",
      internalDate: "",
    }));
  }

  async getMessage(messageId: string): Promise<GmailMessage> {
    const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Gmail getMessage failed: ${res.status}`);
    return (await res.json()) as GmailMessage;
  }

  async getThread(threadId: string): Promise<Thread> {
    const url = `${GMAIL_API}/threads/${encodeURIComponent(threadId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Gmail getThread failed: ${res.status}`);
    return (await res.json()) as Thread;
  }

  async sendEmail(opts: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ messageId: string }> {
    const { buildOutgoingMime } = await import("../../gmail-client.js");
    const raw = buildOutgoingMime({
      to: opts.to,
      subject: opts.subject,
      bodyText: opts.body,
      inReplyTo: opts.inReplyTo,
      references: opts.references,
    });
    const url = `${GMAIL_API}/messages/send`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
    });
    if (!res.ok) throw new Error(`Gmail sendEmail failed: ${res.status}`);
    const body = (await res.json()) as { id: string };
    return { messageId: body.id };
  }

  async replyToEmail(opts: { messageId: string; body: string }): Promise<{ messageId: string }> {
    const original = await this.getMessage(opts.messageId);
    const headers = original.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
    const inReplyTo = getHeader("Message-Id");
    const references = getHeader("References");
    const subject = getHeader("Subject") ?? "";
    const to = getHeader("Reply-To") ?? getHeader("From") ?? "";
    return this.sendEmail({
      to,
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      body: opts.body,
      inReplyTo,
      references: references ? `${references} ${inReplyTo}` : inReplyTo,
    });
  }

  async archiveMessage(messageId: string): Promise<void> {
    return this.modifyLabels(messageId, { removeLabelIds: ["INBOX"] });
  }

  async modifyLabels(
    messageId: string,
    opts: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ): Promise<void> {
    const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/modify`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`Gmail modifyLabels failed: ${res.status}`);
  }

  async searchMessages(query: string, opts?: { maxResults?: number }): Promise<GmailMessage[]> {
    return this.listMessages({ query, maxResults: opts?.maxResults });
  }

  async ensureLabel(name: string): Promise<{ labelId: string }> {
    const listUrl = `${GMAIL_API}/labels`;
    const listRes = await fetchWithAuth(this.getToken, this.fetchImpl, listUrl, { method: "GET" });
    if (!listRes.ok) throw new Error(`Gmail labels list failed: ${listRes.status}`);
    const list = (await listRes.json()) as { labels?: { id: string; name: string }[] };
    const existing = list.labels?.find((l) => l.name === name);
    if (existing) return { labelId: existing.id };
    const createRes = await fetchWithAuth(this.getToken, this.fetchImpl, listUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
    });
    if (!createRes.ok) throw new Error(`Gmail label create failed: ${createRes.status}`);
    const created = (await createRes.json()) as { id: string };
    return { labelId: created.id };
  }

  async listHistory(startHistoryId: string): Promise<HistoryEvent[]> {
    const params = new URLSearchParams({ startHistoryId });
    const url = `${GMAIL_API}/history?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Gmail listHistory failed: ${res.status}`);
    const body = (await res.json()) as { history?: HistoryEvent[] };
    return body.history ?? [];
  }
}
