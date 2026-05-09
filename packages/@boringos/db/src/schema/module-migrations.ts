// SPDX-License-Identifier: MIT
//
// `module_migrations` — tracks which Module.schema migrations
// have been applied per (tenant, module). Phase C of the v2
// rebuild. Used by the install manager to:
//   - skip already-applied migrations on re-install
//   - run only-applied migrations' down() on uninstall

import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const moduleMigrations = pgTable(
  "module_migrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    moduleId: text("module_id").notNull(),
    migrationId: text("migration_id").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniq: uniqueIndex("module_migrations_uniq_idx").on(
      table.tenantId,
      table.moduleId,
      table.migrationId,
    ),
  }),
);
