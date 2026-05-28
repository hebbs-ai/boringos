// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchSlack, resolveToken, type TokenSource } from "../../helpers.js";
import type { SlackMessage } from "./types.js";

const SLACK_API = "https://slack.com/api";

export class MessagingClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async sendMessage(opts: {
    channel: string;
    text: string;
    thread_ts?: string;
  }): Promise<SlackMessage> {
    const res = await fetchSlack(
      this.getToken,
      this.fetchImpl,
      `${SLACK_API}/chat.postMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(opts),
      },
    );
    const body = (await res.json()) as {
      ok: boolean;
      ts: string;
      channel: string;
      message: { text: string };
      error?: string;
    };
    if (!body.ok) throw new Error(`Slack sendMessage failed: ${body.error}`);
    return { ts: body.ts, channel: body.channel, text: body.message.text };
  }

  async replyInThread(opts: {
    channel: string;
    thread_ts: string;
    text: string;
  }): Promise<SlackMessage> {
    return this.sendMessage({
      channel: opts.channel,
      text: opts.text,
      thread_ts: opts.thread_ts,
    });
  }
}
