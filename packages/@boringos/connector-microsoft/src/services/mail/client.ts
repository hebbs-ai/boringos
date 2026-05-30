// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed MailClient. Wraps the Microsoft Graph v1.0 mail surface
// (/me/messages, /me/mailFolders, /me/sendMail). Accepts a TokenSource so
// callers can pass either a static string or an async token-provider
// function; uses fetchWithAuth for free 401 retry.
//
// Unlike Gmail, Graph sends mail as structured JSON, so there is no MIME
// builder here. `sendMail`/`reply` return 202 Accepted with no body, so
// those methods resolve to void.

import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { MailMessage, MailFolder, Recipient } from "./types.js";

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";

const MESSAGE_FIELDS =
  "id,conversationId,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,webLink,categories,parentFolderId";

function toRecipients(addresses: string): Recipient[] {
  return addresses
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

export class MailClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listMessages(opts?: {
    query?: string;
    filter?: string;
    top?: number;
    folderId?: string;
  }): Promise<MailMessage[]> {
    const params = new URLSearchParams({ $select: MESSAGE_FIELDS });
    if (opts?.top) params.set("$top", String(opts.top));
    if (opts?.filter) params.set("$filter", opts.filter);
    if (opts?.query) {
      // $search and $orderby are mutually exclusive in Graph.
      params.set("$search", `"${opts.query}"`);
    } else {
      params.set("$orderby", "receivedDateTime desc");
    }
    const base = opts?.folderId
      ? `${GRAPH_API}/mailFolders/${encodeURIComponent(opts.folderId)}/messages`
      : `${GRAPH_API}/messages`;
    const url = `${base}?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Mail listMessages failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { value?: MailMessage[] };
    return body.value ?? [];
  }

  async getMessage(messageId: string): Promise<MailMessage> {
    const url = `${GRAPH_API}/messages/${encodeURIComponent(messageId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Mail getMessage failed: ${res.status}`);
    return (await res.json()) as MailMessage;
  }

  async sendEmail(opts: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bodyType?: "text" | "html";
    saveToSentItems?: boolean;
  }): Promise<void> {
    const url = `${GRAPH_API}/sendMail`;
    const message: Record<string, unknown> = {
      subject: opts.subject,
      body: { contentType: opts.bodyType ?? "text", content: opts.body },
      toRecipients: toRecipients(opts.to),
    };
    if (opts.cc) message["ccRecipients"] = toRecipients(opts.cc);
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: opts.saveToSentItems ?? true }),
    });
    if (!res.ok) throw new Error(`Mail sendEmail failed: ${res.status} ${await res.text()}`);
  }

  async replyToEmail(opts: {
    messageId: string;
    body: string;
    replyAll?: boolean;
  }): Promise<void> {
    const action = opts.replyAll ? "replyAll" : "reply";
    const url = `${GRAPH_API}/messages/${encodeURIComponent(opts.messageId)}/${action}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: opts.body }),
    });
    if (!res.ok) throw new Error(`Mail replyToEmail failed: ${res.status}`);
  }

  async markRead(messageId: string, isRead = true): Promise<void> {
    const url = `${GRAPH_API}/messages/${encodeURIComponent(messageId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead }),
    });
    if (!res.ok) throw new Error(`Mail markRead failed: ${res.status}`);
  }

  async moveMessage(messageId: string, destinationId: string): Promise<MailMessage> {
    const url = `${GRAPH_API}/messages/${encodeURIComponent(messageId)}/move`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destinationId }),
    });
    if (!res.ok) throw new Error(`Mail moveMessage failed: ${res.status}`);
    return (await res.json()) as MailMessage;
  }

  // Moves a message to the well-known "archive" folder. Parallels Gmail's
  // archiveMessage (which removes the INBOX label).
  async archiveMessage(messageId: string): Promise<MailMessage> {
    return this.moveMessage(messageId, "archive");
  }

  async searchMessages(query: string, opts?: { top?: number }): Promise<MailMessage[]> {
    return this.listMessages({ query, top: opts?.top });
  }

  async listFolders(): Promise<MailFolder[]> {
    const url = `${GRAPH_API}/mailFolders?$top=100`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Mail listFolders failed: ${res.status}`);
    const body = (await res.json()) as { value?: MailFolder[] };
    return body.value ?? [];
  }
}
