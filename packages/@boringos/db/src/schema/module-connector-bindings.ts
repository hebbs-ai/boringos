// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `module_connector_bindings` -- which connector account a module uses.
//
// When a tenant has multiple Google accounts (e.g. personal + work) this table
// records which one a given module (e.g. "google", "executive-assistant") should
// use. Without a binding the AuthManager falls back to the most-recent active
// account for that provider.
//
// Unique constraint on (tenantId, moduleId, provider): one binding per module per
// provider per tenant. A module that speaks to two providers (Google + Slack) has
// two rows.

import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const moduleConnectorBindings = pgTable(
  "module_connector_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    /** Module that owns this binding (e.g. "google", "executive-assistant"). */
    moduleId: text("module_id").notNull(),
    /** Provider this binding is for: "google", "slack", etc. */
    provider: text("provider").notNull(),
    /** The `account_id` value from `connector_accounts` to use for this module. */
    accountId: text("account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueBinding: unique().on(t.tenantId, t.moduleId, t.provider),
  }),
);
