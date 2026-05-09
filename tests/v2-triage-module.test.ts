/**
 * v2 triage capability module — Phase 9 of task_12.
 *
 * Verifies:
 *  - capability resolution: registering triage WITHOUT inbox throws
 *  - registration succeeds when inbox is registered first
 *  - next_pending returns unread + un-triaged items in FIFO order
 *  - classify writes the triage block onto metadata
 *  - next_pending excludes already-classified items (the metadata
 *    filter is the mechanism)
 */
import { describe, it, expect } from "vitest";

describe("v2 — triage capability module", () => {
  it("dependsOn: capability resolution — fails without inbox provider", async () => {
    const { createToolRegistry, createSkillRegistry, createModuleRegistry } =
      await import("@boringos/agent");
    const { createTriageModule } = await import("@boringos/core");

    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    expect(() => modules.register(createTriageModule({ db: null as never }))).toThrow(
      /inbox/,
    );
  });

  it("dependsOn: capability resolution — succeeds when inbox provider is registered first", async () => {
    const { createToolRegistry, createSkillRegistry, createModuleRegistry } =
      await import("@boringos/agent");
    const { createInboxModule, createTriageModule } = await import("@boringos/core");

    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register(createInboxModule({ db: null as never }));
    modules.register(createTriageModule({ db: null as never }));

    expect(modules.list().map((m) => m.id).sort()).toEqual(["inbox", "triage"]);
    expect(tools.get("triage.next_pending")).toBeDefined();
    expect(tools.get("triage.classify")).toBeDefined();
  });

  it("end-to-end: classifies inbox items and excludes already-classified ones", async () => {
    const {
      BoringOS,
      createFrameworkModule,
      createInboxModule,
      createTriageModule,
    } = await import("@boringos/core");
    const { signCallbackToken } = await import("@boringos/agent");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-v2-triage-"));
    const jwtSecret = "v2-triage-secret";

    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5583 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: jwtSecret },
    });

    app.module(createFrameworkModule);
    app.module(createInboxModule);
    app.module(createTriageModule);

    const server = await app.listen(0);
    try {
      const { tenants, agents, inboxItems } = await import("@boringos/db");
      const { eq, asc } = await import("drizzle-orm");
      const { generateId } = await import("@boringos/shared");
      const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
      const tenantId = "16161616-1616-4161-8161-161616161616";
      const agentId = "17171717-1717-4171-8171-171717171717";
      const runId = "18181818-1818-4181-8181-181818181818";

      await db
        .insert(tenants)
        .values({ id: tenantId, name: "Test", slug: "test-triage" })
        .onConflictDoNothing();
      await db
        .insert(agents)
        .values({ id: agentId, tenantId, name: "T", role: "general" })
        .onConflictDoNothing();

      // Seed three unread inbox items, oldest first.
      const ids = [generateId(), generateId(), generateId()];
      const now = Date.now();
      for (let i = 0; i < ids.length; i += 1) {
        await db.insert(inboxItems).values({
          id: ids[i],
          tenantId,
          source: "test",
          subject: `Item ${i + 1}`,
          body: `Body ${i + 1}`,
          from: "test@example.com",
          status: "unread",
          createdAt: new Date(now + i * 1000),
        });
      }

      const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);
      const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      // 1. next_pending returns the oldest unread untriaged item.
      const next1 = await fetch(`${server.url}/api/tools/triage.next_pending`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({}),
      });
      expect(next1.status).toBe(200);
      const next1Body = await next1.json() as { ok: boolean; result: { item: { id: string; subject: string } | null } };
      expect(next1Body.result.item).not.toBeNull();
      expect(next1Body.result.item?.id).toBe(ids[0]);
      expect(next1Body.result.item?.subject).toBe("Item 1");

      // 2. classify it as urgent.
      const classify1 = await fetch(`${server.url}/api/tools/triage.classify`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          itemId: ids[0],
          label: "urgent",
          reason: "test reason urgent",
        }),
      });
      expect(classify1.status).toBe(200);
      const classify1Body = await classify1.json() as { ok: boolean };
      expect(classify1Body.ok).toBe(true);

      // 3. next_pending now returns the SECOND oldest item (the
      //    first is excluded by the metadata.triage filter).
      const next2 = await fetch(`${server.url}/api/tools/triage.next_pending`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({}),
      });
      const next2Body = await next2.json() as { ok: boolean; result: { item: { id: string } | null } };
      expect(next2Body.result.item?.id).toBe(ids[1]);

      // 4. Classify items 2 + 3.
      await fetch(`${server.url}/api/tools/triage.classify`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ itemId: ids[1], label: "fyi", reason: "test" }),
      });
      await fetch(`${server.url}/api/tools/triage.classify`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ itemId: ids[2], label: "noise", reason: "test" }),
      });

      // 5. next_pending now returns null (queue drained).
      const next3 = await fetch(`${server.url}/api/tools/triage.next_pending`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({}),
      });
      const next3Body = await next3.json() as { ok: boolean; result: { item: unknown | null } };
      expect(next3Body.result.item).toBeNull();

      // 6. The DB rows carry the triage metadata.
      const all = await db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.tenantId, tenantId))
        .orderBy(asc(inboxItems.createdAt));
      const labels = all.map((row) => {
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        const triage = (meta.triage ?? {}) as Record<string, unknown>;
        return triage.label;
      });
      expect(labels).toEqual(["urgent", "fyi", "noise"]);
    } finally {
      await server.close();
    }
  }, 90000);
});
