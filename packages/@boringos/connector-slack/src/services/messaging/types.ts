// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SlackMessage {
  ts: string;
  channel: string;
  text: string;
  user?: string;
  thread_ts?: string;
}
