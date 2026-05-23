/**
 * Phase 15 Smoke Tests — Drive Features
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDbConfig } from "./_helpers.js";

const KEY = "drive-admin";

describe("drive features", () => {
  it("drive skill revisions via admin API", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { generateId } = await import("@boringos/shared");
    const { tenants } = await import("@boringos/db");

    const d = await mkdtemp(join(tmpdir(), "boringos-drive-"));
    const server = await new BoringOS({
      database: testDbConfig(d, 5575),
      drive: { root: join(d, "drive") },
      auth: { secret: "s", adminKey: KEY },
    }).listen(0);

    try {
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Drive Co", slug: "drive-co" });

      const h = { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tid };

      // Update drive skill (creates first revision)
      await fetch(`${server.url}/api/admin/drive/skill`, {
        method: "PATCH", headers: h,
        body: JSON.stringify({ content: "# Drive Rules v1\n\nOrganize by project.", changedBy: "user" }),
      });

      // Update again (creates second revision)
      await fetch(`${server.url}/api/admin/drive/skill`, {
        method: "PATCH", headers: h,
        body: JSON.stringify({ content: "# Drive Rules v2\n\nOrganize by date.", changedBy: "agent" }),
      });

      // Get current skill
      const skillRes = await fetch(`${server.url}/api/admin/drive/skill`, { headers: h });
      const skill = await skillRes.json() as { skill: string };
      expect(skill.skill).toContain("v2");

      // List revisions
      const revRes = await fetch(`${server.url}/api/admin/drive/skill/revisions`, { headers: h });
      const revs = await revRes.json() as { revisions: Array<{ changedBy: string }> };
      expect(revs.revisions).toHaveLength(2);
    } finally { await server.close(); }
  }, 30000);

  it("DriveManager writes file and indexes in DB", async () => {
    const { createLocalStorage, createDriveManager } = await import("@boringos/drive");
    const { createDatabase, createMigrationManager, driveFiles } = await import("@boringos/db");
    const { eq } = await import("drizzle-orm");

    const d = await mkdtemp(join(tmpdir(), "boringos-drvmgr-"));
    const conn = await createDatabase(testDbConfig(join(d, "pg"), 5574));
    await createMigrationManager(conn.db).apply();

    const { tenants } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const tid = generateId();
    await conn.db.insert(tenants).values({ id: tid, name: "DM Test", slug: "dm-test" });

    const storage = createLocalStorage({ root: join(d, "drive") });
    const manager = createDriveManager({ storage, db: conn.db, tenantId: tid });

    // Write a file
    const record = await manager.write("docs/readme.md", "# Hello\n\nThis is a test.");
    expect(record.filename).toBe("readme.md");
    expect(record.format).toBe("md");
    expect(record.size).toBeGreaterThan(0);
    expect(record.hash).toBeTruthy();

    // Read it back
    const content = await manager.read("docs/readme.md");
    expect(content).toContain("Hello");

    // List files from DB
    const files = await manager.list();
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("docs/readme.md");

    // Verify DB row
    const rows = await conn.db.select().from(driveFiles).where(eq(driveFiles.tenantId, tid));
    expect(rows).toHaveLength(1);

    await conn.close();
  }, 30000);
});
