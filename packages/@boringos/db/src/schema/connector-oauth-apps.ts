// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `connector_oauth_apps` -- per-tenant OAuth application credentials.
//
// Tenants can supply their own OAuth client_id / client_secret ("bring your own app")
// so that auth flows use their own registered app rather than the platform default.
//
// Both `clientId` and `clientSecret` are stored as AES-256-GCM encrypted TEXT
// (same pattern as `connector_accounts.credentials`).
//
// Unique constraint on (tenantId, provider): one app override per provider per tenant.

import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const connectorOauthApps = pgTable(
  "connector_oauth_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    /** Provider this app override applies to: "google", "slack", etc. */
    provider: text("provider").notNull(),
    /** AES-256-GCM encrypted OAuth client_id. */
    clientId: text("client_id").notNull(),
    /** AES-256-GCM encrypted OAuth client_secret. */
    clientSecret: text("client_secret").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueApp: unique().on(t.tenantId, t.provider),
  }),
);
