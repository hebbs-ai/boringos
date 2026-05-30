// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ConnectorDefinition for Microsoft 365 (OAuth2, multi-service, Graph).

import type { ConnectorDefinition } from "@boringos/module-sdk";
import {
  mailService,
  calendarService,
  contactsService,
  filesService,
  PROFILE_SCOPES,
} from "./scopes.js";

// The `/common` authority accepts both work/school (Azure AD) and personal
// Microsoft accounts. Use `/organizations` to restrict to Azure AD tenants,
// or `/<tenant-id>` to lock to a single tenant.
const AUTHORITY = "https://login.microsoftonline.com/common";

export const microsoftConnector: ConnectorDefinition = {
  provider: "microsoft",
  displayName: "Microsoft 365",
  version: 1,
  auth: [
    {
      type: "oauth2",
      authorizationUrl: `${AUTHORITY}/oauth2/v2.0/authorize`,
      tokenUrl: `${AUTHORITY}/oauth2/v2.0/token`,
      clientIdEnv: "MICROSOFT_CLIENT_ID",
      clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
      // Refresh tokens come from the `offline_access` scope (declared in
      // requiredScopes), not from an accessType param. Prompt for consent so
      // newly-added service scopes re-trigger the consent screen.
      prompt: "consent",
    },
  ],
  services: [mailService, calendarService, contactsService, filesService],
  requiredScopes: PROFILE_SCOPES,
  // Microsoft id_token claims: `email` is not always present, so fall back to
  // `preferred_username` (UPN), then the stable object id (`oid`) / `sub`.
  resolveAccountId: (tokenResponse) =>
    String(
      tokenResponse["email"] ??
        tokenResponse["preferred_username"] ??
        tokenResponse["oid"] ??
        tokenResponse["sub"],
    ),
};
