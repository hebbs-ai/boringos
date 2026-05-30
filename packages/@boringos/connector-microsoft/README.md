# @boringos/connector-microsoft

A BoringOS connector for **Microsoft 365** via the [Microsoft Graph](https://learn.microsoft.com/graph/) API. It is the Microsoft counterpart to `@boringos/connector-google`, built on the same Connector SDK (v2) contract.

It ships:

- A `ConnectorDefinition` (`microsoftConnector`) — OAuth2 against the Microsoft `/common` authority (work/school **and** personal accounts).
- Typed, framework-free API clients for four services:

| Service | Client | Graph surface |
|---|---|---|
| Outlook Mail | `MailClient` | `/me/messages`, `/me/sendMail`, `/me/mailFolders` |
| Calendar | `CalendarClient` | `/me/events`, `/me/calendarView` |
| Contacts | `ContactsClient` | `/me/contacts`, `/me/people` |
| OneDrive | `FilesClient` | `/me/drive` |

Like the Google connector, this package **does not register agent-facing tools**. Tools are wired host-side by a `ModuleFactory` in `@boringos/core` that calls `deps.getConnectorToken("microsoft", moduleId)` and instantiates these clients. The package only provides the definition + typed clients; the host owns OAuth, token storage, and transparent refresh.

## Usage (host side)

```ts
import { MailClient } from "@boringos/connector-microsoft";

const conn = await deps.getConnectorToken("microsoft", MODULE_ID);
if (!conn) return notConnected();

const mail = new MailClient(conn.getToken); // getToken: () => Promise<string>
const messages = await mail.listMessages({ query: "from:boss", top: 10 });
```

Every client accepts a `TokenSource` (`string | () => Promise<string>`). Pass the host's `conn.getToken` to get transparent refresh and a single 401 retry on a fresh token (see `helpers.ts`).

## OAuth setup

Register an app in the [Azure portal](https://portal.azure.com) (Entra ID → App registrations) and set the host env vars:

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`

The connector requests, in addition to the per-service scopes, the identity + refresh scopes `openid email profile offline_access`. Microsoft only issues refresh tokens when `offline_access` is requested — this is the equivalent of Google's `accessType: "offline"`.

Scopes per service:

- **Mail:** `Mail.ReadWrite`, `Mail.Send`
- **Calendar:** `Calendars.ReadWrite`
- **Contacts:** `Contacts.Read`, `People.Read`
- **Files:** `Files.Read`

## Development

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm build       # tsc -> dist/
pnpm test        # vitest
```

### Standalone layout note

This repo mirrors the in-tree layout of `boringos/packages/@boringos/connector-google` so it can be vendored back into the framework. It depends on the published `@boringos/module-sdk` for the Connector SDK contract. That dependency is used **type-only** — the emitted `dist/` has no runtime import of `@boringos/module-sdk` (the `import type` statements are erased at compile time). When vendored in-tree, change the dependency to `workspace:*`; the import resolves to the same package and the same exported names.

## License

AGPL-3.0-or-later
