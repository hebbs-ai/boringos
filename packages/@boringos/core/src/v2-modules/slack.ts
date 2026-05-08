// SPDX-License-Identifier: MIT
//
// `slack` connector Module — v2 wrapper around the existing
// SlackClient. Tools mirror v1's actions exactly (send_message,
// reply_in_thread, add_reaction); each handler looks up the
// tenant's stored credentials and delegates to the same client.
//
// Phase 7 of task_12. v1's `/api/connectors/actions/slack/*` route
// continues to work in parallel — additive parity.

import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors } from "@boringos/db";
import { SlackClient } from "@boringos/connector-slack";
import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";

const SLACK_SKILL = `Use the Slack tools to talk to channels the bot is in.

- \`slack.send_message(channel, text)\` — post a new message; returns the
  message's \`ts\` for threading
- \`slack.reply_in_thread(channel, threadTs, text)\` — reply under an
  existing message
- \`slack.add_reaction(channel, timestamp, emoji)\` — react with an emoji
  (no colons; e.g. \`thumbsup\`)

Conventions:
- Use reactions to acknowledge messages without creating noise.
- Reply in threads when responding to specific messages — keeps channels
  readable.
- The bot must be in a channel before it can post there. If you 401, the
  human needs to invite the bot first.

Slack mentions, message receipts, and reaction events arrive as inbound
events the framework can route to inbox or trigger workflows. You don't
fetch them through tools — they're pushed to you.`;

interface CredsRow {
  credentials: Record<string, unknown> | null;
}

async function loadSlackCreds(db: Db, tenantId: string): Promise<{ accessToken: string } | null> {
  const rows = await db
    .select({ credentials: connectors.credentials })
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, "slack")))
    .limit(1);
  const row = rows[0] as CredsRow | undefined;
  if (!row || !row.credentials) return null;
  const accessToken = row.credentials.accessToken;
  if (typeof accessToken !== "string") return null;
  return { accessToken };
}

export const createSlackModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;

  const requireCreds = async (
    ctx: ToolContext,
  ): Promise<{ error: ToolResult } | { client: SlackClient }> => {
    const creds = await loadSlackCreds(db, ctx.tenantId);
    if (!creds) {
      return {
        error: {
          ok: false,
          error: {
            code: "permission_denied",
            message:
              "Slack is not connected for this tenant. Connect it via the admin UI first.",
            retryable: false,
          },
        },
      };
    }
    return { client: new SlackClient(creds as Record<string, unknown> as never) };
  };

  const sendMessageTool: Tool = {
    name: "send_message",
    description: "Post a message to a Slack channel",
    inputs: z.object({
      channel: z.string(),
      text: z.string(),
    }),
    async handler(
      input: { channel: string; text: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const r = await requireCreds(ctx);
      if ("error" in r) return r.error;
      const result = await r.client.executeAction("send_message", input);
      if (!result.success) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: result.error ?? "Slack returned an error",
            retryable: false,
          },
        };
      }
      return { ok: true, result: result.data as Record<string, unknown> };
    },
  };

  const replyInThreadTool: Tool = {
    name: "reply_in_thread",
    description: "Reply to a Slack message in its thread",
    inputs: z.object({
      channel: z.string(),
      threadTs: z.string(),
      text: z.string(),
    }),
    async handler(
      input: { channel: string; threadTs: string; text: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const r = await requireCreds(ctx);
      if ("error" in r) return r.error;
      const result = await r.client.executeAction("reply_in_thread", input);
      if (!result.success) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: result.error ?? "Slack returned an error",
            retryable: false,
          },
        };
      }
      return { ok: true, result: (result.data ?? {}) as Record<string, unknown> };
    },
  };

  const addReactionTool: Tool = {
    name: "add_reaction",
    description: "React to a Slack message with an emoji",
    inputs: z.object({
      channel: z.string(),
      timestamp: z.string(),
      emoji: z.string(),
    }),
    async handler(
      input: { channel: string; timestamp: string; emoji: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const r = await requireCreds(ctx);
      if ("error" in r) return r.error;
      const result = await r.client.executeAction("add_reaction", input);
      if (!result.success) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: result.error ?? "Slack returned an error",
            retryable: false,
          },
        };
      }
      return { ok: true, result: (result.data ?? {}) as Record<string, unknown> };
    },
  };

  const module: Module = {
    id: "slack",
    name: "Slack",
    version: "0.1.0",
    description: "Slack chat integration — send messages, reply in threads, add reactions",
    provides: ["chat"],
    skills: [
      {
        id: "slack",
        source: "module",
        body: SLACK_SKILL,
        priority: 80,
      },
    ],
    tools: [sendMessageTool, replyInThreadTool, addReactionTool],
  };

  return module;
};
