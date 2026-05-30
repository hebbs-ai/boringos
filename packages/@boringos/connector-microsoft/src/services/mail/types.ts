// SPDX-License-Identifier: AGPL-3.0-or-later

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface Recipient {
  emailAddress: EmailAddress;
}

export interface ItemBody {
  contentType: "text" | "html";
  content: string;
}

// A Microsoft Graph message resource (subset of fields the client surfaces).
// https://learn.microsoft.com/graph/api/resources/message
export interface MailMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: ItemBody;
  from?: Recipient;
  sender?: Recipient;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
  categories?: string[];
  parentFolderId?: string;
  internetMessageId?: string;
}

export interface MailFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount?: number;
  unreadItemCount?: number;
  totalItemCount?: number;
}
