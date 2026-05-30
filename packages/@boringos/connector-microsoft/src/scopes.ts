// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Microsoft Graph OAuth scope constants and per-service definitions.
//
// Scopes use the fully-qualified Graph permission URL form
// (https://graph.microsoft.com/<Permission>). Microsoft also accepts the
// short form (e.g. "Mail.ReadWrite"); the fully-qualified form is used here
// to match Google's convention of fully-qualified scope strings and to be
// unambiguous about the resource.

import type { ServiceDefinition, ScopeDefinition } from "@boringos/module-sdk";

const GRAPH = "https://graph.microsoft.com";

export const MAIL_SCOPES: ScopeDefinition[] = [
  { scope: `${GRAPH}/Mail.ReadWrite`, description: "Read and modify mail", required: true },
  { scope: `${GRAPH}/Mail.Send`, description: "Send mail", required: true },
];

export const CALENDAR_SCOPES: ScopeDefinition[] = [
  { scope: `${GRAPH}/Calendars.ReadWrite`, description: "Manage calendar events", required: true },
];

export const CONTACTS_SCOPES: ScopeDefinition[] = [
  { scope: `${GRAPH}/Contacts.Read`, description: "Read contacts", required: true },
  { scope: `${GRAPH}/People.Read`, description: "Read relevant people", required: false },
];

export const FILES_SCOPES: ScopeDefinition[] = [
  { scope: `${GRAPH}/Files.Read`, description: "Read files from OneDrive", required: true },
];

// Identity + refresh scopes. Microsoft issues refresh tokens only when
// `offline_access` is requested (the equivalent of Google's
// `accessType: "offline"`). `openid email profile` populate the id_token
// claims read by `resolveAccountId`. These are placed on
// `microsoftConnector.requiredScopes` so the host's OAuth flow always merges
// them in regardless of which services a module selects.
export const PROFILE_SCOPES: ScopeDefinition[] = [
  { scope: "openid", description: "OpenID Connect", required: true },
  { scope: "email", description: "View email address", required: true },
  { scope: "profile", description: "View profile", required: true },
  { scope: "offline_access", description: "Maintain access (refresh tokens)", required: true },
];

export const mailService: ServiceDefinition = {
  id: "mail",
  displayName: "Outlook Mail",
  scopes: MAIL_SCOPES,
};

export const calendarService: ServiceDefinition = {
  id: "calendar",
  displayName: "Outlook Calendar",
  scopes: CALENDAR_SCOPES,
};

export const contactsService: ServiceDefinition = {
  id: "contacts",
  displayName: "Outlook Contacts",
  scopes: CONTACTS_SCOPES,
};

export const filesService: ServiceDefinition = {
  id: "files",
  displayName: "OneDrive",
  scopes: FILES_SCOPES,
};
