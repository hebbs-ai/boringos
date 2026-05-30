# Outlook Contacts (via Microsoft 365 connector)

You can read the user's stored contacts and search relevant people across their mailbox. Tool names: `contacts.list_contacts`, `contacts.get_contact`, `contacts.search_people`.

## Tools

### contacts.list_contacts
List the user's saved Outlook contacts. `top` controls page size (default 100). Returns display name, email addresses, phone numbers, company, and job title.

### contacts.get_contact
Fetch a single saved contact by its contact ID.

### contacts.search_people
Relevance-ranked search across people the user communicates with (Graph /me/people). This includes people who are not saved as contacts, surfaced by how often and recently they interact. Use this to resolve a name to an email address.

## Guidelines
- Prefer `contacts.search_people` to turn a name into an email address before sending mail or inviting an attendee.
- `list_contacts` only returns explicitly-saved contacts; `search_people` is broader.
- Do not expose phone numbers or other personal details unless the user asks.
