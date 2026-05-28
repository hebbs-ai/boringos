// SPDX-License-Identifier: AGPL-3.0-or-later

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload?: {
    headers: { name: string; value: string }[];
    body?: { data?: string; size: number };
    parts?: unknown[];
  };
  internalDate: string;
}

export interface Thread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

export interface HistoryEvent {
  id: string;
  messages?: GmailMessage[];
  messagesAdded?: { message: GmailMessage }[];
  labelsAdded?: { message: GmailMessage; labelIds: string[] }[];
  labelsRemoved?: { message: GmailMessage; labelIds: string[] }[];
}

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
