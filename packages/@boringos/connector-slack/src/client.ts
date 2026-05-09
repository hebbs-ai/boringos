// Local types — the v1 `@boringos/connector` framework was
// deleted. v2 callers (the Slack Module) construct this directly
// with `{ accessToken }`.
export interface ActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}
export interface SlackCredentials {
  accessToken: string;
}

export class SlackClient {
  private token: string;

  constructor(credentials: SlackCredentials) {
    this.token = credentials.accessToken;
  }

  async executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case "send_message":
        return this.sendMessage(inputs.channel as string, inputs.text as string);
      case "reply_in_thread":
        return this.replyInThread(inputs.channel as string, inputs.threadTs as string, inputs.text as string);
      case "add_reaction":
        return this.addReaction(inputs.channel as string, inputs.timestamp as string, inputs.emoji as string);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  private async sendMessage(channel: string, text: string): Promise<ActionResult> {
    const res = await this.api("chat.postMessage", { channel, text });
    return res.ok
      ? { success: true, data: { ts: res.ts as string, channel: res.channel as string } }
      : { success: false, error: res.error as string };
  }

  private async replyInThread(channel: string, threadTs: string, text: string): Promise<ActionResult> {
    const res = await this.api("chat.postMessage", { channel, text, thread_ts: threadTs });
    return res.ok
      ? { success: true, data: { ts: res.ts as string, channel: res.channel as string } }
      : { success: false, error: res.error as string };
  }

  private async addReaction(channel: string, timestamp: string, emoji: string): Promise<ActionResult> {
    const res = await this.api("reactions.add", { channel, timestamp, name: emoji });
    return res.ok
      ? { success: true }
      : { success: false, error: res.error as string };
  }

  private async api(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }
}
