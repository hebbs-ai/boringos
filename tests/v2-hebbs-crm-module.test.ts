/**
 * v2 Hebbs CRM module integration test — Phase 8 of task_12.
 *
 * Boots BoringOS with the framework + CRM modules. Confirms the
 * CRM tools dispatch end-to-end against the new
 * `hebbs_crm__*` tables: list / create deals + contacts +
 * pipelines, move stages, audit activity rows logged.
 */
import { describe, it, expect } from "vitest";

describe("v2 — hebbs-crm module end-to-end", () => {
  it("creates pipelines, deals, contacts, moves stages — end-to-end via tools", async () => {
    const { BoringOS, createFrameworkModule, createHebbsCrmModule } = await import("@boringos/core");
    const { signCallbackToken } = await import("@boringos/agent");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-v2-crm-"));
    const jwtSecret = "v2-crm-secret";
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5587 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: jwtSecret },
    });

    app.module(createFrameworkModule);
    app.module(createHebbsCrmModule);

    const server = await app.listen(0);
    try {
      const { tenants, agents, hebbsCrmPipelines, hebbsCrmDeals, hebbsCrmActivities } = await import(
        "@boringos/db"
      );
      const { eq } = await import("drizzle-orm");
      const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
      const tenantId = "77777777-7777-4777-8777-777777777777";
      const agentId = "88888888-8888-4888-8888-888888888888";
      const runId = "99999999-9999-4999-8999-999999999999";
      const pipelineId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

      await db
        .insert(tenants)
        .values({ id: tenantId, name: "Test", slug: "test-crm" })
        .onConflictDoNothing();
      await db
        .insert(agents)
        .values({ id: agentId, tenantId, name: "T", role: "general" })
        .onConflictDoNothing();
      // Seed a pipeline directly for the test (the v2 CRM
      // lifecycle.onInstall hook that auto-creates a default
      // pipeline is not yet wired — Phase 8 follow-up).
      await db
        .insert(hebbsCrmPipelines)
        .values({
          id: pipelineId,
          tenantId,
          name: "Default sales pipeline",
          stages: [
            { id: "new", name: "New", order: 0 },
            { id: "qualified", name: "Qualified", order: 1 },
            { id: "won", name: "Closed-Won", order: 2 },
          ],
          isDefault: "true",
        })
        .onConflictDoNothing();

      const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);
      const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      // 1. list_pipelines returns the seeded pipeline.
      const pipes = await fetch(`${server.url}/api/tools/hebbs-crm.list_pipelines`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({}),
      });
      expect(pipes.status).toBe(200);
      const pipesBody = await pipes.json() as { result: { pipelines: Array<{ id: string }> } };
      expect(pipesBody.result.pipelines).toHaveLength(1);
      expect(pipesBody.result.pipelines[0].id).toBe(pipelineId);

      // 2. create_contact.
      const contact = await fetch(`${server.url}/api/tools/hebbs-crm.create_contact`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Atul Patel", email: "atul@example.com", company: "Acme" }),
      });
      expect(contact.status).toBe(200);
      const contactBody = await contact.json() as { result: { contactId: string } };
      const contactId = contactBody.result.contactId;
      expect(contactId).toBeTruthy();

      // 3. create_deal at "new" stage.
      const deal = await fetch(`${server.url}/api/tools/hebbs-crm.create_deal`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          title: "Acme — Q2 contract",
          amountCents: 50000_00,
          pipelineId,
          stageId: "new",
          contactId,
        }),
      });
      expect(deal.status).toBe(200);
      const dealBody = await deal.json() as { result: { dealId: string } };
      const dealId = dealBody.result.dealId;

      // 4. list_deals returns it.
      const dealsList = await fetch(`${server.url}/api/tools/hebbs-crm.list_deals`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({}),
      });
      const dealsBody = await dealsList.json() as { result: { deals: Array<{ id: string; stageId: string }> } };
      expect(dealsBody.result.deals.some((d) => d.id === dealId && d.stageId === "new")).toBe(true);

      // 5. move_stage to "qualified", then "won".
      const move1 = await fetch(`${server.url}/api/tools/hebbs-crm.move_stage`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ dealId, stageId: "qualified", note: "demo went well" }),
      });
      expect(move1.status).toBe(200);
      const move2 = await fetch(`${server.url}/api/tools/hebbs-crm.move_stage`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ dealId, stageId: "won" }),
      });
      expect(move2.status).toBe(200);

      // 6. The deal now sits at "won".
      const refetch = await fetch(`${server.url}/api/tools/hebbs-crm.list_deals`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ stageId: "won" }),
      });
      const refetchBody = await refetch.json() as { result: { deals: Array<{ id: string }> } };
      expect(refetchBody.result.deals.some((d) => d.id === dealId)).toBe(true);

      // 7. Activities log: 4 rows expected — contact created, deal
      //    created, two stage_changed.
      const activities = await db
        .select()
        .from(hebbsCrmActivities)
        .where(eq(hebbsCrmActivities.tenantId, tenantId));
      expect(activities.length).toBeGreaterThanOrEqual(4);
      const actions = new Set(activities.map((a) => a.action));
      expect(actions.has("created")).toBe(true);
      expect(actions.has("stage_changed")).toBe(true);

      // 8. Confirm the underlying table contents, not just tool
      //    return values.
      const dbDeals = await db.select().from(hebbsCrmDeals).where(eq(hebbsCrmDeals.id, dealId));
      expect(dbDeals[0]?.stageId).toBe("won");
      expect(dbDeals[0]?.amountCents).toBe(50000_00);
      expect(dbDeals[0]?.contactId).toBe(contactId);
    } finally {
      await server.close();
    }
  }, 90000);
});
