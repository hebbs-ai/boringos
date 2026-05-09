// SPDX-License-Identifier: MIT
//
// `module_installs` — per-tenant install state for v2 Modules.
// Phase 9 of task_12.
//
// The host application imports Modules and registers them with
// `app.module(...)` at boot. That populates the global ToolRegistry /
// SkillRegistry. This table records which of those globally-known
// modules a given tenant has actually OPTED INTO — distinguishing
// "module exists in the host" from "this tenant uses it."
//
// In Phase 9 the v2 surface still exposes every host-registered
// Module to every tenant (back-compat — same behavior as v1). This
// table sets up the schema for fine-grained per-tenant
// install/uninstall in Phase 10.

import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const moduleInstalls = pgTable(
  "module_installs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    moduleId: text("module_id").notNull(),
    version: text("version").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantModuleUniq: uniqueIndex("module_installs_tenant_module_idx").on(
      table.tenantId,
      table.moduleId,
    ),
  }),
);
