// SPDX-License-Identifier: AGPL-3.0-or-later

// Connector definition
export { microsoftConnector } from "./definition.js";

// Service definitions (for module manifest declarations)
export { mailService, calendarService, contactsService, filesService } from "./scopes.js";

// Scope constants
export {
  MAIL_SCOPES,
  CALENDAR_SCOPES,
  CONTACTS_SCOPES,
  FILES_SCOPES,
  PROFILE_SCOPES,
} from "./scopes.js";

// Typed clients
export { MailClient } from "./services/mail/index.js";
export { CalendarClient } from "./services/calendar/index.js";
export { ContactsClient } from "./services/contacts/index.js";
export { FilesClient } from "./services/files/index.js";

// Service types
export type { MailMessage, MailFolder, EmailAddress, Recipient, ItemBody } from "./services/mail/index.js";
export type { CalendarEvent, FreeBusySlot, Attendee, DateTimeTimeZone } from "./services/calendar/index.js";
export type { Contact, Person } from "./services/contacts/index.js";
export type { DriveItem } from "./services/files/index.js";

// Helpers
export { fetchWithAuth, resolveToken, type TokenSource } from "./helpers.js";
