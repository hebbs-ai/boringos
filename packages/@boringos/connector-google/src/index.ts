// SPDX-License-Identifier: AGPL-3.0-or-later

// Connector definition
export { googleConnector } from "./definition.js";

// Service definitions (for module manifest declarations)
export { gmailService, calendarService, contactsService, driveService } from "./scopes.js";

// Scope constants
export { GMAIL_SCOPES, CALENDAR_SCOPES, CONTACTS_SCOPES, DRIVE_SCOPES, PROFILE_SCOPES } from "./scopes.js";

// Typed clients (canonical names; formerly exported as GmailClientV2 / CalendarClientV2)
export { GmailClient } from "./services/gmail/index.js";
export { CalendarClient } from "./services/calendar/index.js";
export { PeopleClient } from "./services/contacts/index.js";
export { DriveClient } from "./services/drive/index.js";

// Service types
export type { GmailMessage, Thread, HistoryEvent, EmailHeaders } from "./services/gmail/index.js";
export type { CalendarEvent, FreeBusySlot } from "./services/calendar/index.js";
export type { Contact, ContactGroup } from "./services/contacts/index.js";
export type { DriveFile } from "./services/drive/index.js";

// Helpers
export { fetchWithAuth, resolveToken, type TokenSource } from "./helpers.js";

// MIME helpers (used by the typed GmailClient internally; re-exported for
// consumers that build raw MIME outside the client).
export { buildOutgoingMime, encodeQuotedPrintable } from "./gmail-client.js";
