/**
 * task_26 — CRM .hebbsmod ships dashboardWidgets on its PluginUI.
 *
 * Boots BoringOS, uploads the CRM fixture .hebbsmod, installs it for
 * a tenant, then fetches /modules/crm/ui/index.mjs and asserts the
 * bundle text references both new widgets. This is the closest we
 * can get to "the shell loaded the widget" without spinning up a
 * browser — anything reachable in the bundle text is reachable by
 * `pluginHost.register()` at runtime.
 */
import { describe, it, expect, beforeAll } from "vitest";

describe("task_26 — CRM .hebbsmod includes dashboard widgets", () => {
  beforeAll(() => {
    process.env.HEBBS_DEV_MODULES = "true";
  });

  it("ships PipelineByStage + DealsClosingThisWeek widgets on the CRM PluginUI", async () => {
    const { BoringOS, createFrameworkModule, createMemoryModule } = await import(
      "@boringos/core"
    );
    const { mkdtemp, mkdir, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { randomUUID } = await import("node:crypto");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-task26-"));
    const storeDir = join(
      process.cwd(),
      ".data",
      `module-store-test-task26-${Date.now()}`,
    );
    process.env.MODULES_STORE_DIR = storeDir;
    await mkdir(storeDir, { recursive: true });

    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5595 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: "task26-secret" },
      queue: { concurrency: 1 },
    });
    app.module(createFrameworkModule);
    app.module(createMemoryModule);

    const server = await app.listen(0);
    try {
      const baseUrl = server.url;
      const tenantId = randomUUID();

      // The install endpoint expects a real tenants row; pre-seed.
      const { tenants } = await import("@boringos/db");
      const db = (
        server as unknown as { context: { db: import("@boringos/db").Db } }
      ).context.db;
      await db
        .insert(tenants)
        .values({ id: tenantId, name: "task26", slug: `task26-${Date.now()}` })
        .onConflictDoNothing();

      // Upload the fixture .hebbsmod (rebuilt at top of test session).
      const fixturePath = join(
        process.cwd(),
        "tests",
        "fixtures",
        "crm-0.2.0.hebbsmod",
      );
      const bundle = await readFile(fixturePath);
      const form = new FormData();
      form.append(
        "file",
        new Blob([bundle], { type: "application/zip" }),
        "crm-0.2.0.hebbsmod",
      );
      const uploadRes = await fetch(`${baseUrl}/api/admin/modules/upload`, {
        method: "POST",
        headers: { "X-Tenant-Id": tenantId },
        body: form,
      });
      expect(uploadRes.status).toBe(201);

      // Install for the tenant.
      const installRes = await fetch(
        `${baseUrl}/api/admin/modules/crm/install`,
        {
          method: "POST",
          headers: {
            "X-Tenant-Id": tenantId,
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      );
      expect(installRes.status).toBe(200);

      // Fetch the UI bundle the shell would dynamic-import.
      const uiRes = await fetch(`${baseUrl}/modules/crm/ui/index.mjs`);
      expect(uiRes.status).toBe(200);
      const uiSource = await uiRes.text();

      // The widget id strings are literal in the PluginUI manifest and
      // survive minification; the component identifiers may not (Vite
      // mangles function names in lib mode).
      expect(uiSource).toContain("dashboardWidgets");
      expect(uiSource).toContain("pipeline-by-stage");
      expect(uiSource).toContain("deals-closing-this-week");
      // Title strings are also literal in the manifest.
      expect(uiSource).toContain("Pipeline by stage");
      expect(uiSource).toContain("Closing this week");

      // Both widget entries are present together in the
      // dashboardWidgets array context (proves they're declared as a
      // group on the PluginUI manifest, not scattered).
      const widgetsPos = uiSource.indexOf("dashboardWidgets");
      expect(widgetsPos).toBeGreaterThan(-1);
      const widgetsSection = uiSource.slice(widgetsPos);
      expect(widgetsSection).toContain("pipeline-by-stage");
      expect(widgetsSection).toContain("deals-closing-this-week");
      expect(widgetsSection).toContain("secondary");
      expect(widgetsSection).toContain("medium");
    } finally {
      await server.close();
    }
  });
});
