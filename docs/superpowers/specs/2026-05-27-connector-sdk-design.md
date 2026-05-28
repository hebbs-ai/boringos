# Connector SDK Design Spec

> Status: **Draft** | Date: 2026-05-27

## 1. Overview

### Problem

Module developers building on BoringOS need to integrate with external services (Google, Microsoft, Slack, GitHub, etc.). Today, the integration pattern is buried inside `@boringos/core` -- module developers must clone the framework repo to understand how OAuth, token management, and API calls work. There is no published SDK contract for connectors.

### Solution

A **connector SDK pattern** that module developers install from npm. Each connector package (`@boringos/connector-google`, `@boringos/connector-slack`, etc.) provides:

- Typed API clients for each service (Gmail, Calendar, Contacts, etc.)
- Scope constants and service definitions
- A universal `ConnectorDefinition` that the framework's auth manager consumes

The framework handles OAuth, token storage, refresh, and multi-account management centrally. The connector SDK has zero dependency on `@boringos/core`.

### Design Principles

- **Modules are lego blocks.** Each module is self-contained. It declares what services it needs, requests scopes at runtime, and handles denial gracefully.
- **Android-style runtime permissions.** Modules request scopes when they need them, not at install time. The user is always in control.
- **One interface for all connectors.** Google, Slack, GitHub, Microsoft all implement `ConnectorDefinition`. Learn it once, apply everywhere.
- **No framework coupling in the SDK.** Connector packages are pure libraries. Installable from npm, testable in isolation.
- **Single OAuth per account.** User authorizes Google once. All modules that need Google share that authorization (scoped by what each module requests).

---

## 2. Architecture

### Component Responsibilities

```
+---------------------------+     +---------------------------+
|  @boringos/module-sdk     |     |  @boringos/connector-*    |
|                           |     |                           |
|  - ConnectorDefinition    |     |  - Implements interface   |
|  - ServiceDefinition      |<----|  - Typed API clients      |
|  - AuthStrategy           |     |  - Scope constants        |
|  - Extended Deps          |     |  - Zero core dependency   |
+---------------------------+     +---------------------------+
             |                                 |
             v                                 v
+----------------------------------------------------------+
|  @boringos/core                                          |
|                                                          |
|  Auth Manager                                            |
|  - Registers ConnectorDefinitions                        |
|  - Multi-account OAuth flow                              |
|  - Token storage + refresh                               |
|  - Runtime scope check/request                           |
|  - Audit logging                                         |
|  - Credential encryption                                 |
+----------------------------------------------------------+
             |
             v
+----------------------------------------------------------+
|  Third-party Modules                                     |
|                                                          |
|  - import { GmailClient } from "@boringos/connector-*"  |
|  - Declare connectors in manifest                        |
|  - deps.getConnectorToken() / checkScopes()              |
|  - Build own tools with typed clients                    |
+----------------------------------------------------------+
```

### Data Flow

```
1. Connector package installed
   -> Auth manager registers ConnectorDefinition

2. User connects a Google account via UI
   -> Auth manager builds OAuth URL from ConnectorDefinition.auth
   -> User completes consent in browser
   -> Auth manager stores credentials in connector_accounts
   -> resolveAccountId() extracts email as account identifier

3. User assigns account to module via UI
   -> module_connector_bindings row written

4. Module tool executes at runtime
   -> Module calls deps.checkScopes() (optional, Android-style)
   -> If missing scopes, calls deps.requestScopes() -> user prompted
   -> Module calls deps.getConnectorToken(kind, accountId, moduleId)
   -> Auth manager refreshes token if needed, writes audit, returns token
   -> Module creates typed client: new GmailClient(token.accessToken)
   -> Module executes its business logic
```

---

## 3. Universal Connector Interface

These types are added to `@boringos/module-sdk/src/types.ts`.

### Auth Strategies

```typescript
interface OAuth2Strategy {
  type: "oauth2";
  authorizationUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  pkce?: boolean;
  accessType?: string;
  prompt?: string;
}

interface ApiKeyStrategy {
  type: "api-key";
  headerName?: string;
  prefix?: string;
}

interface BotTokenStrategy {
  type: "bot-token";
  tokenUrl?: string;
}

interface PatStrategy {
  type: "pat";
  headerName?: string;
}

type AuthStrategy = OAuth2Strategy | ApiKeyStrategy | BotTokenStrategy | PatStrategy;
```

### Scope and Service Definitions

```typescript
interface ScopeDefinition {
  scope: string;
  description: string;
  required: boolean;
}

interface ServiceDefinition {
  id: string;
  displayName: string;
  scopes: ScopeDefinition[];
}
```

### Connector Definition

```typescript
interface ConnectorDefinition {
  kind: string;
  displayName: string;
  icon?: string;
  auth: AuthStrategy[];
  services: ServiceDefinition[];
  resolveAccountId(tokenResponse: Record<string, unknown>): string;
}
```

### Connected Account (returned to modules)

```typescript
interface ConnectedAccount {
  accountId: string;
  connectorKind: string;
  grantedScopes: string[];
  status: "active" | "expired" | "revoked";
}
```

### Extended ModuleFactoryDeps

```typescript
interface ModuleFactoryDeps {
  // ... existing fields unchanged ...

  getConnectorToken(
    kind: string,
    accountId: string,
    callerModuleId: string,
  ): Promise<{ accessToken: string } | null>;

  listConnectedAccounts(
    kind: string,
    tenantId: string,
  ): Promise<ConnectedAccount[]>;

  checkScopes(
    kind: string,
    accountId: string,
    scopes: string[],
  ): Promise<{ granted: boolean; missing: string[] }>;

  requestScopes(
    kind: string,
    accountId: string,
    scopes: string[],
  ): Promise<{ granted: boolean }>;
}
```

### Module Manifest Extension

```typescript
interface Module {
  // ... existing fields unchanged ...

  connectors?: Record<string, {
    services: ServiceDefinition[];
  }>;
}
```

---

## 4. Connector Package Structure

### Layout

Each connector follows this structure:

```
packages/@boringos/connector-{provider}/
  package.json
  src/
    index.ts              # top-level exports
    definition.ts         # ConnectorDefinition
    scopes.ts             # scope constants + ServiceDefinitions
    helpers.ts            # shared fetch wrapper, error types
    services/
      {service}/
        index.ts          # re-exports
        client.ts         # typed API client
        types.ts          # request/response types
```

### Dependencies

```
@boringos/connector-google
  depends on: @boringos/module-sdk (types only)
              @boringos/shared (utilities)
  does NOT depend on: @boringos/core, @boringos/db, or any framework package
```

### Package Exports

Using `@boringos/connector-google` as the reference:

```typescript
// index.ts

// Connector definition
export { googleConnector } from "./definition.js";

// Service definitions (for module manifest declarations)
export { gmailService, calendarService, contactsService, driveService } from "./scopes.js";

// Typed API clients
export { GmailClient } from "./services/gmail/index.js";
export { CalendarClient } from "./services/calendar/index.js";
export { PeopleClient } from "./services/contacts/index.js";
export { DriveClient } from "./services/drive/index.js";

// Types for module developers
export type { GmailMessage, Thread, EmailHeaders } from "./services/gmail/types.js";
export type { CalendarEvent, FreeBusySlot } from "./services/calendar/types.js";
export type { Contact, ContactGroup } from "./services/contacts/types.js";
export type { DriveFile } from "./services/drive/types.js";

// Scope constants
export { GMAIL_SCOPES, CALENDAR_SCOPES, CONTACTS_SCOPES, DRIVE_SCOPES } from "./scopes.js";
```

---

## 5. Reference Implementation: @boringos/connector-google

### Connector Definition

```typescript
// definition.ts
import type { ConnectorDefinition } from "@boringos/module-sdk";
import { gmailService, calendarService, contactsService, driveService } from "./scopes.js";

export const googleConnector: ConnectorDefinition = {
  kind: "google",
  displayName: "Google Workspace",
  auth: [{
    type: "oauth2",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    accessType: "offline",
    prompt: "consent",
  }],
  services: [gmailService, calendarService, contactsService, driveService],
  resolveAccountId: (tokenResponse) => tokenResponse.email as string,
};
```

### Scope Definitions

```typescript
// scopes.ts
import type { ServiceDefinition, ScopeDefinition } from "@boringos/module-sdk";

export const GMAIL_SCOPES: ScopeDefinition[] = [
  { scope: "https://www.googleapis.com/auth/gmail.modify", description: "Read and modify emails", required: true },
  { scope: "https://www.googleapis.com/auth/gmail.send", description: "Send emails", required: true },
];

export const CALENDAR_SCOPES: ScopeDefinition[] = [
  { scope: "https://www.googleapis.com/auth/calendar", description: "Manage calendar events", required: true },
];

export const CONTACTS_SCOPES: ScopeDefinition[] = [
  { scope: "https://www.googleapis.com/auth/contacts.readonly", description: "Read contacts", required: true },
];

export const DRIVE_SCOPES: ScopeDefinition[] = [
  { scope: "https://www.googleapis.com/auth/drive.readonly", description: "Read files from Drive", required: true },
];

export const gmailService: ServiceDefinition = {
  id: "gmail",
  displayName: "Gmail",
  scopes: GMAIL_SCOPES,
};

export const calendarService: ServiceDefinition = {
  id: "calendar",
  displayName: "Google Calendar",
  scopes: CALENDAR_SCOPES,
};

export const contactsService: ServiceDefinition = {
  id: "contacts",
  displayName: "Google Contacts",
  scopes: CONTACTS_SCOPES,
};

export const driveService: ServiceDefinition = {
  id: "drive",
  displayName: "Google Drive",
  scopes: DRIVE_SCOPES,
};
```

### Typed Client (Gmail example)

Replaces the current `executeAction(action: string, inputs: Record<string, unknown>)` pattern with typed methods:

```typescript
// services/gmail/client.ts
import type { GmailMessage, Thread, HistoryEvent } from "./types.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailClient {
  constructor(private token: string) {}

  async listMessages(opts?: {
    query?: string;
    maxResults?: number;
    labelIds?: string[];
  }): Promise<GmailMessage[]> { /* ... */ }

  async getMessage(messageId: string): Promise<GmailMessage> { /* ... */ }

  async getThread(threadId: string): Promise<Thread> { /* ... */ }

  async sendEmail(opts: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ messageId: string }> { /* ... */ }

  async replyToEmail(opts: {
    messageId: string;
    body: string;
  }): Promise<{ messageId: string }> { /* ... */ }

  async archiveMessage(messageId: string): Promise<void> { /* ... */ }

  async modifyLabels(messageId: string, opts: {
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }): Promise<void> { /* ... */ }

  async searchMessages(query: string, opts?: {
    maxResults?: number;
  }): Promise<GmailMessage[]> { /* ... */ }

  async ensureLabel(name: string): Promise<{ labelId: string }> { /* ... */ }

  async listHistory(startHistoryId: string): Promise<HistoryEvent[]> { /* ... */ }
}
```

Same pattern for `CalendarClient`, `PeopleClient`, `DriveClient`.

### How Another Connector Looks (Slack)

Same `ConnectorDefinition` interface, different internals:

```typescript
// @boringos/connector-slack/src/definition.ts
export const slackConnector: ConnectorDefinition = {
  kind: "slack",
  displayName: "Slack",
  auth: [
    {
      type: "oauth2",
      authorizationUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      clientIdEnv: "SLACK_CLIENT_ID",
      clientSecretEnv: "SLACK_CLIENT_SECRET",
    },
    { type: "bot-token" },
  ],
  services: [messagingService, channelsService, reactionsService],
  resolveAccountId: (tokenResponse) =>
    `${tokenResponse.team?.id}:${tokenResponse.authed_user?.id}`,
};
```

### How Another Connector Looks (GitHub)

```typescript
// @boringos/connector-github/src/definition.ts
export const githubConnector: ConnectorDefinition = {
  kind: "github",
  displayName: "GitHub",
  auth: [
    {
      type: "oauth2",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientIdEnv: "GITHUB_CLIENT_ID",
      clientSecretEnv: "GITHUB_CLIENT_SECRET",
    },
    { type: "pat", headerName: "Authorization" },
  ],
  services: [reposService, issuesService, pullRequestsService],
  resolveAccountId: (tokenResponse) => tokenResponse.login as string,
};
```

---

## 6. Module Developer Experience

### Example: Productivity Module

```typescript
import type { ModuleFactory } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import {
  gmailService, calendarService,
  GmailClient, CalendarClient,
  GMAIL_SCOPES, CALENDAR_SCOPES,
} from "@boringos/connector-google";

export const productivityModule: ModuleFactory = (deps) => ({
  id: "productivity",
  name: "Productivity",
  version: "1.0.0",
  description: "Triages emails, lists tasks, identifies bottlenecks",
  kind: "module",

  connectors: {
    google: {
      services: [gmailService, calendarService],
    },
  },

  tools: [
    {
      name: "triage_inbox",
      description: "Categorize unread emails by priority",
      inputs: z.object({
        accountId: z.string().describe("Google account to triage"),
        maxResults: z.number().optional().default(50),
      }),
      async handler(input, ctx) {
        const scopeCheck = await deps.checkScopes?.(
          "google", input.accountId, GMAIL_SCOPES.map(s => s.scope),
        );
        if (scopeCheck && !scopeCheck.granted) {
          const result = await deps.requestScopes?.(
            "google", input.accountId, scopeCheck.missing,
          );
          if (!result?.granted) {
            return { ok: false, error: "Gmail permission denied by user" };
          }
        }

        const token = await deps.getConnectorToken?.(
          "google", input.accountId, "productivity",
        );
        if (!token) return { ok: false, error: "Google account not connected" };

        const gmail = new GmailClient(token.accessToken);
        const messages = await gmail.listMessages({ maxResults: input.maxResults });
        const triaged = categorizeByPriority(messages);
        return { ok: true, result: triaged };
      },
    },
    {
      name: "daily_schedule",
      description: "List today's events and identify gaps",
      inputs: z.object({ accountId: z.string() }),
      async handler(input, ctx) {
        const token = await deps.getConnectorToken?.(
          "google", input.accountId, "productivity",
        );
        if (!token) return { ok: false, error: "Google account not connected" };

        const calendar = new CalendarClient(token.accessToken);
        const events = await calendar.listEvents({
          timeMin: startOfDay(),
          timeMax: endOfDay(),
        });
        return { ok: true, result: findProductivityGaps(events) };
      },
    },
  ],
});
```

### Example: Executive Assistant Module

```typescript
import type { ModuleFactory } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import {
  gmailService, calendarService, contactsService,
  GmailClient, CalendarClient, PeopleClient,
} from "@boringos/connector-google";

export const eaModule: ModuleFactory = (deps) => ({
  id: "executive-assistant",
  name: "Executive Assistant",
  version: "0.5.0",
  description: "Travel triage, agenda prep, participant lookup",
  kind: "module",

  connectors: {
    google: {
      services: [gmailService, calendarService, contactsService],
    },
  },

  tools: [
    {
      name: "triage_travel_emails",
      description: "Find and summarize travel/hotel booking emails",
      inputs: z.object({ accountId: z.string() }),
      async handler(input, ctx) {
        const token = await deps.getConnectorToken?.(
          "google", input.accountId, "executive-assistant",
        );
        if (!token) return { ok: false, error: "Google not connected" };

        const gmail = new GmailClient(token.accessToken);
        const messages = await gmail.listMessages({
          query: "subject:(booking OR reservation OR itinerary OR flight OR hotel)",
        });
        return { ok: true, result: extractTravelDetails(messages) };
      },
    },
    {
      name: "prep_meeting",
      description: "Pull agenda, attendees, and contact details for a meeting",
      inputs: z.object({ accountId: z.string(), eventId: z.string() }),
      async handler(input, ctx) {
        const token = await deps.getConnectorToken?.(
          "google", input.accountId, "executive-assistant",
        );
        if (!token) return { ok: false, error: "Google not connected" };

        const calendar = new CalendarClient(token.accessToken);
        const event = await calendar.getEvent(input.eventId);

        // Contacts scope requested at runtime (Android-style)
        const scopeCheck = await deps.checkScopes?.(
          "google", input.accountId,
          contactsService.scopes.map(s => s.scope),
        );

        let attendeeDetails = null;
        if (scopeCheck?.granted) {
          const people = new PeopleClient(token.accessToken);
          attendeeDetails = await people.batchGet(
            event.attendees.map(a => a.email),
          );
        }
        // Graceful degradation: returns event without contact details if denied

        return { ok: true, result: { event, attendeeDetails } };
      },
    },
  ],
});
```

---

## 7. Framework-Side Auth Manager

### Interface

```typescript
// @boringos/core/src/auth-manager.ts

interface AuthManager {
  // Connector lifecycle
  registerConnector(definition: ConnectorDefinition): void;
  listConnectors(): ConnectorDefinition[];
  getConnector(kind: string): ConnectorDefinition | null;

  // Account management (called by UI routes)
  startOAuthFlow(
    kind: string,
    tenantId: string,
    scopes: string[],
  ): Promise<{ authUrl: string; state: string }>;

  handleOAuthCallback(
    kind: string,
    code: string,
    state: string,
  ): Promise<ConnectedAccount>;

  addApiKeyAccount(
    kind: string,
    tenantId: string,
    apiKey: string,
    label: string,
  ): Promise<ConnectedAccount>;

  removeAccount(
    kind: string,
    accountId: string,
    tenantId: string,
  ): Promise<void>;

  // Token operations (exposed to modules via ModuleFactoryDeps)
  getToken(
    kind: string,
    accountId: string,
    callerModuleId: string,
  ): Promise<{ accessToken: string } | null>;

  listAccounts(
    kind: string,
    tenantId: string,
  ): Promise<ConnectedAccount[]>;

  // Runtime scope permissions
  checkScopes(
    kind: string,
    accountId: string,
    scopes: string[],
  ): Promise<{ granted: boolean; missing: string[] }>;

  requestScopes(
    kind: string,
    accountId: string,
    scopes: string[],
  ): Promise<{ granted: boolean }>;
}
```

### Token Refresh Flow

```
Module calls deps.getConnectorToken("google", accountId, moduleId)
  -> AuthManager.getToken()
    -> Read connector_accounts row
    -> If token expired or within 60s of expiry:
        -> Read ConnectorDefinition.auth (OAuth2Strategy)
        -> Resolve clientId: tenant override OR host env var
        -> Call tokenUrl with refreshToken + clientId + clientSecret
        -> Update connector_accounts with new token
        -> Write audit row to connector_token_issuance
    -> Return { accessToken }
```

### Runtime Scope Upgrade Flow

```
Module calls deps.requestScopes("google", accountId, ["contacts.readonly"])
  -> AuthManager.requestScopes()
    -> Read connector_accounts.grantedScopes
    -> Compute missing = requested - granted
    -> If none missing: return { granted: true }
    -> Build new OAuth URL with incremental scopes
       (for providers that support it, e.g. Google's include_granted_scopes=true)
    -> Emit a "scope_consent_required" event via realtimeBus (SSE)
       with { kind, accountId, authUrl, requestedScopes }
    -> Shell UI receives the event, presents the consent link to the user
    -> User completes consent in browser
    -> OAuth callback updates grantedScopes on the account
    -> AuthManager resolves the pending requestScopes() promise
    -> Return { granted: true } or { granted: false } if denied/timed out
```

The `requestScopes()` call is **async and blocking** from the module's perspective. It returns a promise that resolves when the user completes (or dismisses) the consent flow. A configurable timeout (default: 5 minutes) rejects with `{ granted: false }` if the user doesn't act.

For providers that do not support incremental authorization, the flow re-authorizes with the full scope set (existing + new).

### Injection into Modules

```typescript
// In boringos.ts, when building ModuleFactoryDeps
const deps: ModuleFactoryDeps = {
  db,
  memory,
  drive,
  engine,
  workflowEngine,
  toolRegistry,
  realtimeBus,
  eventBus,
  getConnectorToken: (kind, accountId, callerId) =>
    authManager.getToken(kind, accountId, callerId),
  listConnectedAccounts: (kind, tenantId) =>
    authManager.listAccounts(kind, tenantId),
  checkScopes: (kind, accountId, scopes) =>
    authManager.checkScopes(kind, accountId, scopes),
  requestScopes: (kind, accountId, scopes) =>
    authManager.requestScopes(kind, accountId, scopes),
};
```

---

## 8. Database Schema

### connector_accounts (replaces connectors)

```sql
CREATE TABLE connector_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  auth_strategy   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  credentials     JSONB NOT NULL,       -- encrypted at rest
  granted_scopes  TEXT[] NOT NULL DEFAULT '{}',
  profile         JSONB,                -- display name, avatar, email for UI
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, kind, account_id)
);
```

### connector_oauth_apps (enterprise BYOA)

```sql
CREATE TABLE connector_oauth_apps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  client_id       TEXT NOT NULL,        -- encrypted at rest
  client_secret   TEXT NOT NULL,        -- encrypted at rest
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, kind)
);
```

OAuth client resolution order:
1. `connector_oauth_apps` row for `(tenantId, kind)` if exists
2. Host-level env var from `ConnectorDefinition.auth.clientIdEnv`

### module_connector_bindings

```sql
CREATE TABLE module_connector_bindings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  module_id       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, module_id, kind)
);
```

Written by the UI when a user assigns "this module uses this account."

### connector_token_issuance (audit, updated)

```sql
CREATE TABLE connector_token_issuance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT NOT NULL,
  kind              TEXT NOT NULL,
  account_id        TEXT NOT NULL,
  caller_module_id  TEXT NOT NULL,
  outcome           TEXT NOT NULL,    -- issued, refreshed, not_connected, refresh_failed, scope_denied
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Migration from current schema

Existing `connectors` table rows migrate to `connector_accounts`:
- `kind` maps directly
- `accountId` derived from `credentials.email` or profile data (for Google), `config.team_id` (for Slack)
- `grantedScopes` populated from the hardcoded scope sets in current `OAUTH_PROVIDERS`
- `authStrategy` set to `"oauth2"` for all existing rows
- `credentials` JSONB structure unchanged (`{ accessToken, refreshToken, expiresAt }`)

---

## 9. Multi-Tenant Model

### Tenant Isolation

Every connector account is scoped to a tenant. The `(tenant_id, kind, account_id)` unique constraint ensures full isolation. Two tenants connecting the same Google account get independent token sets, scope grants, and audit trails.

```
Tenant A (acme-corp):
  google:
    +-- ceo@acme.com         (gmail, calendar, contacts)
    +-- office@acme.com      (calendar only)
  slack:
    +-- acme-workspace       (messaging)

Tenant B (startup-inc):
  google:
    +-- founder@startup.com  (gmail, calendar)
  github:
    +-- startup-inc          (repos, issues)
```

### OAuth App Models

**Shared OAuth app (SaaS default):** The host operator registers one Google/Slack/GitHub OAuth app. All tenants authorize through it. `clientIdEnv` / `clientSecretEnv` on the `ConnectorDefinition` points to host-level environment variables.

**Bring-your-own OAuth app (enterprise):** A tenant provides their own OAuth client ID and secret via the `connector_oauth_apps` table. Required for enterprises that need their own consent screen, branding, or admin-controlled app approval.

### Credential Encryption

All credential fields (`connector_accounts.credentials`, `connector_oauth_apps.client_id`, `connector_oauth_apps.client_secret`) are encrypted at rest using a host-level encryption key (`BORINGOS_ENCRYPTION_KEY` env var).

---

## 10. Migration Path

### Phase 1: Schema + Auth Manager (framework-side)

- Add `connector_accounts`, `connector_oauth_apps`, `module_connector_bindings` tables
- Migrate existing `connectors` rows into `connector_accounts`
- Build the `AuthManager` component, wire into `boringos.ts`
- Refactor `connector-routes.ts` to delegate to auth manager
- Remove: `oauth.ts` hardcoded `OAUTH_PROVIDERS`, per-module `loadGoogleCreds` / `loadSlackCreds`, `runWithRefresh`

### Phase 2: Connector Packages (SDK-side)

- Refactor `@boringos/connector-google`: add `ConnectorDefinition` export, typed client methods, scope constants, service definitions, TypeScript types
- Refactor `@boringos/connector-slack`: same pattern
- Drop `executeAction` dispatch in favor of typed methods (breaking change)
- Add `ConnectorDefinition`, `ServiceDefinition`, `AuthStrategy`, `ScopeDefinition`, `ConnectedAccount` types to `@boringos/module-sdk`
- Add `listConnectedAccounts`, `checkScopes`, `requestScopes` to `ModuleFactoryDeps`

### Phase 3: Built-in Modules Consume New Pattern

- Update `google.ts` module: use `deps.getConnectorToken(kind, accountId, moduleId)` + typed client methods
- Update `slack.ts` module: same treatment
- Built-in modules now follow the exact same pattern as third-party modules (no more direct DB queries for credentials)

### Phase 4: Multi-Account UI

- Shell UI for connecting/disconnecting accounts per connector
- Module settings UI for binding accounts to modules
- Account status display (active, expired, revoked)
- Scope consent prompt flow (for runtime permission requests)

---

## 11. Breaking Changes

| Change | Impact | Migration |
|---|---|---|
| `GmailClient.executeAction()` removed | All call sites in `core/src/modules/google.ts` | Replace with typed method calls |
| `CalendarClient.executeAction()` removed | All call sites in `core/src/modules/google.ts` | Replace with typed method calls |
| `SlackClient.executeAction()` removed | All call sites in `core/src/modules/slack.ts` | Replace with typed method calls |
| `getConnectorToken` signature: `tenantId` replaced by `accountId` | All modules calling `deps.getConnectorToken` | Update call sites with account resolution |
| `connectors` table replaced by `connector_accounts` | Any direct DB queries | Use auth manager methods instead |
| `OAUTH_PROVIDERS` removed | `connector-routes.ts` | Auth manager reads from registered ConnectorDefinitions |

---

## 12. Decision Log

| # | Decision | Alternatives Considered | Why This Option |
|---|---|---|---|
| 1 | Connector SDK is a pure client library with zero `@boringos/core` dependency | SDK as a full Module; SDK with embedded OAuth logic | Module developers install from npm without pulling in the framework. Keeps the SDK testable and portable. |
| 2 | Common `ConnectorDefinition` interface in `@boringos/module-sdk` | Per-connector ad-hoc shapes; separate `@boringos/connector-types` package | One interface for all connectors. Lives where module developers already depend. No extra package. |
| 3 | Multi-account per provider per tenant | Single account per provider (current design) | User connects multiple Google accounts, assigns them to different modules. Real-world SaaS requirement. |
| 4 | Android-style runtime scope permissions | Install-time scope union; framework auto-upgrades | Module requests scopes when needed, user decides. Follows principle of least privilege. Module handles denial gracefully. |
| 5 | Typed client methods instead of `executeAction` dispatch | Keep stringly-typed dispatch; add type layer on top | Type safety, discoverability, IDE autocomplete. Module developers see exactly what's available without reading source. |
| 6 | Module declares `connectors` field on manifest | No manifest declaration (runtime only); declare at tool level | Framework can show "this module uses Gmail and Calendar" before install. UI can pre-configure bindings. |
| 7 | `accountId` replaces `tenantId` in `getConnectorToken` signature | Keep tenantId + add optional accountId; separate method | Clean break. One account, one token. No ambiguity about which account when multiple exist. |
| 8 | Centralized auth manager replaces scattered OAuth logic | Keep per-connector refresh functions; add adapter layer | Single component for token lifecycle, audit, scope tracking. Adding a new connector doesn't touch core logic. |
| 9 | Tenant-level OAuth app overrides for enterprise | Only shared OAuth app; separate enterprise package | One table, simple resolution order. Doesn't complicate the default path but supports enterprise needs. |
| 10 | API clients take plain `token: string` in constructor | Clients take auth manager reference; clients auto-refresh | Keeps SDK stateless and framework-free. Auth manager handles refresh before returning the token. |
| 11 | No pre-built tool schemas in connector SDK | Ship standard tools (send_email, list_events, etc.) | Each module builds its own tools. The SDK is raw material, the module is the product. Avoids lowest-common-denominator tool schemas that don't fit anyone well. |

---

## 13. Out of Scope (v1)

- Per-module rate limiting on connector API usage (audit table provides foundation)
- Webhook/push notification subscriptions per connector (e.g., Gmail push notifications)
- Connector marketplace / dynamic discovery
- Cross-tenant connector sharing
- Offline/batch token usage patterns
