/**
 * v2 Module.schema migration runtime — Chunk C of the final
 * session.
 *
 * Verifies:
 *  - install runs every Module.schema migration's up()
 *  - re-install is idempotent (already-applied migrations skip)
 *  - uninstall runs the matching down() in reverse order
 *  - migration tracking rows are written / cleared
 */
import { describe, it, expect } from "vitest";

describe("v2 — Module.schema migration runtime", () => {
  it("install applies migrations once; re-install is idempotent; uninstall rolls back", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { z } = await import("@boringos/module-sdk");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-v2-mig-"));
    const upCalls: string[] = [];
    const downCalls: string[] = [];

    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5576 },
      drive: { root: join(dataDir, "drive") },
    });

    // A pure capability module that ships two declared
    // migrations. We track up/down calls as side-effects so the
    // test can assert ordering and idempotency without
    // inspecting actual DDL.
    app.module({
      id: "schema-test",
      name: "Schema test",
      version: "0.1.0",
      description: "...",
      defaultInstall: false, // require explicit install
      schema: [
        {
          id: "0001_create_widgets",
          async up(db) {
            upCalls.push("0001_up");
            await db.execute(
              "CREATE TABLE IF NOT EXISTS schema_test__widgets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL)",
            );
          },
          async down(db) {
            downCalls.push("0001_down");
            await db.execute("DROP TABLE IF EXISTS schema_test__widgets");
          },
        },
        {
          id: "0002_add_label",
          async up(db) {
            upCalls.push("0002_up");
            await db.execute(
              "ALTER TABLE schema_test__widgets ADD COLUMN IF NOT EXISTS label TEXT",
            );
          },
          async down(db) {
            downCalls.push("0002_down");
            await db.execute(
              "ALTER TABLE schema_test__widgets DROP COLUMN IF EXISTS label",
            );
          },
        },
      ],
      tools: [
        {
          name: "noop",
          description: "noop",
          inputs: z.object({}),
          async handler() {
            return { ok: true, result: {} };
          },
        },
      ],
    });

    const server = await app.listen(0);
    try {
      const { tenants } = await import("@boringos/db");
      const { sql } = await import("drizzle-orm");
      const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
      const tenantId = "2b2b2b2b-2b2b-42b2-82b2-2b2b2b2b2b2b";
      await db
        .insert(tenants)
        .values({ id: tenantId, name: "T", slug: "test-mig" })
        .onConflictDoNothing();

      const adminHeaders = { "X-Tenant-Id": tenantId, "Content-Type": "application/json" };

      // 1. Install — both migrations run once.
      const inst1 = await fetch(
        `${server.url}/api/admin/v2/modules/schema-test/install`,
        { method: "POST", headers: adminHeaders, body: "{}" },
      );
      expect(inst1.status).toBe(200);
      expect(upCalls).toEqual(["0001_up", "0002_up"]);
      expect(downCalls).toEqual([]);

      // The actual table exists.
      const checkTable = (await db.execute(
        sql`SELECT to_regclass('schema_test__widgets') AS exists`,
      )) as unknown as Array<{ exists: string | null }>;
      expect(checkTable[0]?.exists).toBe("schema_test__widgets");

      // 2. Re-install — neither up() fires again.
      upCalls.length = 0;
      const inst2 = await fetch(
        `${server.url}/api/admin/v2/modules/schema-test/install`,
        { method: "POST", headers: adminHeaders, body: "{}" },
      );
      expect(inst2.status).toBe(200);
      expect(upCalls).toEqual([]); // idempotent

      // 3. Uninstall — down() runs in reverse order.
      const uninst = await fetch(
        `${server.url}/api/admin/v2/modules/schema-test/uninstall`,
        { method: "POST", headers: adminHeaders, body: "{}" },
      );
      expect(uninst.status).toBe(200);
      expect(downCalls).toEqual(["0002_down", "0001_down"]);

      // Table is gone.
      const checkAfter = (await db.execute(
        sql`SELECT to_regclass('schema_test__widgets') AS exists`,
      )) as unknown as Array<{ exists: string | null }>;
      expect(checkAfter[0]?.exists).toBeNull();

      // 4. Re-install after uninstall — up() runs again.
      upCalls.length = 0;
      const inst3 = await fetch(
        `${server.url}/api/admin/v2/modules/schema-test/install`,
        { method: "POST", headers: adminHeaders, body: "{}" },
      );
      expect(inst3.status).toBe(200);
      expect(upCalls).toEqual(["0001_up", "0002_up"]);
    } finally {
      await server.close();
    }
  }, 90000);
});
