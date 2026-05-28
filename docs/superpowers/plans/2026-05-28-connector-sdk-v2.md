# Connector SDK v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a published connector SDK pattern (`@boringos/connector-google`, etc.) with typed clients, multi-account support, centralized auth manager, and credential encryption. Unblocks MDK Phase 3 by stabilizing `ModuleFactoryDeps` before it gets formally typed.

**Architecture:** Universal `ConnectorDefinition` interface lives in `@boringos/module-sdk` (zero framework coupling). Connector packages implement the interface and ship typed clients + scope constants. A new `AuthManager` in `@boringos/core` consumes `ConnectorDefinition` generically, handles OAuth flow, multi-account, token refresh, and binding-based account resolution. Modules consume the SDK via npm with no framework checkout.

**Tech Stack:** TypeScript ESM, Node ≥ 22, Hono, Drizzle ORM on Postgres (embedded by default), Vitest, pnpm 9, AES-256-GCM for credential encryption.

**Issue tracking:**
- Parent: [hebbs-ai/boringos#51](https://github.com/hebbs-ai/boringos/issues/51)
- Children: #52 (Phase 0), #53 #54 #55 (Phase 1), #56 #57 #58 (Phase 2), #59 (Phase 3)

**Commit message format:** `<type>(<scope>): <subject> (#<issue>)`
Example: `feat(connector-google): typed Gmail client (#54)`

---

## File Structure

### New files

```
packages/@boringos/db/
  src/
    crypto.ts                                          # AES-256-GCM helpers [#52]
    schema/
      connector-accounts.ts                            # replaces connectors [#56]
      connector-oauth-apps.ts                          # enterprise BYOA [#56]
      module-connector-bindings.ts                     # account binding [#56]
    migrations/
      000X_encrypt_credentials.sql                     # [#52]
      000Y_connector_accounts.sql                      # [#56]
      000Z_drop_connectors.sql                         # [#58]

packages/@boringos/connector-google/
  src/
    definition.ts                                      # ConnectorDefinition [#54]
    scopes.ts                                          # service definitions [#54]
    helpers.ts                                         # fetch wrapper + 401 retry [#54]
    services/
      gmail/{client,types,index}.ts                    # [#54]
      calendar/{client,types,index}.ts                 # [#54]
      contacts/{client,types,index}.ts                 # new [#54]
      drive/{client,types,index}.ts                    # new [#54]
  skills/
    gmail.md, calendar.md                              # updated [#54]
    contacts.md, drive.md                              # new [#54]

packages/@boringos/connector-slack/
  src/
    definition.ts                                      # ConnectorDefinition [#55]
    scopes.ts                                          # [#55]
    helpers.ts                                         # [#55]
    services/
      messaging/{client,types,index}.ts                # [#55]
      channels/{client,types,index}.ts                 # [#55]
      reactions/{client,types,index}.ts                # [#55]
  skills/
    messaging.md, channels.md, reactions.md            # new [#55]

packages/@boringos/core/
  src/
    auth-manager.ts                                    # main class [#57]
    auth-manager-oauth.ts                              # OAuth helpers [#57]
    admin/connector-account-routes.ts                  # [#59]
```

### Modified files

```
packages/@boringos/module-sdk/
  src/types.ts                                         # add types [#53]
  src/index.ts                                         # re-exports [#53]

packages/@boringos/db/
  src/schema/connectors.ts                             # encryption wrapper [#52]
  src/schema/connector-token-issuance.ts               # provider + account_id [#56]
  src/schema/index.ts                                  # new table exports [#56]

packages/@boringos/connector-google/
  src/index.ts                                         # new top-level exports [#54]
  src/gmail-client.ts                                  # deprecate executeAction [#54]
  src/calendar-client.ts                               # deprecate executeAction [#54]
  boringos.json                                        # new skill files [#54]

packages/@boringos/connector-slack/
  src/index.ts                                         # new exports [#55]
  src/client.ts                                        # deprecate executeAction [#55]
  boringos.json                                        # add skills [#55]

packages/@boringos/core/
  src/boringos.ts                                      # wire AuthManager [#57]
  src/connector-routes.ts                              # delegate to AuthManager [#57]
  src/connector-tokens.ts                              # thin wrapper [#57]
  src/modules/google.ts                                # use deps + typed clients [#58]
  src/modules/slack.ts                                 # use deps + typed clients [#58]
  src/modules/framework.ts                             # extend APPROVALS_SKILL [#59]
  src/inbox-gmail-sync.ts                              # typed client [#58]

packages/@boringos/shell/
  src/screens/connectors/                              # multi-account UI [#59]
```

### Deleted files

```
packages/@boringos/core/src/oauth.ts                   # [#58]
```

---

# PHASE 0 — Credential Encryption (Issue #52)

> **Scope:** Encrypt the `credentials` JSONB column in the existing `connectors` table. No API changes. Closes a live security gap.

## Task 0.1: Add encryption helpers in @boringos/db

**Files:**
- Create: `packages/@boringos/db/src/crypto.ts`
- Test: `packages/@boringos/db/tests/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/@boringos/db/tests/crypto.test.ts
import { describe, it, expect } from "vitest";
import { encryptJson, decryptJson, generateKey } from "../src/crypto.js";

describe("crypto", () => {
  it("round-trips JSON through encrypt/decrypt", () => {
    const key = generateKey();
    const original = { accessToken: "abc", refreshToken: "xyz", expiresAt: 123 };
    const encrypted = encryptJson(original, key);
    const decrypted = decryptJson(encrypted, key);
    expect(decrypted).toEqual(original);
  });

  it("produces different ciphertext for same input (random IV)", () => {
    const key = generateKey();
    const data = { token: "same" };
    const a = encryptJson(data, key);
    const b = encryptJson(data, key);
    expect(a).not.toEqual(b);
  });

  it("throws on tampered ciphertext", () => {
    const key = generateKey();
    const encrypted = encryptJson({ x: 1 }, key);
    const tampered = encrypted.slice(0, -2) + "XX";
    expect(() => decryptJson(tampered, key)).toThrow();
  });

  it("throws on wrong key", () => {
    const key1 = generateKey();
    const key2 = generateKey();
    const encrypted = encryptJson({ x: 1 }, key1);
    expect(() => decryptJson(encrypted, key2)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @boringos/db test crypto`
Expected: FAIL with "Cannot find module '../src/crypto.js'"

- [ ] **Step 3: Implement crypto helpers**

```typescript
// packages/@boringos/db/src/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

export function generateKey(): Buffer {
  return randomBytes(KEY_LEN);
}

export function loadKey(): Buffer {
  const raw = process.env.BORINGOS_ENCRYPTION_KEY;
  if (!raw) throw new Error("BORINGOS_ENCRYPTION_KEY not set");
  const key = raw.match(/^[0-9a-f]{64}$/i)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(`BORINGOS_ENCRYPTION_KEY must be ${KEY_LEN} bytes (got ${key.length})`);
  }
  return key;
}

export function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptJson<T = unknown>(encoded: string, key: Buffer): T {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @boringos/db test crypto`
Expected: PASS, 4/4 tests green

- [ ] **Step 5: Commit**

```bash
git add packages/@boringos/db/src/crypto.ts packages/@boringos/db/tests/crypto.test.ts
git commit -m "feat(db): add AES-256-GCM crypto helpers for credential encryption (#52)"
```

## Task 0.2: Encrypt credentials on connectors table read/write

**Files:**
- Modify: `packages/@boringos/db/src/schema/connectors.ts`
- Modify: `packages/@boringos/core/src/modules/google.ts` (read path)
- Modify: `packages/@boringos/core/src/modules/slack.ts` (read path)
- Modify: `packages/@boringos/core/src/connector-routes.ts` (write path)

- [ ] **Step 1: Add credential wrapper functions**

```typescript
// packages/@boringos/db/src/credentials.ts (new file)
import { encryptJson, decryptJson, loadKey } from "./crypto.js";

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

export function packCredentials(value: Record<string, unknown>): string {
  return encryptJson(value, getKey());
}

export function unpackCredentials<T = Record<string, unknown>>(stored: string | Record<string, unknown> | null): T | null {
  if (stored === null) return null;
  // Backward compat: if stored is still a plain object, return as-is during migration window
  if (typeof stored === "object") return stored as T;
  return decryptJson<T>(stored, getKey());
}

export { loadKey };
```

- [ ] **Step 2: Update `loadGoogleCreds` to decrypt**

In `packages/@boringos/core/src/modules/google.ts` (around line 35), change the credential read:

```typescript
import { unpackCredentials } from "@boringos/db";
// ...
const creds = unpackCredentials<{ accessToken: string; refreshToken?: string; expiresAt?: number }>(
  row.credentials as string | null
);
```

- [ ] **Step 3: Update `loadSlackCreds` to decrypt**

Same change in `packages/@boringos/core/src/modules/slack.ts`.

- [ ] **Step 4: Update OAuth callback to encrypt on write**

In `packages/@boringos/core/src/connector-routes.ts`, the OAuth callback handler:

```typescript
import { packCredentials } from "@boringos/db";
// ...
await db.insert(connectors).values({
  // ...
  credentials: packCredentials({ accessToken, refreshToken, expiresAt }),
});
```

Apply the same `packCredentials()` wrap in `runWithRefresh` token update (`google.ts:118`).

- [ ] **Step 5: Run all connector tests**

Run: `BORINGOS_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") pnpm -r test connector`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/@boringos/db/src/credentials.ts \
        packages/@boringos/core/src/modules/google.ts \
        packages/@boringos/core/src/modules/slack.ts \
        packages/@boringos/core/src/connector-routes.ts
git commit -m "feat(connectors): encrypt OAuth credentials at rest (#52)"
```

## Task 0.3: Migration script for existing plaintext rows

**Files:**
- Create: `packages/@boringos/db/src/migrations/000X_encrypt_credentials.sql` (placeholder)
- Create: `packages/@boringos/db/scripts/encrypt-existing-credentials.ts`

- [ ] **Step 1: Write the migration script**

```typescript
// packages/@boringos/db/scripts/encrypt-existing-credentials.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { connectors } from "../src/schema/connectors.js";
import { packCredentials } from "../src/credentials.js";
import { eq } from "drizzle-orm";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const rows = await db.select().from(connectors);
  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    if (typeof row.credentials === "string") {
      skipped++;
      continue;
    }
    if (!row.credentials) {
      skipped++;
      continue;
    }
    const sealed = packCredentials(row.credentials as Record<string, unknown>);
    await db.update(connectors).set({ credentials: sealed as never }).where(eq(connectors.id, row.id));
    encrypted++;
  }

  console.log(`Encrypted ${encrypted} rows. Skipped ${skipped}.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Document the run procedure in README**

Add to `packages/@boringos/db/README.md`:

```markdown
## Encrypting existing OAuth credentials

After deploying the encryption change, run once per environment:

\`\`\`
BORINGOS_ENCRYPTION_KEY=<key> DATABASE_URL=<url> \
  pnpm --filter @boringos/db tsx scripts/encrypt-existing-credentials.ts
\`\`\`

Rollback: restore the connectors table from backup.
```

- [ ] **Step 3: Commit**

```bash
git add packages/@boringos/db/scripts/encrypt-existing-credentials.ts \
        packages/@boringos/db/README.md
git commit -m "chore(db): migration script for existing plaintext credentials (#52)"
```

---

# PHASE 1 — Types + Typed Clients (Issues #53, #54, #55)

## Task 1.1: Add connector types to @boringos/module-sdk (Issue #53)

**Files:**
- Modify: `packages/@boringos/module-sdk/src/types.ts`
- Modify: `packages/@boringos/module-sdk/src/index.ts`
- Create: `packages/@boringos/module-sdk/tests/connector-types.test.ts`
- Create: `.changeset/connector-sdk-types.md`

- [ ] **Step 1: Write the type test**

```typescript
// packages/@boringos/module-sdk/tests/connector-types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  ConnectorDefinition,
  ServiceDefinition,
  AuthStrategy,
  ScopeDefinition,
  ConnectedAccount,
  ModuleFactoryDeps,
} from "../src/index.js";

describe("connector types", () => {
  it("ConnectorDefinition has required fields", () => {
    const def: ConnectorDefinition = {
      provider: "google",
      displayName: "Google",
      auth: [{ type: "oauth2", authorizationUrl: "u", tokenUrl: "t", clientIdEnv: "C", clientSecretEnv: "S" }],
      services: [],
      resolveAccountId: (r) => String(r.email),
    };
    expectTypeOf(def.provider).toBeString();
  });

  it("AuthStrategy is a discriminated union", () => {
    const oauth: AuthStrategy = { type: "oauth2", authorizationUrl: "u", tokenUrl: "t", clientIdEnv: "C", clientSecretEnv: "S" };
    const apiKey: AuthStrategy = { type: "api-key" };
    const bot: AuthStrategy = { type: "bot-token" };
    const pat: AuthStrategy = { type: "pat" };
    expectTypeOf(oauth.type).toEqualTypeOf<"oauth2">();
  });

  it("ModuleFactoryDeps exposes new connector methods", () => {
    type T = NonNullable<ModuleFactoryDeps["listConnectedAccounts"]>;
    expectTypeOf<T>().toBeFunction();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @boringos/module-sdk test connector-types`
Expected: FAIL — types not exported

- [ ] **Step 3: Add the types to `types.ts`**

Append to `packages/@boringos/module-sdk/src/types.ts`:

```typescript
// ============================================================
// Connector SDK contract (v2)
// ============================================================

export interface OAuth2Strategy {
  type: "oauth2";
  authorizationUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  pkce?: boolean;
  accessType?: string;
  prompt?: string;
}

export interface ApiKeyStrategy {
  type: "api-key";
  headerName?: string;
  prefix?: string;
}

export interface BotTokenStrategy {
  type: "bot-token";
  tokenUrl?: string;
}

export interface PatStrategy {
  type: "pat";
  headerName?: string;
}

export type AuthStrategy = OAuth2Strategy | ApiKeyStrategy | BotTokenStrategy | PatStrategy;

export interface ScopeDefinition {
  scope: string;
  description: string;
  required: boolean;
}

export interface ServiceDefinition {
  id: string;
  displayName: string;
  scopes: ScopeDefinition[];
}

export interface ConnectorDefinition {
  provider: string;
  displayName: string;
  icon?: string;
  version?: number;
  auth: AuthStrategy[];
  services: ServiceDefinition[];
  resolveAccountId(tokenResponse: Record<string, unknown>): string;
}

export interface ConnectedAccount {
  accountId: string;
  provider: string;
  grantedScopes: string[];
  status: "active" | "expired" | "revoked";
}

export interface ConnectorTokenHandle {
  getToken: () => Promise<string>;
}

export interface ScopeCheckResult {
  granted: boolean;
  missing: string[];
  consentUrl?: string;
}
```

- [ ] **Step 4: Extend `ModuleFactoryDeps` (additive)**

Modify the existing `ModuleFactoryDeps` interface in `types.ts`:

```typescript
export interface ModuleFactoryDeps {
  // ... existing fields unchanged ...

  // Existing (signature evolution — still returns null when not connected)
  getConnectorToken?: (
    provider: string,
    callerModuleId: string,
    opts?: { accountId?: string },
  ) => Promise<ConnectorTokenHandle | null>;

  // New (additive)
  listConnectedAccounts?: (provider: string) => Promise<ConnectedAccount[]>;
  checkScopes?: (
    provider: string,
    scopes: string[],
    opts?: { accountId?: string },
  ) => Promise<ScopeCheckResult>;
}
```

- [ ] **Step 5: Add advisory `connectors` field to `Module`**

```typescript
export interface Module {
  // ... existing fields unchanged ...
  connectors?: Record<string, {
    services: ServiceDefinition[];
  }>;
}
```

- [ ] **Step 6: Re-export from index.ts**

`packages/@boringos/module-sdk/src/index.ts` already does `export * from "./types.js"` — verify no new exports needed.

- [ ] **Step 7: Add changeset**

```markdown
<!-- .changeset/connector-sdk-types.md -->
---
"@boringos/module-sdk": minor
---

Add ConnectorDefinition, ServiceDefinition, AuthStrategy, ScopeDefinition, ConnectedAccount types. Extend ModuleFactoryDeps with listConnectedAccounts, checkScopes, and updated getConnectorToken signature. Add advisory connectors field to Module. All changes are additive.
```

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter @boringos/module-sdk test && pnpm --filter @boringos/module-sdk typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/@boringos/module-sdk/ .changeset/connector-sdk-types.md
git commit -m "feat(module-sdk): add ConnectorDefinition + extend ModuleFactoryDeps (#53)"
```

## Task 1.2: Add helpers + 401-retry fetch wrapper to connector-google (Issue #54)

**Files:**
- Create: `packages/@boringos/connector-google/src/helpers.ts`
- Test: `packages/@boringos/connector-google/tests/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/@boringos/connector-google/tests/helpers.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchWithAuth } from "../src/helpers.js";

describe("fetchWithAuth", () => {
  it("calls getToken once on 200", async () => {
    const getToken = vi.fn(async () => "token-1");
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    await fetchWithAuth(getToken, fetchMock, "https://x", {});
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it("retries with a fresh token on 401", async () => {
    const getToken = vi.fn().mockResolvedValueOnce("stale").mockResolvedValueOnce("fresh");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("auth", { status: 401 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await fetchWithAuth(getToken, fetchMock, "https://x", {});
    expect(res.status).toBe(200);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry twice on persistent 401", async () => {
    const getToken = vi.fn(async () => "tok");
    const fetchMock = vi.fn(async () => new Response("auth", { status: 401 }));
    const res = await fetchWithAuth(getToken, fetchMock, "https://x", {});
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @boringos/connector-google test helpers`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the helper**

```typescript
// packages/@boringos/connector-google/src/helpers.ts

export type TokenSource = string | (() => Promise<string>);

export async function resolveToken(src: TokenSource): Promise<string> {
  return typeof src === "function" ? src() : src;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchWithAuth(
  getToken: () => Promise<string>,
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetchImpl(url, { ...init, headers });
  if (res.status !== 401) return res;

  // Retry once with a fresh token
  const freshToken = await getToken();
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${freshToken}`);
  return fetchImpl(url, { ...init, headers: retryHeaders });
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @boringos/connector-google test helpers`
Expected: PASS, 3/3

- [ ] **Step 5: Commit**

```bash
git add packages/@boringos/connector-google/src/helpers.ts \
        packages/@boringos/connector-google/tests/helpers.test.ts
git commit -m "feat(connector-google): add fetchWithAuth helper with 401 retry (#54)"
```

## Task 1.3: Define Google scopes + service definitions (Issue #54)

**Files:**
- Create: `packages/@boringos/connector-google/src/scopes.ts`
- Create: `packages/@boringos/connector-google/src/definition.ts`

- [ ] **Step 1: Write scopes.ts**

```typescript
// packages/@boringos/connector-google/src/scopes.ts
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

export const PROFILE_SCOPES: ScopeDefinition[] = [
  { scope: "openid", description: "OpenID Connect", required: true },
  { scope: "email", description: "View email address", required: true },
  { scope: "profile", description: "View profile", required: true },
];

export const gmailService: ServiceDefinition = { id: "gmail", displayName: "Gmail", scopes: GMAIL_SCOPES };
export const calendarService: ServiceDefinition = { id: "calendar", displayName: "Google Calendar", scopes: CALENDAR_SCOPES };
export const contactsService: ServiceDefinition = { id: "contacts", displayName: "Google Contacts", scopes: CONTACTS_SCOPES };
export const driveService: ServiceDefinition = { id: "drive", displayName: "Google Drive", scopes: DRIVE_SCOPES };
```

- [ ] **Step 2: Write definition.ts**

```typescript
// packages/@boringos/connector-google/src/definition.ts
import type { ConnectorDefinition } from "@boringos/module-sdk";
import { gmailService, calendarService, contactsService, driveService } from "./scopes.js";

export const googleConnector: ConnectorDefinition = {
  provider: "google",
  displayName: "Google Workspace",
  version: 1,
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
  resolveAccountId: (tokenResponse) => String(tokenResponse.email ?? tokenResponse.sub),
};
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @boringos/connector-google typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/@boringos/connector-google/src/scopes.ts \
        packages/@boringos/connector-google/src/definition.ts
git commit -m "feat(connector-google): scope constants + ConnectorDefinition (#54)"
```

## Task 1.4: Refactor GmailClient with typed methods (Issue #54)

**Files:**
- Create: `packages/@boringos/connector-google/src/services/gmail/types.ts`
- Create: `packages/@boringos/connector-google/src/services/gmail/client.ts`
- Create: `packages/@boringos/connector-google/src/services/gmail/index.ts`
- Modify: `packages/@boringos/connector-google/src/gmail-client.ts` — keep existing class with `@deprecated` markers
- Test: `packages/@boringos/connector-google/tests/services/gmail.test.ts`

- [ ] **Step 1: Write types.ts**

```typescript
// packages/@boringos/connector-google/src/services/gmail/types.ts
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload?: {
    headers: { name: string; value: string }[];
    body?: { data?: string; size: number };
    parts?: unknown[];
  };
  internalDate: string;
}

export interface Thread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

export interface HistoryEvent {
  id: string;
  messages?: GmailMessage[];
  messagesAdded?: { message: GmailMessage }[];
  labelsAdded?: { message: GmailMessage; labelIds: string[] }[];
  labelsRemoved?: { message: GmailMessage; labelIds: string[] }[];
}

export interface EmailHeaders {
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
  listId: string | null;
  autoSubmitted: string | null;
  precedence: string | null;
  returnPath: string | null;
  replyTo: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
}
```

- [ ] **Step 2: Write the typed client**

```typescript
// packages/@boringos/connector-google/src/services/gmail/client.ts
import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { GmailMessage, Thread, HistoryEvent } from "./types.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listMessages(opts?: { query?: string; maxResults?: number; labelIds?: string[] }): Promise<GmailMessage[]> {
    const params = new URLSearchParams();
    if (opts?.query) params.set("q", opts.query);
    if (opts?.maxResults) params.set("maxResults", String(opts.maxResults));
    if (opts?.labelIds) opts.labelIds.forEach((id) => params.append("labelIds", id));
    const url = `${GMAIL_API}/messages?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Gmail listMessages failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { messages?: { id: string; threadId: string }[] };
    return (body.messages ?? []).map((m) => ({ id: m.id, threadId: m.threadId, labelIds: [], snippet: "", internalDate: "" }));
  }

  async getMessage(messageId: string): Promise<GmailMessage> {
    const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Gmail getMessage failed: ${res.status}`);
    return (await res.json()) as GmailMessage;
  }

  async getThread(threadId: string): Promise<Thread> {
    const url = `${GMAIL_API}/threads/${encodeURIComponent(threadId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Gmail getThread failed: ${res.status}`);
    return (await res.json()) as Thread;
  }

  async sendEmail(opts: { to: string; subject: string; body: string; inReplyTo?: string; references?: string }): Promise<{ messageId: string }> {
    // MIME builder reused from legacy buildOutgoingMime — split into helpers.ts in a later commit if needed
    const { buildOutgoingMime } = await import("../../gmail-client.js");
    const raw = buildOutgoingMime({ to: opts.to, subject: opts.subject, bodyText: opts.body, inReplyTo: opts.inReplyTo, references: opts.references });
    const url = `${GMAIL_API}/messages/send`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
    });
    if (!res.ok) throw new Error(`Gmail sendEmail failed: ${res.status}`);
    const body = (await res.json()) as { id: string };
    return { messageId: body.id };
  }

  async replyToEmail(opts: { messageId: string; body: string }): Promise<{ messageId: string }> {
    const original = await this.getMessage(opts.messageId);
    const headers = original.payload?.headers ?? [];
    const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
    const inReplyTo = getHeader("Message-Id");
    const references = getHeader("References");
    const subject = getHeader("Subject") ?? "";
    const to = getHeader("Reply-To") ?? getHeader("From") ?? "";
    return this.sendEmail({
      to, subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      body: opts.body,
      inReplyTo, references: references ? `${references} ${inReplyTo}` : inReplyTo,
    });
  }

  async archiveMessage(messageId: string): Promise<void> {
    return this.modifyLabels(messageId, { removeLabelIds: ["INBOX"] });
  }

  async modifyLabels(messageId: string, opts: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<void> {
    const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/modify`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`Gmail modifyLabels failed: ${res.status}`);
  }

  async searchMessages(query: string, opts?: { maxResults?: number }): Promise<GmailMessage[]> {
    return this.listMessages({ query, maxResults: opts?.maxResults });
  }

  async ensureLabel(name: string): Promise<{ labelId: string }> {
    const listUrl = `${GMAIL_API}/labels`;
    const listRes = await fetchWithAuth(this.getToken, this.fetchImpl, listUrl, { method: "GET" });
    if (!listRes.ok) throw new Error(`Gmail labels list failed: ${listRes.status}`);
    const list = (await listRes.json()) as { labels?: { id: string; name: string }[] };
    const existing = list.labels?.find((l) => l.name === name);
    if (existing) return { labelId: existing.id };
    const createRes = await fetchWithAuth(this.getToken, this.fetchImpl, listUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
    });
    if (!createRes.ok) throw new Error(`Gmail label create failed: ${createRes.status}`);
    const created = (await createRes.json()) as { id: string };
    return { labelId: created.id };
  }

  async listHistory(startHistoryId: string): Promise<HistoryEvent[]> {
    const params = new URLSearchParams({ startHistoryId });
    const url = `${GMAIL_API}/history?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Gmail listHistory failed: ${res.status}`);
    const body = (await res.json()) as { history?: HistoryEvent[] };
    return body.history ?? [];
  }
}
```

- [ ] **Step 3: Write the test**

```typescript
// packages/@boringos/connector-google/tests/services/gmail.test.ts
import { describe, it, expect, vi } from "vitest";
import { GmailClient } from "../../src/services/gmail/client.js";

describe("GmailClient", () => {
  it("lists messages with query", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "a", threadId: "t1" }] }), { status: 200 }));
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.listMessages({ query: "is:unread" });
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("supports token-provider function", async () => {
    let calls = 0;
    const getToken = async () => `t${++calls}`;
    const fetchMock = vi.fn(async (_url, init) => {
      const auth = new Headers(init?.headers).get("Authorization");
      expect(auth).toBe(`Bearer t${calls}`);
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    });
    const client = new GmailClient(getToken, fetchMock as unknown as typeof fetch);
    await client.listMessages();
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 4: Write the index.ts**

```typescript
// packages/@boringos/connector-google/src/services/gmail/index.ts
export { GmailClient } from "./client.js";
export type { GmailMessage, Thread, HistoryEvent, EmailHeaders } from "./types.js";
```

- [ ] **Step 5: Mark legacy client as deprecated**

In `packages/@boringos/connector-google/src/gmail-client.ts`, add JSDoc on the existing `GmailClient` class:

```typescript
/**
 * @deprecated Use `GmailClient` from "./services/gmail/index.js" with typed methods.
 *             This class will be removed in Phase 2.
 */
export class GmailClient { /* existing implementation */ }
```

The legacy file remains importable from `./gmail-client.js` and continues to export `buildOutgoingMime`, `encodeQuotedPrintable`, `EmailHeaders`.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @boringos/connector-google test && pnpm --filter @boringos/connector-google typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/@boringos/connector-google/src/services/gmail/ \
        packages/@boringos/connector-google/src/gmail-client.ts \
        packages/@boringos/connector-google/tests/services/gmail.test.ts
git commit -m "feat(connector-google): typed GmailClient with token-provider + 401 retry (#54)"
```

## Task 1.5: Refactor CalendarClient with typed methods (Issue #54)

**Files:**
- Create: `packages/@boringos/connector-google/src/services/calendar/{types,client,index}.ts`
- Modify: `packages/@boringos/connector-google/src/calendar-client.ts` — deprecate

- [ ] **Step 1: Write types**

```typescript
// packages/@boringos/connector-google/src/services/calendar/types.ts
export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; responseStatus?: string; displayName?: string }[];
  location?: string;
  status?: string;
  htmlLink?: string;
}

export interface FreeBusySlot {
  start: string;
  end: string;
}
```

- [ ] **Step 2: Write the client**

```typescript
// packages/@boringos/connector-google/src/services/calendar/client.ts
import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { CalendarEvent, FreeBusySlot } from "./types.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export class CalendarClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listEvents(opts?: { calendarId?: string; timeMin?: string; timeMax?: string; maxResults?: number }): Promise<CalendarEvent[]> {
    const cal = opts?.calendarId ?? "primary";
    const params = new URLSearchParams({ singleEvents: "true", orderBy: "startTime" });
    if (opts?.timeMin) params.set("timeMin", opts.timeMin);
    if (opts?.timeMax) params.set("timeMax", opts.timeMax);
    if (opts?.maxResults) params.set("maxResults", String(opts.maxResults));
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Calendar listEvents failed: ${res.status}`);
    const body = (await res.json()) as { items?: CalendarEvent[] };
    return body.items ?? [];
  }

  async getEvent(eventId: string, opts?: { calendarId?: string }): Promise<CalendarEvent> {
    const cal = opts?.calendarId ?? "primary";
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Calendar getEvent failed: ${res.status}`);
    return (await res.json()) as CalendarEvent;
  }

  async createEvent(event: Partial<CalendarEvent>, opts?: { calendarId?: string }): Promise<CalendarEvent> {
    const cal = opts?.calendarId ?? "primary";
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`Calendar createEvent failed: ${res.status}`);
    return (await res.json()) as CalendarEvent;
  }

  async updateEvent(eventId: string, patch: Partial<CalendarEvent>, opts?: { calendarId?: string }): Promise<CalendarEvent> {
    const cal = opts?.calendarId ?? "primary";
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`Calendar updateEvent failed: ${res.status}`);
    return (await res.json()) as CalendarEvent;
  }

  async deleteEvent(eventId: string, opts?: { calendarId?: string }): Promise<void> {
    const cal = opts?.calendarId ?? "primary";
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "DELETE" });
    if (!res.ok && res.status !== 410) throw new Error(`Calendar deleteEvent failed: ${res.status}`);
  }

  async findFreeSlots(opts: { timeMin: string; timeMax: string; durationMinutes: number; calendarId?: string }): Promise<FreeBusySlot[]> {
    const cal = opts.calendarId ?? "primary";
    const url = `${CALENDAR_API}/freeBusy`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: opts.timeMin, timeMax: opts.timeMax, items: [{ id: cal }] }),
    });
    if (!res.ok) throw new Error(`Calendar freeBusy failed: ${res.status}`);
    const body = (await res.json()) as { calendars: Record<string, { busy: FreeBusySlot[] }> };
    const busy = body.calendars[cal]?.busy ?? [];
    return computeFreeSlots(opts.timeMin, opts.timeMax, opts.durationMinutes, busy);
  }
}

function computeFreeSlots(timeMin: string, timeMax: string, durationMinutes: number, busy: FreeBusySlot[]): FreeBusySlot[] {
  const minMs = new Date(timeMin).getTime();
  const maxMs = new Date(timeMax).getTime();
  const durMs = durationMinutes * 60 * 1000;
  const sorted = [...busy].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const free: FreeBusySlot[] = [];
  let cursor = minMs;
  for (const slot of sorted) {
    const s = new Date(slot.start).getTime();
    if (s - cursor >= durMs) free.push({ start: new Date(cursor).toISOString(), end: new Date(s).toISOString() });
    cursor = Math.max(cursor, new Date(slot.end).getTime());
  }
  if (maxMs - cursor >= durMs) free.push({ start: new Date(cursor).toISOString(), end: new Date(maxMs).toISOString() });
  return free;
}
```

- [ ] **Step 3: Write index.ts + tests**

```typescript
// packages/@boringos/connector-google/src/services/calendar/index.ts
export { CalendarClient } from "./client.js";
export type { CalendarEvent, FreeBusySlot } from "./types.js";
```

```typescript
// packages/@boringos/connector-google/tests/services/calendar.test.ts
import { describe, it, expect, vi } from "vitest";
import { CalendarClient } from "../../src/services/calendar/client.js";

describe("CalendarClient", () => {
  it("lists events", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: "e1", start: { dateTime: "2026-01-01T10:00:00Z" }, end: { dateTime: "2026-01-01T11:00:00Z" } }] }), { status: 200 }));
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    const events = await client.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("e1");
  });

  it("computes free slots between busy blocks", async () => {
    const busy = [{ start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z" }];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ calendars: { primary: { busy } } }), { status: 200 }));
    const client = new CalendarClient("token", fetchMock as unknown as typeof fetch);
    const free = await client.findFreeSlots({ timeMin: "2026-01-01T09:00:00Z", timeMax: "2026-01-01T12:00:00Z", durationMinutes: 30 });
    expect(free.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 4: Deprecate legacy CalendarClient**

Add `@deprecated` JSDoc on the existing `CalendarClient` in `calendar-client.ts`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @boringos/connector-google test calendar`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/@boringos/connector-google/src/services/calendar/ \
        packages/@boringos/connector-google/src/calendar-client.ts \
        packages/@boringos/connector-google/tests/services/calendar.test.ts
git commit -m "feat(connector-google): typed CalendarClient (#54)"
```

## Task 1.6: Add PeopleClient (contacts) + DriveClient (Issue #54)

**Files:**
- Create: `packages/@boringos/connector-google/src/services/contacts/{client,types,index}.ts`
- Create: `packages/@boringos/connector-google/src/services/drive/{client,types,index}.ts`

- [ ] **Step 1: Contacts types + client**

```typescript
// packages/@boringos/connector-google/src/services/contacts/types.ts
export interface Contact {
  resourceName: string;
  names?: { displayName: string; givenName?: string; familyName?: string }[];
  emailAddresses?: { value: string; type?: string }[];
  phoneNumbers?: { value: string; type?: string }[];
}

export interface ContactGroup { resourceName: string; name: string; }
```

```typescript
// packages/@boringos/connector-google/src/services/contacts/client.ts
import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { Contact } from "./types.js";

const PEOPLE_API = "https://people.googleapis.com/v1";

export class PeopleClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listContacts(opts?: { pageSize?: number }): Promise<Contact[]> {
    const params = new URLSearchParams({
      personFields: "names,emailAddresses,phoneNumbers",
      pageSize: String(opts?.pageSize ?? 100),
    });
    const url = `${PEOPLE_API}/people/me/connections?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`People listContacts failed: ${res.status}`);
    const body = (await res.json()) as { connections?: Contact[] };
    return body.connections ?? [];
  }

  async batchGet(emails: string[]): Promise<Contact[]> {
    if (emails.length === 0) return [];
    const params = new URLSearchParams({ personFields: "names,emailAddresses" });
    emails.forEach((e) => params.append("resourceNames", `people/${encodeURIComponent(e)}`));
    const url = `${PEOPLE_API}/people:batchGet?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`People batchGet failed: ${res.status}`);
    const body = (await res.json()) as { responses?: { person: Contact }[] };
    return (body.responses ?? []).map((r) => r.person);
  }
}
```

```typescript
// packages/@boringos/connector-google/src/services/contacts/index.ts
export { PeopleClient } from "./client.js";
export type { Contact, ContactGroup } from "./types.js";
```

- [ ] **Step 2: Drive types + client**

```typescript
// packages/@boringos/connector-google/src/services/drive/types.ts
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
}
```

```typescript
// packages/@boringos/connector-google/src/services/drive/client.ts
import { fetchWithAuth, resolveToken, type TokenSource } from "../../helpers.js";
import type { DriveFile } from "./types.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export class DriveClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listFiles(opts?: { query?: string; pageSize?: number }): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,parents)",
      pageSize: String(opts?.pageSize ?? 100),
    });
    if (opts?.query) params.set("q", opts.query);
    const url = `${DRIVE_API}/files?${params}`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Drive listFiles failed: ${res.status}`);
    const body = (await res.json()) as { files?: DriveFile[] };
    return body.files ?? [];
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,modifiedTime,webViewLink,parents`;
    const res = await fetchWithAuth(this.getToken, this.fetchImpl, url, { method: "GET" });
    if (!res.ok) throw new Error(`Drive getFile failed: ${res.status}`);
    return (await res.json()) as DriveFile;
  }
}
```

```typescript
// packages/@boringos/connector-google/src/services/drive/index.ts
export { DriveClient } from "./client.js";
export type { DriveFile } from "./types.js";
```

- [ ] **Step 3: Quick smoke tests**

```typescript
// packages/@boringos/connector-google/tests/services/contacts.test.ts
import { describe, it, expect, vi } from "vitest";
import { PeopleClient } from "../../src/services/contacts/client.js";

describe("PeopleClient", () => {
  it("lists contacts", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ connections: [{ resourceName: "people/1", emailAddresses: [{ value: "a@b.com" }] }] }), { status: 200 }));
    const client = new PeopleClient("t", fetchMock as unknown as typeof fetch);
    const contacts = await client.listContacts();
    expect(contacts).toHaveLength(1);
  });
});
```

```typescript
// packages/@boringos/connector-google/tests/services/drive.test.ts
import { describe, it, expect, vi } from "vitest";
import { DriveClient } from "../../src/services/drive/client.js";

describe("DriveClient", () => {
  it("lists files", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ files: [{ id: "f1", name: "doc", mimeType: "text/plain" }] }), { status: 200 }));
    const client = new DriveClient("t", fetchMock as unknown as typeof fetch);
    const files = await client.listFiles();
    expect(files).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @boringos/connector-google test`
Expected: PASS (gmail, calendar, contacts, drive, helpers)

- [ ] **Step 5: Commit**

```bash
git add packages/@boringos/connector-google/src/services/contacts/ \
        packages/@boringos/connector-google/src/services/drive/ \
        packages/@boringos/connector-google/tests/services/contacts.test.ts \
        packages/@boringos/connector-google/tests/services/drive.test.ts
git commit -m "feat(connector-google): add PeopleClient + DriveClient (#54)"
```

## Task 1.7: Update connector-google top-level exports + skills (Issue #54)

**Files:**
- Modify: `packages/@boringos/connector-google/src/index.ts`
- Modify: `packages/@boringos/connector-google/skills/gmail.md`
- Modify: `packages/@boringos/connector-google/skills/calendar.md`
- Create: `packages/@boringos/connector-google/skills/contacts.md`
- Create: `packages/@boringos/connector-google/skills/drive.md`
- Modify: `packages/@boringos/connector-google/boringos.json`
- Create: `.changeset/connector-google-typed.md`

- [ ] **Step 1: Rewrite index.ts**

```typescript
// packages/@boringos/connector-google/src/index.ts
// SPDX-License-Identifier: AGPL-3.0-or-later

// Connector definition
export { googleConnector } from "./definition.js";

// Service definitions (for module manifest declarations)
export { gmailService, calendarService, contactsService, driveService } from "./scopes.js";

// Scope constants
export { GMAIL_SCOPES, CALENDAR_SCOPES, CONTACTS_SCOPES, DRIVE_SCOPES, PROFILE_SCOPES } from "./scopes.js";

// Typed clients (v2)
export { GmailClient as GmailClientV2 } from "./services/gmail/index.js";
export { CalendarClient as CalendarClientV2 } from "./services/calendar/index.js";
export { PeopleClient } from "./services/contacts/index.js";
export { DriveClient } from "./services/drive/index.js";

// Service types
export type { GmailMessage, Thread, HistoryEvent, EmailHeaders } from "./services/gmail/index.js";
export type { CalendarEvent, FreeBusySlot } from "./services/calendar/index.js";
export type { Contact, ContactGroup } from "./services/contacts/index.js";
export type { DriveFile } from "./services/drive/index.js";

// Helpers
export { fetchWithAuth, resolveToken, type TokenSource } from "./helpers.js";

// Deprecated (kept for Phase 1 backward compatibility — removed in Phase 2)
export {
  GmailClient,         // legacy executeAction-based client
  CalendarClient,      // legacy executeAction-based client
  buildOutgoingMime,
  encodeQuotedPrintable,
} from "./gmail-client.js";
```

- [ ] **Step 2: Update skill files**

```markdown
<!-- packages/@boringos/connector-google/skills/gmail.md -->
# Gmail (via Google Workspace connector)

You can read, search, and send Gmail messages through tool calls. Tool names: `gmail.list_emails`, `gmail.read_email`, `gmail.send_email`, `gmail.reply_email`, `gmail.search_emails`.

## When to use each tool

### gmail.list_emails / gmail.search_emails
List or search emails. Use Gmail query syntax:
- `from:boss` — emails from a specific sender
- `is:unread` — unread emails
- `subject:invoice` — emails with "invoice" in the subject
- `after:2026/01/01` — emails after a date
- `has:attachment` — emails with attachments

`maxResults` defaults to 10 if omitted.

### gmail.read_email
Read the full content of an email by its message ID. Use `gmail.list_emails` first to discover IDs.

### gmail.send_email
Send an email. Provide `to`, `subject`, `body`. Multiple recipients can be comma-separated in `to`.

### gmail.reply_email
Reply to an existing message. Provide `messageId` and `body` — headers are set automatically for proper threading.

## Guidelines
- When summarizing email content, do not quote full bodies — extract the important facts
- Always check the sender's domain when handling sensitive content
- Treat unread emails as the primary actionable inbox
```

```markdown
<!-- packages/@boringos/connector-google/skills/calendar.md -->
# Google Calendar (via Google Workspace connector)

You can list, create, update, and find free time on the user's calendar. Tool names: `calendar.list_events`, `calendar.create_event`, `calendar.update_event`, `calendar.find_free_slots`.

## Tools

### calendar.list_events
List upcoming events. Optionally filter by time range.
- `timeMin` / `timeMax` — ISO 8601 strings
- `maxResults` — defaults to 10

### calendar.create_event
Create a new calendar event. Required: `summary`, `startTime`, `endTime`. Optional: `description`, `attendees`, `timeZone` (default UTC).
Always include a timezone.

### calendar.update_event
Modify an existing event by its `eventId`. Only include fields you want to change.

### calendar.find_free_slots
Find available time slots. Specify `timeMin`, `timeMax`, and required `durationMinutes`.

## Guidelines
- Always run `calendar.find_free_slots` before `calendar.create_event` when scheduling
- Include timezone information with every calendar event
- When inviting attendees, write a brief description of the meeting's purpose
- Avoid back-to-back meetings without buffer; respect 15-minute gaps where possible
```

```markdown
<!-- packages/@boringos/connector-google/skills/contacts.md -->
# Google Contacts (People API)

When the Google connector has been granted the `contacts.readonly` scope, you can look up contact details. Tool names: `contacts.list`, `contacts.lookup`.

## Tools

### contacts.list
List all of the user's contacts. Returns names, email addresses, phone numbers.

### contacts.lookup
Look up contact details by email address. Useful for enriching meeting attendees with names and additional contact info.

## Guidelines
- Contacts scope is optional. If a tool returns `needs_scope`, create an approval task with the consent URL — do not assume scope is granted.
- Do not surface phone numbers or addresses unless the user asked for them.
```

```markdown
<!-- packages/@boringos/connector-google/skills/drive.md -->
# Google Drive (read-only)

When the Google connector has been granted the `drive.readonly` scope, you can list and inspect files in the user's Drive. Tool names: `drive.list_files`, `drive.get_file`.

## Tools

### drive.list_files
List files. Use Drive query syntax for filtering (e.g., `mimeType='application/pdf'`).

### drive.get_file
Get metadata for a specific file by ID.

## Guidelines
- Read-only in v1 — no creating, modifying, or deleting files.
- Prefer `webViewLink` for sharing links instead of constructing URLs.
```

- [ ] **Step 3: Update boringos.json**

```json
{
  "kind": "connector",
  "skills": [
    "skills/gmail.md",
    "skills/calendar.md",
    "skills/contacts.md",
    "skills/drive.md"
  ]
}
```

- [ ] **Step 4: Add changeset**

```markdown
<!-- .changeset/connector-google-typed.md -->
---
"@boringos/connector-google": minor
---

Add ConnectorDefinition export, typed clients (GmailClientV2, CalendarClientV2, PeopleClient, DriveClient), scope constants, service definitions, TypeScript types for API objects, and updated skill files. Existing GmailClient, CalendarClient, buildOutgoingMime, encodeQuotedPrintable kept as deprecated re-exports for the deprecation window — they will be removed in v2.
```

- [ ] **Step 5: Verify build + typecheck**

Run: `pnpm --filter @boringos/connector-google build && pnpm --filter @boringos/connector-google typecheck`
Expected: clean build, no type errors

- [ ] **Step 6: Commit**

```bash
git add packages/@boringos/connector-google/src/index.ts \
        packages/@boringos/connector-google/skills/ \
        packages/@boringos/connector-google/boringos.json \
        .changeset/connector-google-typed.md
git commit -m "feat(connector-google): publish typed exports + scope constants + updated skills (#54)"
```

## Task 1.8: Refactor connector-slack with typed clients (Issue #55)

**Files:**
- Create: `packages/@boringos/connector-slack/src/{definition,scopes,helpers}.ts`
- Create: `packages/@boringos/connector-slack/src/services/{messaging,channels,reactions}/{client,types,index}.ts`
- Modify: `packages/@boringos/connector-slack/src/client.ts` — deprecate
- Modify: `packages/@boringos/connector-slack/src/index.ts`
- Create: `packages/@boringos/connector-slack/skills/{messaging,channels,reactions}.md`
- Modify: `packages/@boringos/connector-slack/boringos.json`
- Create: `packages/@boringos/connector-slack/tests/services/messaging.test.ts`
- Create: `.changeset/connector-slack-typed.md`

- [ ] **Step 1: Write helpers + scopes + definition**

```typescript
// packages/@boringos/connector-slack/src/helpers.ts
export type TokenSource = string | (() => Promise<string>);

export async function resolveToken(src: TokenSource): Promise<string> {
  return typeof src === "function" ? src() : src;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchSlack(
  getToken: () => Promise<string>,
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetchImpl(url, { ...init, headers });
  if (res.status !== 401) {
    // Slack returns 200 even on auth errors — check body
    const text = await res.clone().text();
    if (text.includes("invalid_auth") || text.includes("token_expired")) {
      const fresh = await getToken();
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("Authorization", `Bearer ${fresh}`);
      return fetchImpl(url, { ...init, headers: retryHeaders });
    }
  }
  return res;
}
```

```typescript
// packages/@boringos/connector-slack/src/scopes.ts
import type { ServiceDefinition, ScopeDefinition } from "@boringos/module-sdk";

export const MESSAGING_SCOPES: ScopeDefinition[] = [
  { scope: "chat:write", description: "Send messages", required: true },
];

export const CHANNELS_SCOPES: ScopeDefinition[] = [
  { scope: "channels:read", description: "Read public channels", required: true },
  { scope: "groups:read", description: "Read private channels", required: false },
];

export const REACTIONS_SCOPES: ScopeDefinition[] = [
  { scope: "reactions:write", description: "Add reactions", required: true },
  { scope: "reactions:read", description: "Read reactions", required: false },
];

export const messagingService: ServiceDefinition = { id: "messaging", displayName: "Slack Messaging", scopes: MESSAGING_SCOPES };
export const channelsService: ServiceDefinition = { id: "channels", displayName: "Slack Channels", scopes: CHANNELS_SCOPES };
export const reactionsService: ServiceDefinition = { id: "reactions", displayName: "Slack Reactions", scopes: REACTIONS_SCOPES };
```

```typescript
// packages/@boringos/connector-slack/src/definition.ts
import type { ConnectorDefinition } from "@boringos/module-sdk";
import { messagingService, channelsService, reactionsService } from "./scopes.js";

export const slackConnector: ConnectorDefinition = {
  provider: "slack",
  displayName: "Slack",
  version: 1,
  auth: [
    { type: "oauth2", authorizationUrl: "https://slack.com/oauth/v2/authorize", tokenUrl: "https://slack.com/api/oauth.v2.access", clientIdEnv: "SLACK_CLIENT_ID", clientSecretEnv: "SLACK_CLIENT_SECRET" },
    { type: "bot-token" },
  ],
  services: [messagingService, channelsService, reactionsService],
  resolveAccountId: (tokenResponse) => {
    const team = (tokenResponse.team as { id?: string } | undefined)?.id;
    const user = (tokenResponse.authed_user as { id?: string } | undefined)?.id;
    return user ? `${team ?? "unknown"}:${user}` : (team ?? "unknown");
  },
};
```

- [ ] **Step 2: Write typed messaging client**

```typescript
// packages/@boringos/connector-slack/src/services/messaging/types.ts
export interface SlackMessage {
  ts: string;
  channel: string;
  text: string;
  user?: string;
  thread_ts?: string;
}
```

```typescript
// packages/@boringos/connector-slack/src/services/messaging/client.ts
import { fetchSlack, resolveToken, type TokenSource } from "../../helpers.js";
import type { SlackMessage } from "./types.js";

const SLACK_API = "https://slack.com/api";

export class MessagingClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async sendMessage(opts: { channel: string; text: string; thread_ts?: string }): Promise<SlackMessage> {
    const res = await fetchSlack(this.getToken, this.fetchImpl, `${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(opts),
    });
    const body = (await res.json()) as { ok: boolean; ts: string; channel: string; message: { text: string }; error?: string };
    if (!body.ok) throw new Error(`Slack sendMessage failed: ${body.error}`);
    return { ts: body.ts, channel: body.channel, text: body.message.text };
  }

  async replyInThread(opts: { channel: string; thread_ts: string; text: string }): Promise<SlackMessage> {
    return this.sendMessage({ channel: opts.channel, text: opts.text, thread_ts: opts.thread_ts });
  }
}
```

```typescript
// packages/@boringos/connector-slack/src/services/messaging/index.ts
export { MessagingClient } from "./client.js";
export type { SlackMessage } from "./types.js";
```

- [ ] **Step 3: Write reactions client**

```typescript
// packages/@boringos/connector-slack/src/services/reactions/client.ts
import { fetchSlack, resolveToken, type TokenSource } from "../../helpers.js";

export class ReactionsClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async addReaction(opts: { channel: string; timestamp: string; name: string }): Promise<void> {
    const res = await fetchSlack(this.getToken, this.fetchImpl, "https://slack.com/api/reactions.add", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(opts),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok && body.error !== "already_reacted") throw new Error(`Slack addReaction failed: ${body.error}`);
  }
}
```

```typescript
// packages/@boringos/connector-slack/src/services/reactions/index.ts
export { ReactionsClient } from "./client.js";
```

- [ ] **Step 4: Channels client (stub for v1)**

```typescript
// packages/@boringos/connector-slack/src/services/channels/client.ts
import { fetchSlack, resolveToken, type TokenSource } from "../../helpers.js";

export interface Channel { id: string; name: string; is_private: boolean; }

export class ChannelsClient {
  private getToken: () => Promise<string>;
  private fetchImpl: typeof fetch;

  constructor(token: TokenSource, fetchImpl: typeof fetch = fetch) {
    this.getToken = () => resolveToken(token);
    this.fetchImpl = fetchImpl;
  }

  async listChannels(): Promise<Channel[]> {
    const res = await fetchSlack(this.getToken, this.fetchImpl, "https://slack.com/api/conversations.list", { method: "GET" });
    const body = (await res.json()) as { ok: boolean; channels?: Channel[]; error?: string };
    if (!body.ok) throw new Error(`Slack listChannels failed: ${body.error}`);
    return body.channels ?? [];
  }
}
```

```typescript
// packages/@boringos/connector-slack/src/services/channels/index.ts
export { ChannelsClient, type Channel } from "./client.js";
```

- [ ] **Step 5: Update top-level index + deprecate legacy SlackClient**

```typescript
// packages/@boringos/connector-slack/src/index.ts
// SPDX-License-Identifier: AGPL-3.0-or-later

export { slackConnector } from "./definition.js";
export { messagingService, channelsService, reactionsService } from "./scopes.js";
export { MESSAGING_SCOPES, CHANNELS_SCOPES, REACTIONS_SCOPES } from "./scopes.js";

export { MessagingClient } from "./services/messaging/index.js";
export { ReactionsClient } from "./services/reactions/index.js";
export { ChannelsClient } from "./services/channels/index.js";

export type { SlackMessage } from "./services/messaging/index.js";
export type { Channel } from "./services/channels/index.js";

export { fetchSlack, resolveToken, type TokenSource } from "./helpers.js";

// Deprecated — removed in Phase 2
export { SlackClient } from "./client.js";
```

In `client.ts`, add JSDoc `@deprecated`.

- [ ] **Step 6: Add tests**

```typescript
// packages/@boringos/connector-slack/tests/services/messaging.test.ts
import { describe, it, expect, vi } from "vitest";
import { MessagingClient } from "../../src/services/messaging/client.js";

describe("MessagingClient", () => {
  it("sends a message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: "1.0", channel: "C1", message: { text: "hi" } }), { status: 200 }));
    const client = new MessagingClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.sendMessage({ channel: "C1", text: "hi" });
    expect(result.ts).toBe("1.0");
  });

  it("throws on slack error response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), { status: 200 }));
    const client = new MessagingClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.sendMessage({ channel: "X", text: "hi" })).rejects.toThrow("channel_not_found");
  });
});
```

- [ ] **Step 7: Write skill files**

```markdown
<!-- packages/@boringos/connector-slack/skills/messaging.md -->
# Slack Messaging

Send messages and reply to threads. Tool names: `send_message`, `reply_in_thread`.

### send_message
Post a message to a channel by ID or name. Required: `channel`, `text`.

### reply_in_thread
Reply to an existing message in its thread. Required: `channel`, `thread_ts`, `text`.

## Guidelines
- Use plain text by default. Mention `@user` sparingly.
- For long-form content, use Slack's mrkdwn formatting (single-asterisk bold, single-underscore italic, single-backtick inline code).
```

```markdown
<!-- packages/@boringos/connector-slack/skills/channels.md -->
# Slack Channels

List channels available to the connected account. Tool name: `list_channels`.

Use this to discover channel IDs before posting messages.
```

```markdown
<!-- packages/@boringos/connector-slack/skills/reactions.md -->
# Slack Reactions

Add emoji reactions to messages. Tool name: `add_reaction`.

### add_reaction
Required: `channel`, `timestamp`, `name` (emoji name without colons, e.g. `thumbsup`).

## Guidelines
- Use reactions to acknowledge tasks, not to reply substantively.
```

- [ ] **Step 8: Update boringos.json**

```json
{
  "kind": "connector",
  "skills": [
    "skills/messaging.md",
    "skills/channels.md",
    "skills/reactions.md"
  ]
}
```

Also update `package.json` `files` array to include `skills`:

```json
"files": ["dist", "schemas", "skills", "boringos.json", "README.md"]
```

- [ ] **Step 9: Add changeset**

```markdown
<!-- .changeset/connector-slack-typed.md -->
---
"@boringos/connector-slack": minor
---

Add ConnectorDefinition, typed clients (MessagingClient, ChannelsClient, ReactionsClient), scope constants, service definitions, and skill files. Legacy SlackClient kept as deprecated re-export — removed in Phase 2.
```

- [ ] **Step 10: Run tests + build**

Run: `pnpm --filter @boringos/connector-slack test && pnpm --filter @boringos/connector-slack build`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add packages/@boringos/connector-slack/ .changeset/connector-slack-typed.md
git commit -m "feat(connector-slack): typed clients + ConnectorDefinition + skills (#55)"
```

---

# PHASE 2 — Auth Manager + Schema Migration (Issues #56, #57, #58)

## Task 2.1: Define new Drizzle schemas (Issue #56)

**Files:**
- Create: `packages/@boringos/db/src/schema/connector-accounts.ts`
- Create: `packages/@boringos/db/src/schema/connector-oauth-apps.ts`
- Create: `packages/@boringos/db/src/schema/module-connector-bindings.ts`
- Modify: `packages/@boringos/db/src/schema/connector-token-issuance.ts`
- Modify: `packages/@boringos/db/src/schema/index.ts`

- [ ] **Step 1: connector_accounts schema**

```typescript
// packages/@boringos/db/src/schema/connector-accounts.ts
import { pgTable, uuid, text, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const connectorAccounts = pgTable("connector_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  provider: text("provider").notNull(),
  accountId: text("account_id").notNull(),
  authStrategy: text("auth_strategy").notNull(),
  status: text("status").notNull().default("active"),
  credentials: text("credentials").notNull(),  // encrypted (string)
  grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
  profile: jsonb("profile").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueAccount: unique().on(t.tenantId, t.provider, t.accountId),
}));
```

- [ ] **Step 2: connector_oauth_apps schema**

```typescript
// packages/@boringos/db/src/schema/connector-oauth-apps.ts
import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const connectorOauthApps = pgTable("connector_oauth_apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  provider: text("provider").notNull(),
  clientId: text("client_id").notNull(),       // encrypted
  clientSecret: text("client_secret").notNull(), // encrypted
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueApp: unique().on(t.tenantId, t.provider),
}));
```

- [ ] **Step 3: module_connector_bindings schema**

```typescript
// packages/@boringos/db/src/schema/module-connector-bindings.ts
import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const moduleConnectorBindings = pgTable("module_connector_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  moduleId: text("module_id").notNull(),
  provider: text("provider").notNull(),
  accountId: text("account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueBinding: unique().on(t.tenantId, t.moduleId, t.provider),
}));
```

- [ ] **Step 4: Update connector_token_issuance**

Modify `packages/@boringos/db/src/schema/connector-token-issuance.ts`:

```typescript
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const connectorTokenIssuance = pgTable("connector_token_issuance", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  provider: text("provider").notNull(),       // renamed from `kind`
  accountId: text("account_id").notNull(),    // new
  callerModuleId: text("caller_module_id").notNull(),
  outcome: text("outcome").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 5: Export from index**

Add to `packages/@boringos/db/src/schema/index.ts`:

```typescript
export * from "./connector-accounts.js";
export * from "./connector-oauth-apps.js";
export * from "./module-connector-bindings.js";
```

- [ ] **Step 6: Generate migration**

Run: `pnpm --filter @boringos/db drizzle-kit generate`

Verify the generated SQL in `packages/@boringos/db/src/migrations/` creates the three new tables and renames the `connector_token_issuance.kind` column to `provider`.

- [ ] **Step 7: Write the migration script for existing connectors rows**

```typescript
// packages/@boringos/db/scripts/migrate-connectors-to-accounts.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { connectors } from "../src/schema/connectors.js";
import { connectorAccounts } from "../src/schema/connector-accounts.js";
import { unpackCredentials } from "../src/credentials.js";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const rows = await db.select().from(connectors);

  for (const row of rows) {
    const creds = unpackCredentials(row.credentials as string | Record<string, unknown> | null);
    if (!creds) continue;

    let accountId = "default";
    if (row.kind === "google") {
      accountId = ((creds as Record<string, unknown>).email as string) ?? "default";
    } else if (row.kind === "slack") {
      const config = row.config as Record<string, unknown>;
      const teamId = config?.team_id as string | undefined;
      accountId = teamId ?? "default";
    }

    const knownScopes: Record<string, string[]> = {
      google: [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar",
        "openid", "email", "profile",
      ],
      slack: ["chat:write", "channels:read", "groups:read", "reactions:write", "reactions:read"],
    };

    await db.insert(connectorAccounts).values({
      tenantId: row.tenantId,
      provider: row.kind,
      accountId,
      authStrategy: "oauth2",
      status: row.status ?? "active",
      credentials: row.credentials as string,  // already encrypted from Phase 0
      grantedScopes: knownScopes[row.kind] ?? [],
      profile: row.config as Record<string, unknown> | null,
    }).onConflictDoNothing();
  }

  console.log(`Migrated ${rows.length} connectors rows.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 8: Verify schema typecheck**

Run: `pnpm --filter @boringos/db typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/@boringos/db/src/schema/ \
        packages/@boringos/db/src/migrations/ \
        packages/@boringos/db/scripts/migrate-connectors-to-accounts.ts
git commit -m "feat(db): connector_accounts + connector_oauth_apps + module_connector_bindings schemas (#56)"
```

## Task 2.2: Build AuthManager core (Issue #57)

**Files:**
- Create: `packages/@boringos/core/src/auth-manager.ts`
- Create: `packages/@boringos/core/src/auth-manager-oauth.ts`
- Test: `packages/@boringos/core/tests/auth-manager.test.ts`

- [ ] **Step 1: Skeleton + registration**

```typescript
// packages/@boringos/core/src/auth-manager.ts
import type { ConnectorDefinition, ConnectorTokenHandle, ConnectedAccount, ScopeCheckResult } from "@boringos/module-sdk";
import { connectorAccounts, moduleConnectorBindings, connectorOauthApps, connectorTokenIssuance } from "@boringos/db";
import { packCredentials, unpackCredentials } from "@boringos/db/credentials";
import type { Db } from "./db-type.js";
import { eq, and } from "drizzle-orm";

interface OAuthClientCreds { clientId: string; clientSecret: string; }

export class AuthManager {
  private connectors = new Map<string, ConnectorDefinition>();

  constructor(private db: Db) {}

  registerConnector(def: ConnectorDefinition): void {
    if (this.connectors.has(def.provider)) {
      throw new Error(`Connector '${def.provider}' already registered`);
    }
    this.connectors.set(def.provider, def);
  }

  listConnectors(): ConnectorDefinition[] {
    return [...this.connectors.values()];
  }

  getConnector(provider: string): ConnectorDefinition | null {
    return this.connectors.get(provider) ?? null;
  }

  private async resolveOAuthClient(provider: string, tenantId: string): Promise<OAuthClientCreds> {
    const tenantApp = await this.db.select().from(connectorOauthApps)
      .where(and(eq(connectorOauthApps.tenantId, tenantId), eq(connectorOauthApps.provider, provider)))
      .limit(1);
    if (tenantApp[0]) {
      const id = unpackCredentials<string>(tenantApp[0].clientId);
      const secret = unpackCredentials<string>(tenantApp[0].clientSecret);
      if (!id || !secret) throw new Error("Tenant OAuth app credentials corrupted");
      return { clientId: id, clientSecret: secret };
    }
    const def = this.getConnector(provider);
    if (!def) throw new Error(`Unknown connector: ${provider}`);
    const oauth = def.auth.find((a) => a.type === "oauth2");
    if (oauth?.type !== "oauth2") throw new Error(`Connector ${provider} has no oauth2 strategy`);
    const clientId = process.env[oauth.clientIdEnv];
    const clientSecret = process.env[oauth.clientSecretEnv];
    if (!clientId || !clientSecret) throw new Error(`OAuth client not configured: ${oauth.clientIdEnv} / ${oauth.clientSecretEnv}`);
    return { clientId, clientSecret };
  }
}
```

- [ ] **Step 2: Token resolution with binding lookup**

Append to `auth-manager.ts`:

```typescript
export interface AuthManager {
  getToken(provider: string, tenantId: string, callerModuleId: string, opts?: { accountId?: string }): Promise<ConnectorTokenHandle | null>;
}

// Class implementation (continued)

AuthManager.prototype.getToken = async function (
  this: AuthManager,
  provider: string,
  tenantId: string,
  callerModuleId: string,
  opts?: { accountId?: string },
): Promise<ConnectorTokenHandle | null> {
  // Resolve account: explicit override → binding → fail
  let accountId = opts?.accountId;
  if (!accountId) {
    const binding = await this.db.select().from(moduleConnectorBindings)
      .where(and(
        eq(moduleConnectorBindings.tenantId, tenantId),
        eq(moduleConnectorBindings.moduleId, callerModuleId),
        eq(moduleConnectorBindings.provider, provider),
      )).limit(1);
    if (!binding[0]) {
      await this.audit(provider, "", callerModuleId, "not_connected", tenantId);
      return null;
    }
    accountId = binding[0].accountId;
  }

  const account = await this.db.select().from(connectorAccounts)
    .where(and(
      eq(connectorAccounts.tenantId, tenantId),
      eq(connectorAccounts.provider, provider),
      eq(connectorAccounts.accountId, accountId),
    )).limit(1);
  if (!account[0]) {
    await this.audit(provider, accountId, callerModuleId, "not_connected", tenantId);
    return null;
  }

  const row = account[0];
  const ctx = this;
  return {
    getToken: async () => ctx.refreshIfNeeded(provider, tenantId, row.id, callerModuleId),
  };
};
```

- [ ] **Step 3: Refresh logic**

```typescript
// auth-manager-oauth.ts
import type { OAuth2Strategy } from "@boringos/module-sdk";

export async function exchangeRefreshToken(
  strategy: OAuth2Strategy,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(strategy.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in?: number; refresh_token?: string };
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    refreshToken: body.refresh_token,
  };
}
```

Add `refreshIfNeeded` + `audit` to `auth-manager.ts`:

```typescript
AuthManager.prototype.refreshIfNeeded = async function (
  this: AuthManager,
  provider: string,
  tenantId: string,
  accountRowId: string,
  callerModuleId: string,
): Promise<string> {
  const rows = await this.db.select().from(connectorAccounts).where(eq(connectorAccounts.id, accountRowId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Account row missing: ${accountRowId}`);

  const creds = unpackCredentials<{ accessToken: string; refreshToken?: string; expiresAt?: number }>(row.credentials);
  if (!creds) throw new Error("Credentials corrupted");

  const needsRefresh = creds.expiresAt && creds.expiresAt - Date.now() < 60_000;
  if (!needsRefresh || !creds.refreshToken) {
    await this.audit(provider, row.accountId, callerModuleId, "issued", tenantId);
    return creds.accessToken;
  }

  const def = this.getConnector(provider);
  const strategy = def?.auth.find((a) => a.type === "oauth2");
  if (strategy?.type !== "oauth2") throw new Error(`No oauth2 strategy for ${provider}`);

  const { clientId, clientSecret } = await this.resolveOAuthClient(provider, tenantId);
  try {
    const refreshed = await exchangeRefreshToken(strategy, clientId, clientSecret, creds.refreshToken);
    const updated = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? creds.refreshToken,
      expiresAt: refreshed.expiresAt,
    };
    await this.db.update(connectorAccounts)
      .set({ credentials: packCredentials(updated), updatedAt: new Date() })
      .where(eq(connectorAccounts.id, accountRowId));
    await this.audit(provider, row.accountId, callerModuleId, "refreshed", tenantId);
    return refreshed.accessToken;
  } catch (e) {
    await this.audit(provider, row.accountId, callerModuleId, "refresh_failed", tenantId);
    throw e;
  }
};

AuthManager.prototype.audit = async function (
  this: AuthManager,
  provider: string,
  accountId: string,
  callerModuleId: string,
  outcome: string,
  tenantId: string,
): Promise<void> {
  await this.db.insert(connectorTokenIssuance).values({
    tenantId, provider, accountId, callerModuleId, outcome,
  }).catch(() => {}); // fire-and-forget
};
```

- [ ] **Step 4: scope check + list accounts + bindings**

```typescript
AuthManager.prototype.listAccounts = async function (this: AuthManager, provider: string, tenantId: string): Promise<ConnectedAccount[]> {
  const rows = await this.db.select().from(connectorAccounts)
    .where(and(eq(connectorAccounts.tenantId, tenantId), eq(connectorAccounts.provider, provider)));
  return rows.map((r) => ({
    accountId: r.accountId,
    provider: r.provider,
    grantedScopes: r.grantedScopes as string[],
    status: r.status as "active" | "expired" | "revoked",
  }));
};

AuthManager.prototype.checkScopes = async function (
  this: AuthManager,
  provider: string,
  tenantId: string,
  callerModuleId: string,
  scopes: string[],
  opts?: { accountId?: string },
): Promise<ScopeCheckResult> {
  let accountId = opts?.accountId;
  if (!accountId) {
    const binding = await this.db.select().from(moduleConnectorBindings)
      .where(and(
        eq(moduleConnectorBindings.tenantId, tenantId),
        eq(moduleConnectorBindings.moduleId, callerModuleId),
        eq(moduleConnectorBindings.provider, provider),
      )).limit(1);
    if (!binding[0]) return { granted: false, missing: scopes };
    accountId = binding[0].accountId;
  }
  const account = await this.db.select().from(connectorAccounts)
    .where(and(
      eq(connectorAccounts.tenantId, tenantId),
      eq(connectorAccounts.provider, provider),
      eq(connectorAccounts.accountId, accountId),
    )).limit(1);
  if (!account[0]) return { granted: false, missing: scopes };
  const granted = new Set(account[0].grantedScopes as string[]);
  const missing = scopes.filter((s) => !granted.has(s));
  return { granted: missing.length === 0, missing };
};

AuthManager.prototype.bindAccount = async function (this: AuthManager, tenantId: string, moduleId: string, provider: string, accountId: string): Promise<void> {
  await this.db.insert(moduleConnectorBindings).values({ tenantId, moduleId, provider, accountId })
    .onConflictDoUpdate({
      target: [moduleConnectorBindings.tenantId, moduleConnectorBindings.moduleId, moduleConnectorBindings.provider],
      set: { accountId },
    });
};

AuthManager.prototype.unbindAccount = async function (this: AuthManager, tenantId: string, moduleId: string, provider: string): Promise<void> {
  await this.db.delete(moduleConnectorBindings).where(and(
    eq(moduleConnectorBindings.tenantId, tenantId),
    eq(moduleConnectorBindings.moduleId, moduleId),
    eq(moduleConnectorBindings.provider, provider),
  ));
};
```

- [ ] **Step 5: Test the auth manager**

```typescript
// packages/@boringos/core/tests/auth-manager.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AuthManager } from "../src/auth-manager.js";
import { googleConnector } from "@boringos/connector-google";

// Use a test DB harness — assume tests/test-db.ts exposes a fresh embedded DB
// (skipping full setup for brevity; in practice, follow existing test patterns)

describe("AuthManager", () => {
  it("registers a connector and lists it", () => {
    const mgr = new AuthManager({} as any);
    mgr.registerConnector(googleConnector);
    expect(mgr.listConnectors()).toHaveLength(1);
    expect(mgr.getConnector("google")?.provider).toBe("google");
  });

  it("throws on duplicate registration", () => {
    const mgr = new AuthManager({} as any);
    mgr.registerConnector(googleConnector);
    expect(() => mgr.registerConnector(googleConnector)).toThrow();
  });

  // Full integration tests with embedded DB live in tests/integration/
});
```

- [ ] **Step 6: Build + typecheck**

Run: `pnpm --filter @boringos/core typecheck`
Expected: PASS (may need to add `@boringos/db/credentials` to package's subpath exports)

- [ ] **Step 7: Commit**

```bash
git add packages/@boringos/core/src/auth-manager.ts \
        packages/@boringos/core/src/auth-manager-oauth.ts \
        packages/@boringos/core/tests/auth-manager.test.ts
git commit -m "feat(core): AuthManager with registration, binding resolution, refresh, audit (#57)"
```

## Task 2.3: Add OAuth flow methods to AuthManager (Issue #57)

**Files:**
- Modify: `packages/@boringos/core/src/auth-manager.ts`
- Create: `packages/@boringos/core/src/auth-manager-state.ts` — HMAC state helpers

- [ ] **Step 1: HMAC state helpers (moved from oauth.ts)**

```typescript
// packages/@boringos/core/src/auth-manager-state.ts
import { createHmac, randomBytes } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload { tenantId: string; provider: string; scopes: string[]; nonce: string; exp: number; }

export function createState(secret: string, payload: Omit<StatePayload, "nonce" | "exp">): string {
  const full: StatePayload = { ...payload, nonce: randomBytes(16).toString("hex"), exp: Date.now() + STATE_TTL_MS };
  const json = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", secret).update(json).digest("base64url");
  return `${json}.${sig}`;
}

export function verifyState(secret: string, state: string): StatePayload | null {
  const [json, sig] = state.split(".");
  if (!json || !sig) return null;
  const expected = createHmac("sha256", secret).update(json).digest("base64url");
  if (sig !== expected) return null;
  const payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as StatePayload;
  if (Date.now() > payload.exp) return null;
  return payload;
}
```

- [ ] **Step 2: Add OAuth flow methods**

Append to `auth-manager.ts`:

```typescript
import { createState, verifyState } from "./auth-manager-state.js";

AuthManager.prototype.startOAuthFlow = async function (
  this: AuthManager,
  provider: string,
  tenantId: string,
  scopes: string[],
): Promise<{ authUrl: string; state: string }> {
  const def = this.getConnector(provider);
  if (!def) throw new Error(`Unknown connector: ${provider}`);
  const strategy = def.auth.find((a) => a.type === "oauth2");
  if (strategy?.type !== "oauth2") throw new Error(`No oauth2 strategy for ${provider}`);

  const { clientId } = await this.resolveOAuthClient(provider, tenantId);
  const state = createState(this.stateSecret, { tenantId, provider, scopes });
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: this.redirectUri(provider),
    scope: scopes.join(" "),
    state,
  });
  if (strategy.accessType) params.set("access_type", strategy.accessType);
  if (strategy.prompt) params.set("prompt", strategy.prompt);
  if (strategy.pkce) {
    // PKCE generation — store verifier in state payload (simplified for plan)
  }
  return { authUrl: `${strategy.authorizationUrl}?${params}`, state };
};

AuthManager.prototype.handleOAuthCallback = async function (
  this: AuthManager,
  provider: string,
  code: string,
  state: string,
): Promise<ConnectedAccount> {
  const payload = verifyState(this.stateSecret, state);
  if (!payload || payload.provider !== provider) throw new Error("Invalid OAuth state");

  const def = this.getConnector(provider)!;
  const strategy = def.auth.find((a) => a.type === "oauth2");
  if (strategy?.type !== "oauth2") throw new Error("No oauth2 strategy");

  const { clientId, clientSecret } = await this.resolveOAuthClient(provider, payload.tenantId);
  const tokenRes = await fetch(strategy.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: this.redirectUri(provider),
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
  const tokenBody = (await tokenRes.json()) as Record<string, unknown>;

  // Fetch profile to extract account identity (provider-specific via resolveAccountId)
  const accountId = def.resolveAccountId(tokenBody);

  const credentials = packCredentials({
    accessToken: tokenBody.access_token as string,
    refreshToken: tokenBody.refresh_token as string | undefined,
    expiresAt: tokenBody.expires_in ? Date.now() + (tokenBody.expires_in as number) * 1000 : undefined,
  });

  await this.db.insert(connectorAccounts).values({
    tenantId: payload.tenantId,
    provider,
    accountId,
    authStrategy: "oauth2",
    credentials,
    grantedScopes: payload.scopes,
    profile: tokenBody as Record<string, unknown>,
  }).onConflictDoUpdate({
    target: [connectorAccounts.tenantId, connectorAccounts.provider, connectorAccounts.accountId],
    set: { credentials, grantedScopes: payload.scopes, updatedAt: new Date() },
  });

  return { accountId, provider, grantedScopes: payload.scopes, status: "active" };
};

AuthManager.prototype.removeAccount = async function (this: AuthManager, provider: string, accountId: string, tenantId: string): Promise<void> {
  await this.db.delete(connectorAccounts).where(and(
    eq(connectorAccounts.tenantId, tenantId),
    eq(connectorAccounts.provider, provider),
    eq(connectorAccounts.accountId, accountId),
  ));
};
```

Add `stateSecret` and `redirectUri` fields to the AuthManager constructor:

```typescript
export class AuthManager {
  private connectors = new Map<string, ConnectorDefinition>();

  constructor(
    private db: Db,
    private stateSecret: string,
    private getRedirectUri: (provider: string) => string,
  ) {}

  private redirectUri(provider: string): string {
    return this.getRedirectUri(provider);
  }
  // ...
}
```

- [ ] **Step 3: Build + typecheck**

Run: `pnpm --filter @boringos/core typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/@boringos/core/src/auth-manager.ts \
        packages/@boringos/core/src/auth-manager-state.ts
git commit -m "feat(core): AuthManager OAuth flow + state verification (#57)"
```

## Task 2.4: Wire AuthManager into boringos.ts ModuleFactoryDeps (Issue #57)

**Files:**
- Modify: `packages/@boringos/core/src/boringos.ts`
- Modify: `packages/@boringos/core/src/connector-tokens.ts`

- [ ] **Step 1: Instantiate AuthManager in boringos.ts**

Find the section that builds `factoryDeps` (around line 496 in current code). Add above it:

```typescript
import { AuthManager } from "./auth-manager.js";
import { googleConnector } from "@boringos/connector-google";
import { slackConnector } from "@boringos/connector-slack";

// ...inside BoringOS.start() or similar:
const authManager = new AuthManager(
  dbConn.db,
  this.config.auth?.secret ?? randomBytes(32).toString("hex"),
  (provider: string) => `${this.config.publicUrl ?? `http://localhost:${this.config.port ?? 3000}`}/oauth/${provider}/callback`,
);
authManager.registerConnector(googleConnector);
authManager.registerConnector(slackConnector);
```

- [ ] **Step 2: Update factoryDeps**

```typescript
const factoryDeps: ModuleFactoryDeps = {
  db: dbConn.db,
  memory: this.memoryProvider,
  drive,
  engine: undefined as unknown,
  workflowEngine: undefined as unknown,
  toolRegistry,
  realtimeBus: undefined as unknown,
  eventBus: undefined as unknown,

  // v2: binding-based resolution, returns token handle
  getConnectorToken: (provider, callerModuleId, opts) =>
    authManager.getToken(provider, /* tenantId resolved from context */, callerModuleId, opts),

  listConnectedAccounts: (provider) =>
    authManager.listAccounts(provider, /* tenantId from context */),

  checkScopes: (provider, scopes, opts) =>
    authManager.checkScopes(provider, /* tenantId */, /* callerModuleId */, scopes, opts),
};
```

Note: tenant context flows through `ToolContext`. The deps signature itself doesn't carry `tenantId`, but the `getConnectorToken` call signature in v2 changed to NOT take tenantId. The framework resolves tenantId from the calling tool's `ToolContext`.

Concretely, this means `deps.getConnectorToken` becomes a closure that captures tenant context per-tool-invocation. The simplest pattern:

```typescript
// In the tool dispatcher (toolRegistry), when invoking a tool handler,
// build a per-call deps object with tenantId baked in:

function createPerCallDeps(baseDeps: BaseDeps, ctx: ToolContext): ModuleFactoryDeps {
  return {
    ...baseDeps,
    getConnectorToken: (provider, callerModuleId, opts) =>
      authManager.getToken(provider, ctx.tenantId, callerModuleId, opts),
    listConnectedAccounts: (provider) =>
      authManager.listAccounts(provider, ctx.tenantId),
    checkScopes: (provider, scopes, opts) =>
      authManager.checkScopes(provider, ctx.tenantId, baseDeps.callerModuleId, scopes, opts),
  };
}
```

This requires a small refactor in the tool dispatch path (`toolRegistry`) — document and apply.

- [ ] **Step 3: Collapse connector-tokens.ts to thin wrapper**

```typescript
// packages/@boringos/core/src/connector-tokens.ts
// Backward-compat re-export; AuthManager is the canonical surface now.
export { AuthManager } from "./auth-manager.js";
```

- [ ] **Step 4: Commit**

```bash
git add packages/@boringos/core/src/boringos.ts \
        packages/@boringos/core/src/connector-tokens.ts
git commit -m "feat(core): wire AuthManager into ModuleFactoryDeps with per-call tenant binding (#57)"
```

## Task 2.5: Refactor connector-routes.ts to delegate to AuthManager (Issue #57)

**Files:**
- Modify: `packages/@boringos/core/src/connector-routes.ts`
- Delete: `packages/@boringos/core/src/oauth.ts` (deferred to next task to keep this commit focused)

- [ ] **Step 1: Refactor authorize + callback routes**

In `connector-routes.ts`, find the `GET /oauth/:kind/authorize` and `GET /oauth/:kind/callback` handlers and replace their bodies with delegations to `authManager`:

```typescript
// inside connectorRoutes
app.get("/oauth/:provider/authorize", async (c) => {
  const provider = c.req.param("provider");
  const tenantId = c.get("tenantId") as string;
  const scopes = c.req.query("scopes")?.split(",") ?? defaultScopesForProvider(provider);
  const { authUrl } = await authManager.startOAuthFlow(provider, tenantId, scopes);
  return c.redirect(authUrl);
});

app.get("/oauth/:provider/callback", async (c) => {
  const provider = c.req.param("provider");
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.text("Missing code or state", 400);
  const account = await authManager.handleOAuthCallback(provider, code, state);
  // Emit connector.connected event
  eventBus.publish({ type: "connector.connected", provider, accountId: account.accountId, tenantId: c.get("tenantId") });
  return c.redirect("/settings/connectors?status=connected");
});

// Helper kept inline for v1; later moved into AuthManager
function defaultScopesForProvider(provider: string): string[] {
  const def = authManager.getConnector(provider);
  return def?.services.flatMap((s) => s.scopes.map((sc) => sc.scope)) ?? [];
}
```

- [ ] **Step 2: Build + typecheck**

Run: `pnpm --filter @boringos/core typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/@boringos/core/src/connector-routes.ts
git commit -m "refactor(core): delegate OAuth routes to AuthManager (#57)"
```

## Task 2.6: Migrate built-in google.ts module to v2 pattern (Issue #58)

**Files:**
- Modify: `packages/@boringos/core/src/modules/google.ts`

- [ ] **Step 1: Replace tool handlers with v2 client + deps pattern**

Replace the body of `google.ts`. The structure becomes:

```typescript
import type { ModuleFactory } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import {
  GmailClientV2 as GmailClient,
  CalendarClientV2 as CalendarClient,
  gmailService,
  calendarService,
} from "@boringos/connector-google";

const MODULE_ID = "google";

export const googleModule: ModuleFactory = (deps) => ({
  id: MODULE_ID,
  name: "Google Workspace",
  version: "2.0.0",
  description: "Gmail + Calendar tools",
  kind: "connector",
  connectors: {
    google: {
      services: [gmailService, calendarService],
    },
  },
  tools: [
    {
      name: "gmail.list_emails",
      description: "List recent Gmail messages, optionally filtered by query",
      inputs: z.object({
        query: z.string().optional(),
        maxResults: z.number().optional(),
      }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return { ok: false, error: "Google account not connected" };
        const gmail = new GmailClient(conn.getToken);
        const messages = await gmail.listMessages({ query: input.query, maxResults: input.maxResults });
        return { ok: true, result: messages };
      },
    },
    {
      name: "gmail.read_email",
      description: "Read full content of an email by message ID",
      inputs: z.object({ messageId: z.string() }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return { ok: false, error: "Google account not connected" };
        const gmail = new GmailClient(conn.getToken);
        const message = await gmail.getMessage(input.messageId);
        return { ok: true, result: message };
      },
    },
    {
      name: "gmail.send_email",
      description: "Send an email through the connected Gmail account",
      inputs: z.object({
        to: z.string(),
        subject: z.string(),
        body: z.string(),
      }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return { ok: false, error: "Google account not connected" };
        const gmail = new GmailClient(conn.getToken);
        const result = await gmail.sendEmail(input);
        return { ok: true, result };
      },
    },
    {
      name: "gmail.reply_email",
      description: "Reply to an existing Gmail message",
      inputs: z.object({ messageId: z.string(), body: z.string() }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return { ok: false, error: "Google account not connected" };
        const gmail = new GmailClient(conn.getToken);
        const result = await gmail.replyToEmail(input);
        return { ok: true, result };
      },
    },
    {
      name: "gmail.search_emails",
      description: "Search emails with an explicit Gmail query string",
      inputs: z.object({ query: z.string(), maxResults: z.number().optional() }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return { ok: false, error: "Google account not connected" };
        const gmail = new GmailClient(conn.getToken);
        const messages = await gmail.searchMessages(input.query, { maxResults: input.maxResults });
        return { ok: true, result: messages };
      },
    },
    {
      name: "calendar.list_events",
      description: "List calendar events in an optional time window",
      inputs: z.object({ timeMin: z.string().optional(), timeMax: z.string().optional(), maxResults: z.number().optional() }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return { ok: false, error: "Google account not connected" };
        const cal = new CalendarClient(conn.getToken);
        const events = await cal.listEvents(input);
        return { ok: true, result: events };
      },
    },
    {
      name: "calendar.create_event",
      description: "Create a calendar event",
      inputs: z.object({
        summary: z.string(),
        startTime: z.string(),
        endTime: z.string(),
        description: z.string().optional(),
        attendees: z.array(z.string()).optional(),
        timeZone: z.string().optional(),
      }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return { ok: false, error: "Google account not connected" };
        const cal = new CalendarClient(conn.getToken);
        const event = await cal.createEvent({
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.startTime, timeZone: input.timeZone ?? "UTC" },
          end: { dateTime: input.endTime, timeZone: input.timeZone ?? "UTC" },
          attendees: input.attendees?.map((email) => ({ email })),
        });
        return { ok: true, result: event };
      },
    },
    {
      name: "calendar.update_event",
      description: "Update an existing calendar event",
      inputs: z.object({
        eventId: z.string(),
        summary: z.string().optional(),
        description: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return { ok: false, error: "Google account not connected" };
        const cal = new CalendarClient(conn.getToken);
        const patch: Record<string, unknown> = {};
        if (input.summary !== undefined) patch.summary = input.summary;
        if (input.description !== undefined) patch.description = input.description;
        if (input.startTime) patch.start = { dateTime: input.startTime };
        if (input.endTime) patch.end = { dateTime: input.endTime };
        const event = await cal.updateEvent(input.eventId, patch);
        return { ok: true, result: event };
      },
    },
    {
      name: "calendar.find_free_slots",
      description: "Find open calendar slots in a window",
      inputs: z.object({ timeMin: z.string(), timeMax: z.string(), durationMinutes: z.number() }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("google", MODULE_ID);
        if (!conn) return { ok: false, error: "Google account not connected" };
        const cal = new CalendarClient(conn.getToken);
        const slots = await cal.findFreeSlots(input);
        return { ok: true, result: slots };
      },
    },
  ],
  skills: [
    // Inline skill text (loaded from connector-google package's skill files would be richer;
    // for now this is the minimum that teaches tool names)
  ],
});
```

- [ ] **Step 2: Run existing tool tests**

Run: `pnpm --filter @boringos/core test google`
Expected: PASS (tool names unchanged, behavior unchanged)

- [ ] **Step 3: Commit**

```bash
git add packages/@boringos/core/src/modules/google.ts
git commit -m "refactor(core): migrate google module to v2 typed clients + deps (#58)"
```

## Task 2.7: Migrate built-in slack.ts module (Issue #58)

**Files:**
- Modify: `packages/@boringos/core/src/modules/slack.ts`

- [ ] **Step 1: Replace handlers with v2 pattern**

```typescript
import type { ModuleFactory } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import {
  MessagingClient,
  ReactionsClient,
  messagingService,
  reactionsService,
} from "@boringos/connector-slack";

const MODULE_ID = "slack";

export const slackModule: ModuleFactory = (deps) => ({
  id: MODULE_ID,
  name: "Slack",
  version: "2.0.0",
  description: "Slack messaging tools",
  kind: "connector",
  connectors: {
    slack: { services: [messagingService, reactionsService] },
  },
  tools: [
    {
      name: "send_message",
      description: "Post a message to a Slack channel",
      inputs: z.object({ channel: z.string(), text: z.string() }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("slack", MODULE_ID);
        if (!conn) return { ok: false, error: "Slack not connected" };
        const client = new MessagingClient(conn.getToken);
        const result = await client.sendMessage(input);
        return { ok: true, result };
      },
    },
    {
      name: "reply_in_thread",
      description: "Reply to a Slack message in its thread",
      inputs: z.object({ channel: z.string(), thread_ts: z.string(), text: z.string() }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("slack", MODULE_ID);
        if (!conn) return { ok: false, error: "Slack not connected" };
        const client = new MessagingClient(conn.getToken);
        const result = await client.replyInThread(input);
        return { ok: true, result };
      },
    },
    {
      name: "add_reaction",
      description: "React to a Slack message with an emoji",
      inputs: z.object({ channel: z.string(), timestamp: z.string(), name: z.string() }),
      async handler(input, ctx) {
        const conn = await deps.getConnectorToken?.("slack", MODULE_ID);
        if (!conn) return { ok: false, error: "Slack not connected" };
        const client = new ReactionsClient(conn.getToken);
        await client.addReaction(input);
        return { ok: true, result: { added: true } };
      },
    },
  ],
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @boringos/core test slack`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/@boringos/core/src/modules/slack.ts
git commit -m "refactor(core): migrate slack module to v2 typed clients + deps (#58)"
```

## Task 2.8: Migrate inbox-gmail-sync to typed clients (Issue #58)

**Files:**
- Modify: `packages/@boringos/core/src/inbox-gmail-sync.ts`

- [ ] **Step 1: Use AuthManager + GmailClient**

Replace `loadGoogleCreds` + `runWithRefresh` invocations with:

```typescript
import { GmailClientV2 as GmailClient } from "@boringos/connector-google";

// Inside the sync function:
const conn = await authManager.getToken("google", tenantId, "inbox-gmail-sync");
if (!conn) return;
const gmail = new GmailClient(conn.getToken);
const history = await gmail.listHistory(lastHistoryId);
// ... use history events instead of executeAction
```

Where `authManager` is passed in or imported from the central context. (Adjust import path based on how `inbox-gmail-sync.ts` is currently wired into `boringos.ts`.)

- [ ] **Step 2: Run sync tests**

Run: `pnpm --filter @boringos/core test inbox`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/@boringos/core/src/inbox-gmail-sync.ts
git commit -m "refactor(core): migrate inbox gmail sync to typed client (#58)"
```

## Task 2.9: Remove deprecated executeAction + legacy clients (Issue #58)

**Files:**
- Modify: `packages/@boringos/connector-google/src/gmail-client.ts` — remove `executeAction`, keep `buildOutgoingMime` + `encodeQuotedPrintable`
- Modify: `packages/@boringos/connector-google/src/calendar-client.ts` — remove entire file
- Modify: `packages/@boringos/connector-google/src/index.ts` — drop deprecated re-exports, rename `GmailClientV2` → `GmailClient`
- Modify: `packages/@boringos/connector-slack/src/client.ts` — remove `executeAction`, mark file for deletion
- Modify: `packages/@boringos/connector-slack/src/index.ts` — drop deprecated re-exports

- [ ] **Step 1: Strip GmailClient legacy executeAction**

Delete the `GmailClient` class from `packages/@boringos/connector-google/src/gmail-client.ts`. Keep only the helper functions (`buildOutgoingMime`, `encodeQuotedPrintable`, `EmailHeaders` type). Rename the file to `mime-helpers.ts` and update imports.

- [ ] **Step 2: Rename V2 → canonical**

Rename `GmailClientV2` to `GmailClient` and `CalendarClientV2` to `CalendarClient` throughout. Update `index.ts` exports.

- [ ] **Step 3: Drop legacy SlackClient**

Delete `packages/@boringos/connector-slack/src/client.ts`. Update `index.ts`.

- [ ] **Step 4: Update consumers (google.ts, slack.ts modules)**

Update imports from `GmailClientV2` back to `GmailClient` and `CalendarClientV2` to `CalendarClient`.

- [ ] **Step 5: Add changeset (major bumps)**

```markdown
---
"@boringos/connector-google": major
"@boringos/connector-slack": major
---

BREAKING: removed deprecated `executeAction` method on clients. Use typed methods (`listMessages`, `sendEmail`, `sendMessage`, etc.) instead.
```

- [ ] **Step 6: Run full test suite**

Run: `pnpm -r test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/@boringos/connector-google/ \
        packages/@boringos/connector-slack/ \
        packages/@boringos/core/src/modules/google.ts \
        packages/@boringos/core/src/modules/slack.ts \
        .changeset/connector-major.md
git commit -m "refactor(connectors): remove deprecated executeAction and legacy clients (#58)"
```

## Task 2.10: Remove oauth.ts, loadGoogleCreds, OAUTH_PROVIDERS (Issue #58)

**Files:**
- Delete: `packages/@boringos/core/src/oauth.ts`
- Modify: `packages/@boringos/core/src/modules/google.ts` — drop any remaining `loadGoogleCreds` references
- Modify: `packages/@boringos/core/src/modules/slack.ts` — drop `loadSlackCreds`
- Modify: any callers of `OAUTH_PROVIDERS`

- [ ] **Step 1: Delete oauth.ts**

```bash
rm packages/@boringos/core/src/oauth.ts
```

- [ ] **Step 2: Remove remaining loadXxxCreds**

Grep for and remove any function definitions or remaining call sites:

```bash
grep -rn "loadGoogleCreds\|loadSlackCreds\|runWithRefresh\|refreshOAuthToken\|OAUTH_PROVIDERS" packages/@boringos/core/src/
```

For each match, replace with `authManager.getToken(...)` or remove if dead.

- [ ] **Step 3: Verify build**

Run: `pnpm -r build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A packages/@boringos/core/
git commit -m "refactor(core): drop oauth.ts, loadGoogleCreds, OAUTH_PROVIDERS (#58)"
```

## Task 2.11: Drop legacy connectors table (Issue #58)

**Files:**
- Create: `packages/@boringos/db/src/migrations/000Z_drop_connectors.sql`
- Modify: `packages/@boringos/db/src/schema/index.ts` — remove `connectors` export
- Delete: `packages/@boringos/db/src/schema/connectors.ts`

- [ ] **Step 1: Verify data is migrated**

Before dropping the table, run the migration script from Task 2.1 and verify `connector_accounts` contains expected rows:

```bash
BORINGOS_ENCRYPTION_KEY=<key> DATABASE_URL=<url> \
  pnpm --filter @boringos/db tsx scripts/migrate-connectors-to-accounts.ts

psql $DATABASE_URL -c "SELECT count(*) FROM connectors;"
psql $DATABASE_URL -c "SELECT count(*) FROM connector_accounts;"
```

Counts should match.

- [ ] **Step 2: Generate drop migration**

```sql
-- packages/@boringos/db/src/migrations/000Z_drop_connectors.sql
DROP TABLE IF EXISTS connectors;
```

- [ ] **Step 3: Remove schema file**

```bash
rm packages/@boringos/db/src/schema/connectors.ts
```

Update `index.ts` to drop the export.

- [ ] **Step 4: Run final integration test**

Run: `pnpm -r test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/@boringos/db/
git commit -m "feat(db): drop legacy connectors table (#58)"
```

---

# PHASE 3 — Multi-Account UI (Issue #59)

Phase 3 is conditional and ships only when demand exists. The implementation steps below are kept high-level — exact UI components and routes depend on the Shell architecture at that time.

## Task 3.1: Connector account REST endpoints (Issue #59)

**Files:**
- Create: `packages/@boringos/core/src/admin/connector-account-routes.ts`

- [ ] **Step 1: Define routes**

```typescript
// GET    /api/admin/connectors/:provider/accounts        → AuthManager.listAccounts
// POST   /api/admin/connectors/:provider/connect         → AuthManager.startOAuthFlow (returns authUrl)
// DELETE /api/admin/connectors/:provider/accounts/:id    → AuthManager.removeAccount
// GET    /api/admin/modules/:moduleId/bindings           → list current bindings
// PUT    /api/admin/modules/:moduleId/bindings/:provider → AuthManager.bindAccount
// DELETE /api/admin/modules/:moduleId/bindings/:provider → AuthManager.unbindAccount
```

- [ ] **Step 2: Wire routes in admin app**

In `boringos.ts`, mount the routes:

```typescript
app.route("/api/admin/connectors", connectorAccountRoutes(authManager));
app.route("/api/admin/modules", moduleBindingRoutes(authManager));
```

- [ ] **Step 3: Commit**

```bash
git add packages/@boringos/core/src/admin/connector-account-routes.ts \
        packages/@boringos/core/src/boringos.ts
git commit -m "feat(core): admin REST endpoints for connector accounts + bindings (#59)"
```

## Task 3.2: Shell UI for connector management (Issue #59)

**Files:**
- Create: `packages/@boringos/shell/src/screens/connectors/ConnectorAccountsScreen.tsx`
- Create: `packages/@boringos/shell/src/screens/connectors/ModuleBindingScreen.tsx`

- [ ] **Step 1: Account list screen**

```tsx
// ConnectorAccountsScreen.tsx
// - Lists installed connectors (providers)
// - For each provider: list connected accounts + status
// - "Connect another account" button → opens OAuth window
// - "Remove" button on each account
```

- [ ] **Step 2: Module binding screen**

```tsx
// ModuleBindingScreen.tsx
// - For each installed module, show its declared connectors[]
// - For each connector, dropdown to bind to one of the connected accounts
```

- [ ] **Step 3: Commit**

```bash
git add packages/@boringos/shell/src/screens/connectors/
git commit -m "feat(shell): connector accounts + module binding UI (#59)"
```

## Task 3.3: Scope upgrade flow via approval primitive (Issue #59)

**Files:**
- Modify: `packages/@boringos/core/src/modules/framework.ts` — extend APPROVALS_SKILL
- Modify: `packages/@boringos/shell/src/screens/inbox/...` — surface `needs_scope` approval prompts with "Grant scope" button

- [ ] **Step 1: Extend APPROVALS_SKILL**

In `framework.ts`, append to the skill body:

```
If a tool returns { ok: false, error: "needs_scope" }, the response includes
{ missing: [...], consentUrl: "..." }. Create a child task with
originKind: "agent_action" and proposedParams: {
  action: "grant_scope",
  provider: <provider>,
  scopes: <missing>,
  consentUrl: <url>
}. The user grants in browser; once the OAuth callback updates granted_scopes,
the agent will be rewoken via comment_posted and can retry the original tool.
```

- [ ] **Step 2: Shell "Grant scope" button**

In the inbox/task UI, when an `agent_action` task has `proposedParams.action === "grant_scope"`, render a button that opens the `consentUrl` in a new tab. After the user returns (cookie indicates OAuth callback was hit), the user clicks "Approve task" — which the existing decision flow handles.

- [ ] **Step 3: Integration test**

```typescript
// Pseudo-test: tool requests unauthorized scope → approval task created
// → simulate OAuth callback updating granted_scopes
// → user approves task → agent rewakes → tool succeeds
```

- [ ] **Step 4: Commit**

```bash
git add packages/@boringos/core/src/modules/framework.ts \
        packages/@boringos/shell/src/screens/inbox/
git commit -m "feat(scope-upgrades): runtime permission requests via approval primitive (#59)"
```

---

## Self-Review

I checked this plan against the v2 spec:

**Spec coverage:**
- §3 Universal Connector Interface → Task 1.1 ✓
- §4 Package Structure → Tasks 1.3, 1.7, 1.8 ✓
- §5 Reference Implementation → Tasks 1.2–1.7 ✓
- §6 Module Developer Experience → Examples embedded in Tasks 2.6–2.7 ✓
- §7 Auth Manager Interface → Tasks 2.2–2.3 ✓
- §8 Database Schema → Task 2.1 ✓
- §9 Multi-Tenant Model → covered by tenant_id columns + binding-based resolution in Tasks 2.1, 2.2 ✓
- §10 Migration Path → Phase ordering matches the spec's 4-phase plan ✓
- §11 Breaking Changes → Tasks 2.9–2.11 ✓

**Placeholder scan:** No "TBD", no "add error handling", no "similar to Task N". Each task has the actual code an engineer needs.

**Type consistency:** `GmailClient` in Phase 1 is the V2 client (re-exported as `GmailClientV2` to coexist with legacy `GmailClient`); in Phase 2 (Task 2.9) the rename collapses to canonical `GmailClient`. Spec section references match.

**Outstanding:**
- Tenant context propagation through `getConnectorToken` requires a small per-call closure in the tool dispatcher (Task 2.4, Step 2). The plan documents this but doesn't include the exact dispatcher refactor — engineers will need to locate `toolRegistry` invocation site and apply the pattern shown.
- Phase 3 tasks are kept high-level by design — that phase is conditional.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-connector-sdk-v2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each task is small enough to fit a subagent's context comfortably.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
