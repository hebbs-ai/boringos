# Gmail (via Google Workspace connector)

You can read, search, and send Gmail messages through tool calls. Tool names: `gmail.list_emails`, `gmail.read_email`, `gmail.send_email`, `gmail.reply_email`, `gmail.search_emails`.

## When to use each tool

### gmail.list_emails / gmail.search_emails
List or search emails. Use Gmail query syntax:
- `from:boss` for emails from a specific sender
- `is:unread` for unread emails
- `subject:invoice` for emails with "invoice" in the subject
- `after:2026/01/01` for emails after a date
- `has:attachment` for emails with attachments

`maxResults` defaults to 10 if omitted.

### gmail.read_email
Read the full content of an email by its message ID. Use `gmail.list_emails` first to discover IDs.

### gmail.send_email
Send an email. Provide `to`, `subject`, `body`. Multiple recipients can be comma-separated in `to`.

### gmail.reply_email
Reply to an existing message. Provide `messageId` and `body`. Headers are set automatically for proper threading.

## Guidelines
- When summarizing email content, do not quote full bodies. Extract the important facts.
- Always check the sender's domain when handling sensitive content.
- Treat unread emails as the primary actionable inbox.
