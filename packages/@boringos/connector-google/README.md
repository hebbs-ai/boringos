# @boringos/connector-google

Google Workspace connector for BoringOS -- Gmail and Calendar integration with OAuth.

## Install

```bash
npm install @boringos/connector-google
```

## Setup

The connector needs an OAuth 2.0 client from the Google Cloud
Console. The full walkthrough -- which scopes to request, the
exact callback URI, and the production-host checklist -- lives
at [`docs/setup/google.md`](../../../docs/setup/google.md) in the
framework repo. Two env vars on the host (`GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`) and the `Connect Google` button in the
shell's Connectors screen does the rest.

## Usage

```typescript
import { BoringOS } from "@boringos/core";
import { google } from "@boringos/connector-google";

const app = new BoringOS({});

app.connector(
  google({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  })
);

await app.listen(3000);
```

### Direct Client Usage

```typescript
import { GmailClient, CalendarClient } from "@boringos/connector-google";

const gmail = new GmailClient(credentials);
const emails = await gmail.listEmails({ maxResults: 10 });
const email = await gmail.readEmail(emailId);
await gmail.sendEmail({ to: "user@example.com", subject: "Hello", body: "..." });

const calendar = new CalendarClient(credentials);
const events = await calendar.listEvents({ timeMin: new Date() });
await calendar.createEvent({ summary: "Meeting", start, end });
const slots = await calendar.findFreeSlots({ timeMin, timeMax, duration: 30 });
```

## API Reference

### Connector

| Export | Description |
|---|---|
| `google(config)` | Google Workspace connector definition |

### Gmail Actions

| Action | Description |
|---|---|
| `list_emails` | List recent emails |
| `read_email` | Read a specific email |
| `send_email` | Send an email |
| `search_emails` | Search with Gmail query syntax |

### Calendar Actions

| Action | Description |
|---|---|
| `list_events` | List calendar events |
| `create_event` | Create a new event |
| `update_event` | Update an existing event |
| `find_free_slots` | Find available time slots |

### Events

`email_received`, `calendar_event_created`, `calendar_event_updated`

### Types

`GoogleConfig`, `GmailClient`, `CalendarClient`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)
