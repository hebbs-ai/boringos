// SPDX-License-Identifier: MIT
//
// v2 CRM module schema. Tables prefixed `hebbs_crm__` per the v2
// naming convention (`<module-id>__<table>` → easy uninstall via
// LIKE 'hebbs_crm__%'). Phase 8 of task_12.
//
// This is the canonical v2 CRM, additive — does NOT touch the v1
// CRM tables in the separate hebbs-clients/boringos-crm repo's
// own DB. Cutover replaces the v1 CRM with this; until then they
// run side by side on different deployments.

import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const hebbsCrmPipelines = pgTable(
  "hebbs_crm__pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Ordered list of stages: [{ id, name, order, probability? }]. */
    stages: jsonb("stages").$type<Array<{ id: string; name: string; order: number; probability?: number }>>().notNull().default([]),
    isDefault: text("is_default").notNull().default("false"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index("hebbs_crm__pipelines_tenant_idx").on(table.tenantId),
  }),
);

export const hebbsCrmContacts = pgTable(
  "hebbs_crm__contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    title: text("title"),
    notes: text("notes"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index("hebbs_crm__contacts_tenant_idx").on(table.tenantId),
    emailIdx: index("hebbs_crm__contacts_email_idx").on(table.tenantId, table.email),
  }),
);

export const hebbsCrmDeals = pgTable(
  "hebbs_crm__deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Amount in cents (no float math). */
    amountCents: integer("amount_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    pipelineId: uuid("pipeline_id").notNull(),
    /** Stage id within the pipeline's `stages` array. */
    stageId: text("stage_id").notNull(),
    contactId: uuid("contact_id"),
    expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
    notes: text("notes"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index("hebbs_crm__deals_tenant_idx").on(table.tenantId),
    pipelineIdx: index("hebbs_crm__deals_pipeline_idx").on(table.tenantId, table.pipelineId),
    stageIdx: index("hebbs_crm__deals_stage_idx").on(table.tenantId, table.stageId),
    contactIdx: index("hebbs_crm__deals_contact_idx").on(table.contactId),
  }),
);

export const hebbsCrmActivities = pgTable(
  "hebbs_crm__activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** What was acted upon: "deal" | "contact" | "pipeline". */
    entityKind: text("entity_kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** Free-form action verb: "created" | "stage_changed" | "note_added" | etc. */
    action: text("action").notNull(),
    /** Action-specific payload. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    /** Who performed it. */
    actorAgentId: uuid("actor_agent_id"),
    actorUserId: uuid("actor_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEntityIdx: index("hebbs_crm__activities_tenant_entity_idx").on(table.tenantId, table.entityKind, table.entityId),
  }),
);
