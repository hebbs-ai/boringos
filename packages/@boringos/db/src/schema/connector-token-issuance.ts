// SPDX-License-Identifier: MIT
//
// `connector_token_issuance` — audit log for every OAuth token brokered
// through `getConnectorToken`. One row per call, fire-and-forget written
// by the connector-token dispatcher.
//
// What this gives you:
//   - "who's hitting Google hardest" — group by caller_module_id
//   - per-module rate of issuance / refresh
//   - anomaly detection (a module that suddenly spikes refresh rate)
//   - retroactive "what asked Google for what at time T" after an incident
//
// The access token itself is NEVER stored here. Only metadata.

import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const connectorTokenIssuance = pgTable(
  "connector_token_issuance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Provider kind: "google", "slack", … */
    kind: text("kind").notNull(),
    /** Module that asked for the token. Self-reported; for diagnostics, not authz. */
    callerModuleId: text("caller_module_id").notNull(),
    /**
     * Outcome of the call:
     *  - "issued"        -- returned an existing fresh token
     *  - "refreshed"     -- refreshed the token, returned the new one
     *  - "not_connected" -- no creds row, or unknown kind, returned null
     *  - "refresh_failed" -- tried to refresh but provider refused; fell back
     */
    outcome: text("outcome").notNull(),
    /**
     * v2 AuthManager populates this with the canonical provider name
     * (e.g. "google", "slack"). Older rows written by the v1 dispatcher
     * will have NULL here; use `kind` for those rows.
     */
    provider: text("provider"),
    /**
     * v2 AuthManager populates this with the account_id from
     * `connector_accounts` that was used for the issuance. NULL on legacy
     * rows. Useful for "which Google account caused the spike" queries.
     */
    accountId: text("account_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantKindIdx: index("token_issuance_tenant_kind_idx").on(
      table.tenantId,
      table.kind,
      table.issuedAt,
    ),
    callerIdx: index("token_issuance_caller_idx").on(
      table.tenantId,
      table.callerModuleId,
      table.issuedAt,
    ),
  }),
);
