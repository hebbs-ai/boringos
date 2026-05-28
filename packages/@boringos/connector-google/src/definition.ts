// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ConnectorDefinition for Google Workspace (OAuth2, multi-service).

import type { ConnectorDefinition } from "@boringos/module-sdk";
import { gmailService, calendarService, contactsService, driveService, profileService } from "./scopes.js";

export const googleConnector: ConnectorDefinition = {
  provider: "google",
  displayName: "Google Workspace",
  version: 1,
  auth: [
    {
      type: "oauth2",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientIdEnv: "GOOGLE_CLIENT_ID",
      clientSecretEnv: "GOOGLE_CLIENT_SECRET",
      accessType: "offline",
      prompt: "consent",
    },
  ],
  // profileService is always present so OAuth always receives openid/email/profile
  // and the id_token has identity claims for resolveAccountId.
  services: [profileService, gmailService, calendarService, contactsService, driveService],
  resolveAccountId: (tokenResponse) =>
    String(tokenResponse["email"] ?? tokenResponse["sub"]),
};
