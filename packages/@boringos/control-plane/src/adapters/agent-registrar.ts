// SPDX-License-Identifier: BUSL-1.1
//
// K3 — agent registration runner.
//
// Reads `AppDefinition.agents` and writes one row per agent into the
// framework's `agents` table inside the install transaction. Each row
// is tagged with `metadata.appId` (and `metadata.appAgentDefId`) so a
// re-install can identify the prior set and replace it idempotently.
//
// Out of scope: waking the agents — that is a per-trigger concern.
// We only land the registration row.

import { sql } from "drizzle-orm";

import type { AppDefinition, AgentDefinition } from "@boringos/app-sdk";

import type { DrizzleTx } from "./drizzle-install-db.js";

export interface RegisterAppAgentsArgs {
  tenantId: string;
  appId: string;
  agents: AgentDefinition[];
}

export interface RegisteredAgent {
  id: string;
  appAgentDefId: string;
  name: string;
}

export interface RegisterAppAgentsResult {
  inserted: RegisteredAgent[];
  removed: number;
}

/**
 * Idempotently register an app's agents inside an install transaction.
 *
 * Strategy: UPSERT by (tenant_id, metadata->>'appAgentDefId'). For each
 * agent in the definition, find an existing row with the same
 * `appAgentDefId` for this tenant and UPDATE it; otherwise INSERT.
 * Then delete any orphan rows for this app whose def-id is no longer
 * in the definition (e.g., the app removed an agent in a new version).
 *
 * Why upsert and not delete-then-insert: deletion changes the row's
 * primary key, which orphans every FK reference (agent_runs,
 * agent_wakeup_requests, tasks.assignee_agent_id, …). Even with
 * ON DELETE SET NULL on those FKs, the historical lineage is lost
 * and live tasks become un-assigned.
 *
 * Why upsert and not blind-insert: the previous "delete-by-appId then
 * insert" pattern was supposed to be idempotent but failed silently
 * when the version short-circuit in tenant-provisioning skipped this
 * function entirely on re-installs. Result: duplicate rows for the
 * same `appAgentDefId` accumulated across re-installs (observed
 * 2026-05-07: 4 rows for two def-ids).
 */
export async function registerAppAgents(
  tx: DrizzleTx,
  args: RegisterAppAgentsArgs,
): Promise<RegisterAppAgentsResult> {
  const { tenantId, appId, agents } = args;

  if (agents.length === 0) {
    // Nothing to register — just remove any stale rows for this app.
    const removed = (await tx.execute(sql`
      DELETE FROM agents
      WHERE tenant_id = ${tenantId}
        AND metadata @> ${JSON.stringify({ appId })}::jsonb
      RETURNING id
    `)) as Array<{ id: string }>;
    return { inserted: [], removed: removed.length };
  }

  const inserted: RegisteredAgent[] = [];
  const keepDefIds: string[] = [];

  for (const def of agents) {
    if (!def.id) {
      throw new AgentRegistrarError(
        `Agent definition for app "${appId}" missing required \`id\``,
      );
    }
    if (!def.name) {
      throw new AgentRegistrarError(
        `Agent definition "${def.id}" for app "${appId}" missing \`name\``,
      );
    }
    keepDefIds.push(def.id);

    const persona = typeof def.persona === "string" ? def.persona : null;
    const role = persona ?? "general";
    const instructions =
      typeof def.instructions === "string" ? def.instructions : null;
    const runtime = typeof def.runtime === "string" ? def.runtime : null;
    // Accept both `routingTags` (new) and `skills` (legacy) on the
    // app's AgentDefinition for one release; the column is
    // `routing_tags` (renamed in task_15 §1).
    const tagsSrc = (def as { routingTags?: unknown; skills?: unknown }).routingTags
      ?? (def as { skills?: unknown }).skills;
    const routingTags = Array.isArray(tagsSrc)
      ? (tagsSrc as unknown[]).filter((s): s is string => typeof s === "string")
      : [];

    const metadata = {
      appId,
      appAgentDefId: def.id,
      runtimeKind: runtime,
      persona,
    };

    const runtimeKind = runtime ?? "claude";
    const runtimeRows = (await tx.execute(sql`
      SELECT id FROM runtimes
       WHERE tenant_id = ${tenantId} AND type = ${runtimeKind}
       LIMIT 1
    `)) as Array<{ id: string }>;
    const runtimeId = runtimeRows[0]?.id ?? null;

    // Find existing agent for (tenant, appAgentDefId).
    const existing = (await tx.execute(sql`
      SELECT id FROM agents
       WHERE tenant_id = ${tenantId}
         AND metadata->>'appAgentDefId' = ${def.id}
       LIMIT 1
    `)) as Array<{ id: string }>;

    let id: string;
    if (existing[0]) {
      // UPDATE in place — preserves all FK references.
      id = existing[0].id;
      await tx.execute(sql`
        UPDATE agents SET
          name         = ${def.name},
          role         = ${role},
          instructions = ${instructions},
          routing_tags = ${JSON.stringify(routingTags)}::jsonb,
          metadata     = ${JSON.stringify(metadata)}::jsonb,
          runtime_id   = ${runtimeId},
          updated_at   = NOW()
         WHERE id = ${id}
      `);
    } else {
      // Inherit the tenant's existing root agent (Chief of Staff /
      // Copilot) as our reports_to. Required since the
      // `agents_tenant_one_root_idx` unique partial index allows only
      // one agent per tenant with reports_to IS NULL — installing a
      // default app agent without a parent would collide.
      const rootRows = (await tx.execute(sql`
        SELECT id FROM agents
         WHERE tenant_id = ${tenantId} AND reports_to IS NULL
         ORDER BY created_at ASC
         LIMIT 1
      `)) as Array<{ id: string }>;
      const reportsTo = rootRows[0]?.id ?? null;

      const rows = (await tx.execute(sql`
        INSERT INTO agents (
          tenant_id, name, role, instructions, routing_tags, metadata, runtime_id, reports_to
        )
        VALUES (
          ${tenantId},
          ${def.name},
          ${role},
          ${instructions},
          ${JSON.stringify(routingTags)}::jsonb,
          ${JSON.stringify(metadata)}::jsonb,
          ${runtimeId},
          ${reportsTo}
        )
        RETURNING id
      `)) as Array<{ id: string }>;
      id = rows[0]?.id ?? "";
      if (!id) {
        throw new AgentRegistrarError(
          `Insert for agent "${def.id}" did not return an id`,
        );
      }
    }

    inserted.push({ id, appAgentDefId: def.id, name: def.name });
  }

  // Remove rows for this app whose def-id is no longer present.
  // Use jsonb containment to scope by appId, then check the
  // appAgentDefId is not in the keep-list.
  const orphanLiterals = keepDefIds.map((d) => `'${d.replace(/'/g, "''")}'`).join(",");
  const orphanFilter = orphanLiterals.length > 0
    ? sql.raw(`AND metadata->>'appAgentDefId' NOT IN (${orphanLiterals})`)
    : sql.raw("");
  const removed = (await tx.execute(sql`
    DELETE FROM agents
    WHERE tenant_id = ${tenantId}
      AND metadata @> ${JSON.stringify({ appId })}::jsonb
      ${orphanFilter}
    RETURNING id
  `)) as Array<{ id: string }>;

  return { inserted, removed: removed.length };
}

/**
 * Convenience wrapper that pulls the agent list off an AppDefinition.
 * Lets the kernel install context call `registerAgentsFromDefinition`
 * without unpacking each time.
 */
export async function registerAgentsFromDefinition(
  tx: DrizzleTx,
  tenantId: string,
  appId: string,
  definition: AppDefinition,
): Promise<RegisterAppAgentsResult> {
  return registerAppAgents(tx, {
    tenantId,
    appId,
    agents: definition.agents ?? [],
  });
}

export class AgentRegistrarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRegistrarError";
  }
}
