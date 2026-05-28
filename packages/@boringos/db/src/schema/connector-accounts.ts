// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `connector_accounts` -- one row per authenticated account per provider per tenant.
//
// Replaces the legacy `connectors` table (one row per provider per tenant) with a
// proper multi-account model. Key differences from the old table:
//
//   - `credentials` is TEXT, not JSONB. The encryption helper (`packCredentials`)
//     produces a ciphertext string; storing it as TEXT avoids the `as never` casts
//     that littered the old code.
//   - `accountId` identifies the specific account (e.g. user email for Google,
//     team_id for Slack) so one tenant can hold credentials for multiple accounts.
//   - Unique constraint on (tenantId, provider, accountId) keeps inserts idempotent
//     and prevents accidental duplicates.

import { pgTable, uuid, text, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const connectorAccounts = pgTable(
  "connector_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    /** Provider identifier: "google", "slack", etc. */
    provider: text("provider").notNull(),
    /** Provider-specific account identifier (email, team_id, user_id, "default", ...). */
    accountId: text("account_id").notNull(),
    /** Auth strategy used: "oauth2", "service_account", "api_key", etc. */
    authStrategy: text("auth_strategy").notNull(),
    /** Account lifecycle status: "active" | "revoked" | "needs_reauth" */
    status: text("status").notNull().default("active"),
    /**
     * AES-256-GCM encrypted credentials produced by `packCredentials()`.
     * TEXT (not JSONB) because the ciphertext is a base64 string.
     * Call `unpackCredentials()` to read; `packCredentials()` to write.
     */
    credentials: text("credentials").notNull(),
    /** OAuth scopes granted at authorization time. */
    grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
    /** Provider-supplied profile data (display name, avatar, etc.). Nullable. */
    profile: jsonb("profile").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueAccount: unique().on(t.tenantId, t.provider, t.accountId),
  }),
);
