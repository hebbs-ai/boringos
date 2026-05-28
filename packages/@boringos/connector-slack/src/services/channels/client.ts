// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchSlack, resolveToken, type TokenSource } from "../../helpers.js";

export interface Channel {
  id: string;
  name: string;
  is_private: boolean;
}

export class ChannelsClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listChannels(): Promise<Channel[]> {
    const res = await fetchSlack(
      this.getToken,
      this.fetchImpl,
      "https://slack.com/api/conversations.list",
      { method: "GET" },
    );
    const body = (await res.json()) as {
      ok: boolean;
      channels?: Channel[];
      error?: string;
    };
    if (!body.ok) throw new Error(`Slack listChannels failed: ${body.error}`);
    return body.channels ?? [];
  }
}
