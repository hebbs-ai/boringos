# Slack Messaging

Send messages and reply to threads. Tool names: `send_message`, `reply_in_thread`.

### send_message
Post a message to a channel by ID or name. Required: `channel`, `text`.

### reply_in_thread
Reply to an existing message in its thread. Required: `channel`, `thread_ts`, `text`.

## Guidelines
- Use plain text by default. Mention `@user` sparingly.
- For long-form content, use Slack's mrkdwn formatting (single-asterisk bold, single-underscore italic, single-backtick inline code).
