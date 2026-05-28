# Google Contacts (People API)

When the Google connector has been granted the `contacts.readonly` scope, you can look up contact details. Tool names: `contacts.list`, `contacts.lookup`.

## Tools

### contacts.list
List all of the user's contacts. Returns names, email addresses, phone numbers.

### contacts.lookup
Look up contact details by email address. Useful for enriching meeting attendees with names and additional contact info.

## Guidelines
- Contacts scope is optional. If a tool returns `needs_scope`, create an approval task with the consent URL. Do not assume scope is granted.
- Do not surface phone numbers or addresses unless the user asked for them.
