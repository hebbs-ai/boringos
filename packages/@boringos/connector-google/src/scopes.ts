// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Google OAuth scope constants and per-service definitions.

import type { ServiceDefinition, ScopeDefinition } from "@boringos/module-sdk";

export const GMAIL_SCOPES: ScopeDefinition[] = [
  { scope: "https://www.googleapis.com/auth/gmail.modify", description: "Read and modify emails", required: true },
  { scope: "https://www.googleapis.com/auth/gmail.send", description: "Send emails", required: true },
];

export const CALENDAR_SCOPES: ScopeDefinition[] = [
  { scope: "https://www.googleapis.com/auth/calendar", description: "Manage calendar events", required: true },
];

export const CONTACTS_SCOPES: ScopeDefinition[] = [
  { scope: "https://www.googleapis.com/auth/contacts.readonly", description: "Read contacts", required: true },
];

export const DRIVE_SCOPES: ScopeDefinition[] = [
  { scope: "https://www.googleapis.com/auth/drive.readonly", description: "Read files from Drive", required: true },
];

export const PROFILE_SCOPES: ScopeDefinition[] = [
  { scope: "openid", description: "OpenID Connect", required: true },
  { scope: "email", description: "View email address", required: true },
  { scope: "profile", description: "View profile", required: true },
];

export const gmailService: ServiceDefinition = {
  id: "gmail",
  displayName: "Gmail",
  scopes: GMAIL_SCOPES,
};

export const calendarService: ServiceDefinition = {
  id: "calendar",
  displayName: "Google Calendar",
  scopes: CALENDAR_SCOPES,
};

export const contactsService: ServiceDefinition = {
  id: "contacts",
  displayName: "Google Contacts",
  scopes: CONTACTS_SCOPES,
};

export const driveService: ServiceDefinition = {
  id: "drive",
  displayName: "Google Drive",
  scopes: DRIVE_SCOPES,
};

// Identity scopes are always required for OAuth to know which account
// authorized. The id_token JWT carries email/sub claims which are read
// by resolveAccountId. Included as a hidden "profile" service so the
// scope flattener picks them up alongside whatever services the module declares.
export const profileService: ServiceDefinition = {
  id: "profile",
  displayName: "Google Account Identity",
  scopes: PROFILE_SCOPES,
};
