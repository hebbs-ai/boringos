// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ConnectorDefinition } from "@boringos/module-sdk";
import { messagingService, channelsService, reactionsService } from "./scopes.js";

export const slackConnector: ConnectorDefinition = {
  provider: "slack",
  displayName: "Slack",
  version: 1,
  auth: [
    {
      type: "oauth2",
      authorizationUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      clientIdEnv: "SLACK_CLIENT_ID",
      clientSecretEnv: "SLACK_CLIENT_SECRET",
    },
    { type: "bot-token" },
  ],
  services: [messagingService, channelsService, reactionsService],
  resolveAccountId: (tokenResponse) => {
    const team = (tokenResponse.team as { id?: string } | undefined)?.id;
    const user = (tokenResponse.authed_user as { id?: string } | undefined)?.id;
    return user ? `${team ?? "unknown"}:${user}` : (team ?? "unknown");
  },
};
