// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchSlack, resolveToken, type TokenSource } from "../../helpers.js";

export class ReactionsClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async addReaction(opts: {
    channel: string;
    timestamp: string;
    name: string;
  }): Promise<void> {
    const res = await fetchSlack(
      this.getToken,
      this.fetchImpl,
      "https://slack.com/api/reactions.add",
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(opts),
      },
    );
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok && body.error !== "already_reacted") {
      throw new Error(`Slack addReaction failed: ${body.error}`);
    }
  }
}
