# Connector SDK Design Spec (v2)

> Status: **Draft** | Date: 2026-05-28 | Supersedes: 2026-05-27-connector-sdk-design.md
>
> Incorporates peer review feedback. Changes from v1 are marked with **[v2]**.

## 1. Overview

### Problem

Module developers building on BoringOS need to integrate with external services (Google, Microsoft, Slack, GitHub, etc.). The API client packages (`@boringos/connector-google`, `@boringos/connector-slack`) already exist as standalone npm packages with zero `@boringos/core` dependency. **[v2]** However, the integration contract -- how to get a token, what scopes to declare, how OAuth is configured, how the refresh lifecycle works -- is buried inside `@boringos/core`. Module developers must read framework internals to understand the full integration story. There is no published SDK contract for connectors.

Additionally, OAuth credentials are stored as plaintext JSONB in the database today -- a live security gap that should be closed independently of any SDK redesign.

### Solution

A **connector SDK pattern** that formalizes the integration contract. Each connector package (`@boringos/connector-google`, `@boringos/connector-slack`, etc.) provides:

- Typed API clients for each service (Gmail, Calendar, Contacts, etc.)
- Scope constants and service definitions
- A universal `ConnectorDefinition` that the framework's auth manager consumes

The framework handles OAuth, token storage, refresh, and multi-account management centrally. The connector SDK has zero dependency on `@boringos/core`.

### Design Principles

- **Modules are lego blocks.** Each module is self-contained. It declares what services it needs, checks scopes at runtime, and handles missing scopes gracefully.
- **Android-style runtime permissions.** Modules check scopes when they need them. Scope upgrades flow through the framework's existing approval primitive -- no blocking promises, no jammed queues. **[v2]**
- **One interface for all connectors.** Google, Slack, GitHub, Microsoft all implement `ConnectorDefinition`. Learn it once, apply everywhere.
- **No framework coupling in the SDK.** Connector packages are pure libraries. Installable from npm, testable in isolation.
- **Single OAuth per account.** User authorizes Google once. All modules that need Google share that authorization (scoped by what each module requests).
- **Server-side account resolution.** The framework resolves which connected account a module uses via bindings configured in the UI. Modules never need to know or select account IDs. **[v2]**

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
|  - Token storage + refresh + encryption                  |
|  - Binding-based account resolution          [v2]        |
|  - Scope checking                                        |
|  - Audit logging                                         |
+----------------------------------------------------------+
             |
             v
+----------------------------------------------------------+
|  Third-party Modules                                     |
|                                                          |
|  - import { GmailClient } from "@boringos/connector-*"  |
|  - Declare connectors in manifest (advisory)             |
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
   -> Auth manager stores credentials in connector_accounts (encrypted)
   -> resolveAccountId() extracts email as account identifier

3. User assigns account to module via UI
   -> module_connector_bindings row written

4. Module tool executes at runtime
   -> Module calls deps.checkScopes() (optional, advisory)
   -> If missing scopes: tool returns { ok: false, error: "needs_scope", ... }
      -> Agent creates approval task -> user grants scope -> agent rewakes  [v2]
   -> Module calls deps.getConnectorToken(kind, callerModuleId)
      -> Auth manager resolves account from binding  [v2]
      -> Refreshes token if needed, writes audit, returns token-provider
   -> Module creates typed client: new GmailClient(tokenProvider)  [v2]
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

**[v2]** Renamed `kind` to `provider` to avoid collision with `Module.kind` (`"connector" | "module" | "hybrid"`).

```typescript
interface ConnectorDefinition {
  provider: string;          // "google", "slack", "github"  [v2: was `kind`]
  displayName: string;
  icon?: string;
  version?: number;          // [v2] interface version, default 1
  auth: AuthStrategy[];
  services: ServiceDefinition[];
  resolveAccountId(tokenResponse: Record<string, unknown>): string;
}
```

### Connected Account (returned to modules)

```typescript
interface ConnectedAccount {
  accountId: string;
  provider: string;          // [v2: was connectorKind]
  grantedScopes: string[];
  status: "active" | "expired" | "revoked";
}
```

### Extended ModuleFactoryDeps

**[v2]** Key changes from v1:
- `getConnectorToken` resolves the account from the server-side binding; no `accountId` parameter required. Optional `accountId` override for explicit multi-account scenarios.
- `requestScopes` removed. Scope upgrades flow through the existing approval primitive.

```typescript
interface ModuleFactoryDeps {
  // ... existing fields unchanged ...

  getConnectorToken(
    provider: string,
    callerModuleId: string,
    opts?: { accountId?: string },      // [v2] optional override only
  ): Promise<{
    getToken: () => Promise<string>;    // [v2] token-provider, not static string
  } | null>;

  listConnectedAccounts(
    provider: string,
  ): Promise<ConnectedAccount[]>;

  checkScopes(
    provider: string,
    scopes: string[],
    opts?: { accountId?: string },      // [v2] optional override only
  ): Promise<{
    granted: boolean;
    missing: string[];
    consentUrl?: string;                // [v2] returned when missing, for approval flow
  }>;

  // [v2] requestScopes REMOVED -- scope upgrades go through the approval primitive:
  //   tool returns { ok: false, error: "needs_scope", consentUrl }
  //   agent creates agent_action task
  //   user grants scope in browser
  //   agent rewakes via comment_posted
}
```

### Module Manifest Extension

**[v2]** Manifest declarations are **advisory** -- used for pre-install UI display ("this module uses Gmail and Calendar") and documentation. Runtime `checkScopes` is authoritative for actual access control.

```typescript
interface Module {
  // ... existing fields unchanged ...

  connectors?: Record<string, {        // keyed by provider: "google", "slack"
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
  skills/                 # [v2] skill files must be updated alongside client changes
    {service}.md
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
  provider: "google",                   // [v2: was `kind`]
  displayName: "Google Workspace",
  version: 1,                           // [v2]
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

**[v2]** Two key changes from v1:
1. Constructor accepts `string | (() => Promise<string>)` -- supports both static tokens (tests, scripts) and token-provider functions (production, auto-refresh on 401).
2. **Agent-facing tool names are stable.** The tool names registered in the module (`gmail.list_emails`, `gmail.send_email`, etc.) do not change. The typed-method refactor is internal to the client library.

```typescript
// services/gmail/client.ts
import type { GmailMessage, Thread, HistoryEvent } from "./types.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type TokenSource = string | (() => Promise<string>);   // [v2]

export class GmailClient {
  private tokenSource: TokenSource;

  constructor(token: TokenSource) {                     // [v2]
    this.tokenSource = token;
  }

  private async resolveToken(): Promise<string> {       // [v2]
    return typeof this.tokenSource === "function"
      ? this.tokenSource()
      : this.tokenSource;
  }

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

**[v2]** Internal retry behavior: each method calls `resolveToken()` before the HTTP request. On a 401 response, the method calls `resolveToken()` again (which, when backed by the auth manager's token-provider, returns a freshly refreshed token) and retries once. This replaces the deleted `runWithRefresh` with equivalent correctness, without coupling the client to any framework code.

Same pattern for `CalendarClient`, `PeopleClient`, `DriveClient`.

**[v2] Deprecation bridge:** During Phase 2, the existing `executeAction(action, inputs)` method is preserved but marked `@deprecated`. Module authors migrating incrementally can use either API. Phase 3 removes `executeAction`.

### How Another Connector Looks (Slack)

Same `ConnectorDefinition` interface, different internals:

```typescript
// @boringos/connector-slack/src/definition.ts
export const slackConnector: ConnectorDefinition = {
  provider: "slack",                    // [v2: was `kind`]
  displayName: "Slack",
  version: 1,
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
  provider: "github",                   // [v2: was `kind`]
  displayName: "GitHub",
  version: 1,
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

**[v2]** Key changes from v1:
- No `accountId` in tool inputs. The auth manager resolves the bound account server-side.
- Token is a provider function, not a static string. Clients auto-refresh on 401.
- Scope upgrades return error results; agents handle them through the approval flow.
- Agent-facing tool names are unchanged from the current codebase.

### Example: Productivity Module

```typescript
import type { ModuleFactory } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import {
  gmailService, calendarService,
  GmailClient, CalendarClient,
  GMAIL_SCOPES,
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
      name: "gmail.list_emails",                       // [v2] stable agent-facing name
      description: "Categorize unread emails by priority",
      inputs: z.object({
        maxResults: z.number().optional().default(50),
      }),
      async handler(input, ctx) {
        // Check scopes (advisory, non-blocking)
        const scopeCheck = await deps.checkScopes?.(
          "google", GMAIL_SCOPES.map(s => s.scope),
        );
        if (scopeCheck && !scopeCheck.granted) {
          return {
            ok: false,
            error: "needs_scope",                      // [v2] agent handles via approval
            result: {
              missing: scopeCheck.missing,
              consentUrl: scopeCheck.consentUrl,
            },
          };
        }

        // Get token provider -- account resolved from binding  [v2]
        const conn = await deps.getConnectorToken?.(
          "google", "productivity",
        );
        if (!conn) return { ok: false, error: "Google account not connected" };

        // Client accepts token-provider function  [v2]
        const gmail = new GmailClient(conn.getToken);
        const messages = await gmail.listMessages({ maxResults: input.maxResults });
        const triaged = categorizeByPriority(messages);
        return { ok: true, result: triaged };
      },
    },
    {
      name: "calendar.list_events",                    // [v2] stable agent-facing name
      description: "List today's events and identify gaps",
      inputs: z.object({}),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.(
          "google", "productivity",
        );
        if (!conn) return { ok: false, error: "Google account not connected" };

        const calendar = new CalendarClient(conn.getToken);
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
      name: "gmail.search_emails",                     // [v2] stable agent-facing name
      description: "Find and summarize travel/hotel booking emails",
      inputs: z.object({}),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.(
          "google", "executive-assistant",
        );
        if (!conn) return { ok: false, error: "Google not connected" };

        const gmail = new GmailClient(conn.getToken);
        const messages = await gmail.searchMessages(
          "subject:(booking OR reservation OR itinerary OR flight OR hotel)",
        );
        return { ok: true, result: extractTravelDetails(messages) };
      },
    },
    {
      name: "calendar.prep_meeting",
      description: "Pull agenda, attendees, and contact details for a meeting",
      inputs: z.object({ eventId: z.string() }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.(
          "google", "executive-assistant",
        );
        if (!conn) return { ok: false, error: "Google not connected" };

        const calendar = new CalendarClient(conn.getToken);
        const event = await calendar.getEvent(input.eventId);

        // Check contacts scope at runtime (Android-style)
        const scopeCheck = await deps.checkScopes?.(
          "google",
          contactsService.scopes.map(s => s.scope),
        );

        let attendeeDetails = null;
        if (scopeCheck?.granted) {
          const people = new PeopleClient(conn.getToken);
          attendeeDetails = await people.batchGet(
            event.attendees.map(a => a.email),
          );
        } else {
          // [v2] Graceful degradation OR return needs_scope for agent to handle
          // Module developer chooses the strategy per tool
        }

        return { ok: true, result: { event, attendeeDetails } };
      },
    },
  ],
});
```

### [v2] Scope Upgrade Flow (via existing approval primitive)

When a tool needs a scope the user hasn't granted:

```
1. Tool calls deps.checkScopes("google", contactsScopes)
   -> { granted: false, missing: ["contacts.readonly"], consentUrl: "https://..." }

2. Tool returns { ok: false, error: "needs_scope", result: { missing, consentUrl } }

3. Agent reads the error and creates a child task:
   - originKind: "agent_action"
   - proposedParams: { action: "grant_scope", provider: "google", consentUrl, scopes }

4. User sees the approval task in the UI, clicks the consent URL, grants scope in browser

5. OAuth callback updates grantedScopes on the connector_accounts row

6. User approves the agent_action task via POST /tasks/:id/decision

7. Agent rewakes (reason: "comment_posted"), retries the tool -- scope now granted
```

This reuses the HITL approval flow already taught to agents via `APPROVALS_SKILL` in `framework.ts`. No new primitives, no blocking promises, no queue jamming.

---

## 7. Framework-Side Auth Manager

### Interface

**[v2]** Key changes from v1:
- `getToken` resolves account from binding; returns a token-provider function.
- `requestScopes` removed from the interface.
- Methods use `provider` instead of `kind`.

```typescript
// @boringos/core/src/auth-manager.ts

interface AuthManager {
  // Connector lifecycle
  registerConnector(definition: ConnectorDefinition): void;
  listConnectors(): ConnectorDefinition[];
  getConnector(provider: string): ConnectorDefinition | null;

  // Account management (called by UI routes)
  startOAuthFlow(
    provider: string,
    tenantId: string,
    scopes: string[],
  ): Promise<{ authUrl: string; state: string }>;

  handleOAuthCallback(
    provider: string,
    code: string,
    state: string,
  ): Promise<ConnectedAccount>;

  addApiKeyAccount(
    provider: string,
    tenantId: string,
    apiKey: string,
    label: string,
  ): Promise<ConnectedAccount>;

  removeAccount(
    provider: string,
    accountId: string,
    tenantId: string,
  ): Promise<void>;

  // Token operations (exposed to modules via ModuleFactoryDeps)
  getToken(
    provider: string,
    tenantId: string,
    callerModuleId: string,
    opts?: { accountId?: string },
  ): Promise<{
    getToken: () => Promise<string>;    // [v2] token-provider function
  } | null>;

  listAccounts(
    provider: string,
    tenantId: string,
  ): Promise<ConnectedAccount[]>;

  // Scope checking (read-only, non-blocking)
  checkScopes(
    provider: string,
    tenantId: string,
    callerModuleId: string,
    scopes: string[],
    opts?: { accountId?: string },
  ): Promise<{
    granted: boolean;
    missing: string[];
    consentUrl?: string;                // [v2] URL for incremental consent
  }>;

  // Account-to-module binding management (called by UI routes)
  bindAccount(tenantId: string, moduleId: string, provider: string, accountId: string): Promise<void>;
  unbindAccount(tenantId: string, moduleId: string, provider: string): Promise<void>;
  getBinding(tenantId: string, moduleId: string, provider: string): Promise<string | null>;
}
```

### Token Resolution Flow

**[v2]** The `getToken` method resolves the account from the binding and returns a token-provider function that handles refresh transparently.

```
Module calls deps.getConnectorToken("google", "productivity")
  -> AuthManager.getToken("google", ctx.tenantId, "productivity")
    -> Resolve accountId from module_connector_bindings(tenantId, "productivity", "google")
    -> If no binding: return null
    -> Return { getToken: async () => {
         Read connector_accounts row
         If token expired or within 60s of expiry:
           Read ConnectorDefinition.auth (OAuth2Strategy)
           Resolve clientId: tenant override OR host env var
           Call tokenUrl with refreshToken + clientId + clientSecret
           Update connector_accounts with new token
           Write audit row to connector_token_issuance
         Return accessToken
       }}
```

The token-provider function is called by the client on each HTTP request (and again on 401 retry). This replaces `runWithRefresh` with equivalent correctness.

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
  getConnectorToken: (provider, callerId, opts) =>
    authManager.getToken(provider, tenantId, callerId, opts),
  listConnectedAccounts: (provider) =>
    authManager.listAccounts(provider, tenantId),
  checkScopes: (provider, scopes, opts) =>
    authManager.checkScopes(provider, tenantId, /* callerModuleId from closure */, scopes, opts),
  // [v2] requestScopes NOT injected -- scope upgrades go through approval flow
};
```

---

## 8. Database Schema

### [v2 Phase 0] Credential Encryption (on current schema)

Before any schema changes, encrypt the existing `credentials` JSONB column in the `connectors` table. Uses a host-level encryption key (`BORINGOS_ENCRYPTION_KEY` env var). This closes the live security gap independently of the rest of the redesign.

### connector_accounts (replaces connectors, Phase 2)

```sql
CREATE TABLE connector_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  provider        TEXT NOT NULL,         -- [v2: was `kind`]
  account_id      TEXT NOT NULL,
  auth_strategy   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  credentials     JSONB NOT NULL,        -- encrypted at rest
  granted_scopes  TEXT[] NOT NULL DEFAULT '{}',
  profile         JSONB,                 -- display name, avatar, email for UI
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider, account_id)
);
```

### connector_oauth_apps (enterprise BYOA, Phase 2)

```sql
CREATE TABLE connector_oauth_apps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  provider        TEXT NOT NULL,         -- [v2: was `kind`]
  client_id       TEXT NOT NULL,         -- encrypted at rest
  client_secret   TEXT NOT NULL,         -- encrypted at rest
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider)
);
```

OAuth client resolution order:
1. `connector_oauth_apps` row for `(tenantId, provider)` if exists
2. Host-level env var from `ConnectorDefinition.auth.clientIdEnv`

### module_connector_bindings (Phase 2)

**[v2]** This is the table that enables server-side account resolution. Modules never pass `accountId` -- the auth manager looks up the binding.

```sql
CREATE TABLE module_connector_bindings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  module_id       TEXT NOT NULL,
  provider        TEXT NOT NULL,         -- [v2: was `kind`]
  account_id      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, module_id, provider)
);
```

Written by the UI when a user assigns "this module uses this account."

### connector_token_issuance (audit, updated in Phase 2)

```sql
CREATE TABLE connector_token_issuance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT NOT NULL,
  provider          TEXT NOT NULL,       -- [v2: was `kind`]
  account_id        TEXT NOT NULL,
  caller_module_id  TEXT NOT NULL,
  outcome           TEXT NOT NULL,       -- issued, refreshed, not_connected, refresh_failed
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Migration from current schema

Existing `connectors` table rows migrate to `connector_accounts`:
- `kind` maps to `provider`
- `accountId` derived from `credentials.email` or profile data (for Google), `config.team_id` (for Slack)
- `grantedScopes` populated from the hardcoded scope sets in current `OAUTH_PROVIDERS`
- `authStrategy` set to `"oauth2"` for all existing rows
- `credentials` JSONB structure unchanged (`{ accessToken, refreshToken, expiresAt }`), encrypted

---

## 9. Multi-Tenant Model

### Tenant Isolation

Every connector account is scoped to a tenant. The `(tenant_id, provider, account_id)` unique constraint ensures full isolation. Two tenants connecting the same Google account get independent token sets, scope grants, and audit trails.

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

**[v2]** Re-sequenced based on peer review. Each phase ships independently. Safe work is not blocked by risky work.

### Phase 0: Credential Encryption (standalone)

Ships against the current `connectors` table. No API changes.

- Add `BORINGOS_ENCRYPTION_KEY` env var support
- Encrypt `credentials` JSONB on write, decrypt on read
- Migration script to encrypt existing plaintext rows
- Closes the live security gap documented in `docs/blockers/task_12_greenfield_rebuild.md`

### Phase 1: ConnectorDefinition + Typed Clients (additive, low-risk)

No breaking changes. Existing `executeAction` kept as deprecated.

- Add `ConnectorDefinition`, `ServiceDefinition`, `AuthStrategy`, `ScopeDefinition`, `ConnectedAccount` types to `@boringos/module-sdk`
- Add `connectors` advisory field to `Module` interface
- Refactor `@boringos/connector-google`: add `ConnectorDefinition` export, typed client methods (alongside deprecated `executeAction`), scope constants, service definitions, TypeScript types
- Refactor `@boringos/connector-slack`: same pattern
- **[v2] Update skill files** (`skills/gmail.md`, `skills/calendar.md`) to document the new typed methods while preserving references to stable tool names
- **[v2] Agent-facing tool names preserved**: `gmail.list_emails`, `gmail.send_email`, `calendar.list_events`, etc. remain unchanged

### Phase 2: Auth Manager + Schema Migration (medium risk)

- Add `connector_accounts`, `connector_oauth_apps`, `module_connector_bindings` tables
- Migrate existing `connectors` rows into `connector_accounts`
- Build the `AuthManager` component, wire into `boringos.ts`
- Refactor `connector-routes.ts` to delegate to auth manager
- Add `listConnectedAccounts`, `checkScopes` to `ModuleFactoryDeps`
- Update `getConnectorToken` to use binding-based resolution and return token-provider function
- Update built-in `google.ts` and `slack.ts` modules to use `deps.getConnectorToken` + typed client methods (no more direct DB queries for credentials)
- **[v2] Remove deprecated `executeAction`** from connector packages
- Remove: `oauth.ts` hardcoded `OAUTH_PROVIDERS`, per-module `loadGoogleCreds` / `loadSlackCreds`, `runWithRefresh`
- **[v2] Update inline skill strings** in built-in modules to reflect new patterns

### Phase 3: Multi-Account UI + Scope Upgrade UX (only if demand exists)

- Shell UI for connecting/disconnecting multiple accounts per connector
- Module settings UI for binding accounts to modules
- Account status display (active, expired, revoked)
- Scope consent prompt flow integrated with the approval primitive
- **[v2]** Only ships when a real use case demands multi-account. Data model supports it from Phase 2; UI is the expensive part.

---

## 11. Breaking Changes

**[v2]** Phased to reduce blast radius. No big-bang migration.

| Change | Phase | Impact | Migration |
|---|---|---|---|
| Credential encryption | 0 | Transparent to modules | Automatic migration script |
| `ConnectorDefinition` types added | 1 | None (additive) | -- |
| Typed client methods added | 1 | None (`executeAction` kept as deprecated) | Optional adoption |
| `executeAction` removed | 2 | All call sites using old dispatch | Switch to typed methods |
| `getConnectorToken` signature updated | 2 | All modules calling `deps.getConnectorToken` | Update: no more `tenantId` param, returns `getToken` function |
| `connectors` table replaced by `connector_accounts` | 2 | Any direct DB queries | Use auth manager methods |
| `OAUTH_PROVIDERS` removed | 2 | `connector-routes.ts` | Auth manager reads from registered ConnectorDefinitions |
| `loadGoogleCreds` / `loadSlackCreds` removed | 2 | Built-in modules only | Use `deps.getConnectorToken` |
| `runWithRefresh` removed | 2 | Built-in google module only | Token-provider function handles refresh |

**[v2] Stable across all phases:** Agent-facing tool names (`gmail.list_emails`, `gmail.read_email`, `gmail.send_email`, `gmail.reply_email`, `gmail.search_emails`, `calendar.list_events`, `calendar.create_event`, `calendar.update_event`, `calendar.find_free_slots`, `send_message`, `reply_in_thread`, `add_reaction`).

---

## 12. Decision Log

| # | Decision | Alternatives Considered | Why This Option |
|---|---|---|---|
| 1 | Connector SDK is a pure client library with zero `@boringos/core` dependency | SDK as a full Module; SDK with embedded OAuth logic | Module developers install from npm without pulling in the framework. Keeps the SDK testable and portable. |
| 2 | Common `ConnectorDefinition` interface in `@boringos/module-sdk` | Per-connector ad-hoc shapes; separate `@boringos/connector-types` package | One interface for all connectors. Lives where module developers already depend. No extra package. |
| 3 | Multi-account per provider per tenant | Single account per provider (current design) | User connects multiple Google accounts, assigns them to different modules. Real-world SaaS requirement. Data model from Phase 2; UI deferred to Phase 3. |
| 4 | Android-style runtime scope checks; upgrades via approval primitive | Install-time scope union; blocking `requestScopes` promise | **[v2]** Blocking promise jams the serial queue. Approval primitive already exists (`agent_action` tasks + `POST /tasks/:id/decision`). No new primitives needed. |
| 5 | Typed client methods instead of `executeAction` dispatch | Keep stringly-typed dispatch; add type layer on top | Type safety, discoverability, IDE autocomplete. Module developers see exactly what's available without reading source. |
| 6 | Module declares `connectors` field on manifest (advisory) | No manifest declaration (runtime only); declare at tool level | **[v2]** Advisory only. Framework can show "this module uses Gmail and Calendar" before install. Runtime `checkScopes` is authoritative. |
| 7 | Server-side binding resolution for account selection | `accountId` in every tool input; agent picks account | **[v2]** Binding table resolves `(tenantId, moduleId, provider)` to an account. No schema pollution. Agent doesn't need to know account IDs. Optional `accountId` override for explicit multi-account. |
| 8 | Centralized auth manager replaces scattered OAuth logic | Keep per-connector refresh functions; add adapter layer | Single component for token lifecycle, audit, scope tracking. Adding a new connector doesn't touch core logic. |
| 9 | Tenant-level OAuth app overrides for enterprise | Only shared OAuth app; separate enterprise package | One table, simple resolution order. Doesn't complicate the default path but supports enterprise needs. |
| 10 | Clients accept `string \| (() => Promise<string>)` token source | Static string only; clients hold auth manager reference | **[v2]** Token-provider function enables transparent refresh on 401 without coupling clients to the framework. Static string still works for tests. Replaces `runWithRefresh`. |
| 11 | No pre-built tool schemas in connector SDK | Ship standard tools (send_email, list_events, etc.) | Each module builds its own tools. The SDK is raw material, the module is the product. |
| 12 | `provider` field instead of `kind` on ConnectorDefinition | Reuse `kind` | **[v2]** `Module.kind` is already `"connector" \| "module" \| "hybrid"`. Different semantics, same name causes confusion. |
| 13 | Ship encryption first, independently | Bundle with schema migration | **[v2]** Live security gap. Depends on zero redesign work. |
| 14 | Deprecation bridge for `executeAction` | Big-bang removal | **[v2]** Phase 1 adds typed methods alongside deprecated `executeAction`. Phase 2 removes it. Reduces migration risk. |
| 15 | Preserve agent-facing tool names across all phases | Rename tools to match typed methods | **[v2]** Agents and skills depend on stable tool names. Internal client refactor must not change the tool registration names. |

---

## 13. Out of Scope (v1)

- Per-module rate limiting on connector API usage (audit table provides foundation)
- Webhook/push notification subscriptions per connector (e.g., Gmail push notifications)
- Connector marketplace / dynamic discovery
- Cross-tenant connector sharing
- Offline/batch token usage patterns
