// SPDX-License-Identifier: AGPL-3.0-or-later

export { slackConnector } from "./definition.js";
export { messagingService, channelsService, reactionsService } from "./scopes.js";
export { MESSAGING_SCOPES, CHANNELS_SCOPES, REACTIONS_SCOPES } from "./scopes.js";

export { MessagingClient } from "./services/messaging/index.js";
export { ReactionsClient } from "./services/reactions/index.js";
export { ChannelsClient } from "./services/channels/index.js";

export type { SlackMessage } from "./services/messaging/index.js";
export type { Channel } from "./services/channels/index.js";

export { fetchSlack, resolveToken, type TokenSource } from "./helpers.js";
