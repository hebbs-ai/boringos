// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Built-in Slack module. Thin wrapper exposing send_message,
// reply_in_thread, and add_reaction tools using the
// @boringos/connector-slack SDK.

import type { ModuleFactory } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import {
  MessagingClient,
  ReactionsClient,
  messagingService,
  reactionsService,
} from "@boringos/connector-slack";

const MODULE_ID = "slack";

const notConnected = () => ({
  ok: false as const,
  error: { code: "not_found" as const, message: "Slack account not connected", retryable: false },
});

const upstreamFail = (err: unknown) => ({
  ok: false as const,
  error: {
    code: "upstream_unavailable" as const,
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  },
});

export const createSlackModule: ModuleFactory = (deps) => ({
  id: MODULE_ID,
  name: "Slack",
  version: "2.0.0",
  description: "Default Slack messaging tools, wrapping @boringos/connector-slack",
  kind: "connector",
  connectors: {
    slack: { services: [messagingService, reactionsService] },
  },
  tools: [
    {
      name: "send_message",
      description: "Post a message to a Slack channel",
      inputs: z.object({ channel: z.string(), text: z.string() }),
      async handler(input: { channel: string; text: string }) {
        const conn = await deps.getConnectorToken?.("slack", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const client = new MessagingClient(conn.getToken);
          const result = await client.sendMessage(input);
          return { ok: true as const, result };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "reply_in_thread",
      description: "Reply to a Slack message in its thread",
      inputs: z.object({ channel: z.string(), thread_ts: z.string(), text: z.string() }),
      async handler(input: { channel: string; thread_ts: string; text: string }) {
        const conn = await deps.getConnectorToken?.("slack", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const client = new MessagingClient(conn.getToken);
          const result = await client.replyInThread(input);
          return { ok: true as const, result };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "add_reaction",
      description: "React to a Slack message with an emoji",
      inputs: z.object({ channel: z.string(), timestamp: z.string(), name: z.string() }),
      async handler(input: { channel: string; timestamp: string; name: string }) {
        const conn = await deps.getConnectorToken?.("slack", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const client = new ReactionsClient(conn.getToken);
          await client.addReaction(input);
          return { ok: true as const, result: { added: true } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
  ],
  skills: [],
});
