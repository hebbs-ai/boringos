# Outlook Mail (via Microsoft 365 connector)

You can read, search, and send Outlook messages through tool calls. Tool names: `mail.list_emails`, `mail.read_email`, `mail.send_email`, `mail.reply_email`, `mail.search_emails`.

## When to use each tool

### mail.list_emails / mail.search_emails
List or search emails. Search uses Microsoft Graph free-text search ($search), which matches across subject, body, sender, and recipients:
- `from:boss` for emails from a specific sender
- `invoice` for emails mentioning "invoice"
- `subject:report` to bias toward the subject line

Without a query, `mail.list_emails` returns the most recent messages ordered by received date. `maxResults` defaults to 10.

### mail.read_email
Read the full content of an email by its message ID. Use `mail.list_emails` first to discover IDs.

### mail.send_email
Send an email. Provide `to`, `subject`, `body`. Multiple recipients can be comma- or semicolon-separated in `to`. Set `bodyType` to `html` for rich content (default is plain text).

### mail.reply_email
Reply to an existing message. Provide `messageId` and `body`. Graph sets threading headers automatically and quotes the original.

## Guidelines
- When summarizing email content, do not quote full bodies. Extract the important facts.
- Always check the sender's domain when handling sensitive content.
- Graph free-text search is relevance-ranked, not chronological. When recency matters, prefer `mail.list_emails` with no query.
