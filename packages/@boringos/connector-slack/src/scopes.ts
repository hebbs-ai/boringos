// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ServiceDefinition, ScopeDefinition } from "@boringos/module-sdk";

export const MESSAGING_SCOPES: ScopeDefinition[] = [
  { scope: "chat:write", description: "Send messages", required: true },
];

export const CHANNELS_SCOPES: ScopeDefinition[] = [
  { scope: "channels:read", description: "Read public channels", required: true },
  { scope: "groups:read", description: "Read private channels", required: false },
];

export const REACTIONS_SCOPES: ScopeDefinition[] = [
  { scope: "reactions:write", description: "Add reactions", required: true },
  { scope: "reactions:read", description: "Read reactions", required: false },
];

export const messagingService: ServiceDefinition = {
  id: "messaging",
  displayName: "Slack Messaging",
  scopes: MESSAGING_SCOPES,
};

export const channelsService: ServiceDefinition = {
  id: "channels",
  displayName: "Slack Channels",
  scopes: CHANNELS_SCOPES,
};

export const reactionsService: ServiceDefinition = {
  id: "reactions",
  displayName: "Slack Reactions",
  scopes: REACTIONS_SCOPES,
};
