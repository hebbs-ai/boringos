/**
 * K3 — agent registration runner.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import {
  createDrizzleInstallDb,
  registerAppAgents,
  registerAgentsFromDefinition,
} from "@boringos/control-plane";

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let tenantId: string;

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-k3-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5596,
  });
  await createMigrationManager(conn.db).apply();

  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('K3 Test', 'k3-test')
    RETURNING id
  `);
  tenantId = (inserted as any[])[0].id as string;
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

async function listForApp(appId: string) {
  return (await conn.db.execute(sql`
    SELECT id, name, role, instructions, metadata, skills
    FROM agents
    WHERE tenant_id = ${tenantId}
      AND metadata @> ${JSON.stringify({ appId })}::jsonb
    ORDER BY name
  `)) as Array<{
    id: string;
    name: string;
    role: string;
    instructions: string | null;
    metadata: Record<string, unknown>;
    skills: string[];
  }>;
}

describe("registerAppAgents", () => {
  it("creates one row per AppDefinition.agents[] entry, populating persona/runtime/instructions", async () => {
    const adapter = createDrizzleInstallDb(conn.db);

    const result = await adapter.transaction(async (_db, tx) =>
      registerAppAgents(tx, {
        tenantId,
        appId: "k3-app-x",
        agents: [
          {
            id: "triage",
            name: "Email Triage",
            persona: "researcher",
            runtime: "claude",
            instructions: "Classify inbox items.",
            skills: ["triage.md"],
          },
          {
            id: "writer",
            name: "Follow-up Writer",
            persona: "researcher",
            runtime: "claude",
            instructions: "Draft polite replies.",
          },
        ],
      }),
    );

    expect(result.inserted.map((r) => r.appAgentDefId).sort()).toEqual([
      "triage",
      "writer",
    ]);
    expect(result.removed).toBe(0);

    const rows = await listForApp("k3-app-x");
    expect(rows).toHaveLength(2);

    const triage = rows.find((r) => r.name === "Email Triage")!;
    expect(triage.role).toBe("researcher");
    expect(triage.instructions).toBe("Classify inbox items.");
    expect(triage.metadata).toMatchObject({
      appId: "k3-app-x",
      appAgentDefId: "triage",
      runtimeKind: "claude",
      persona: "researcher",
    });
    expect(triage.skills).toEqual(["triage.md"]);
  });

  it("re-installing the same app idempotently replaces prior agents", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    const first = await adapter.transaction(async (_db, tx) =>
      registerAppAgents(tx, {
        tenantId,
        appId: "k3-app-y",
        agents: [
          { id: "a", name: "Agent A" },
          { id: "b", name: "Agent B" },
        ],
      }),
    );
    expect(first.inserted).toHaveLength(2);
    expect(await listForApp("k3-app-y")).toHaveLength(2);

    const second = await adapter.transaction(async (_db, tx) =>
      registerAppAgents(tx, {
        tenantId,
        appId: "k3-app-y",
        agents: [
          { id: "a", name: "Agent A v2" },
          { id: "c", name: "Agent C" },
        ],
      }),
    );
    // Agent B is removed (no longer in definition), A is updated, C is added.
    // inserted includes both updated and new agents.
    expect(second.removed).toBe(1);
    expect(second.inserted).toHaveLength(2);

    const rows = await listForApp("k3-app-y");
    expect(rows.map((r) => r.name).sort()).toEqual(["Agent A v2", "Agent C"]);
  });

  it("registerAgentsFromDefinition pulls from AppDefinition", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    await adapter.transaction(async (_db, tx) =>
      registerAgentsFromDefinition(tx, tenantId, "k3-app-z", {
        id: "k3-app-z",
        agents: [{ id: "solo", name: "Solo Agent" }],
      }),
    );
    expect(await listForApp("k3-app-z")).toHaveLength(1);
  });

  it("empty definition.agents removes prior registrations cleanly", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    await adapter.transaction(async (_db, tx) =>
      registerAppAgents(tx, {
        tenantId,
        appId: "k3-app-w",
        agents: [{ id: "ephemeral", name: "Ephemeral" }],
      }),
    );
    expect(await listForApp("k3-app-w")).toHaveLength(1);

    const result = await adapter.transaction(async (_db, tx) =>
      registerAppAgents(tx, { tenantId, appId: "k3-app-w", agents: [] }),
    );
    expect(result.inserted).toHaveLength(0);
    expect(result.removed).toBe(1);
    expect(await listForApp("k3-app-w")).toHaveLength(0);
  });
});
