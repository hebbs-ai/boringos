/**
 * v2 admin endpoints — Phase 10 of task_12.
 *
 * Confirms the read-only views over the v2 module + tool +
 * tool_calls registries.
 */
import { describe, it, expect } from "vitest";

describe("v2 — admin views", () => {
  it("GET /api/admin/modules + /tools + /tool-calls", async () => {
    const { BoringOS, createFrameworkModule, createMemoryModule } = await import("@boringos/core");
    const { signCallbackToken } = await import("@boringos/agent");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-v2-admin-"));
    const jwtSecret = "v2-admin-secret";
    // task_24 — isolate boot-time rehydration from the workspace's
    // shared module-store so unrelated .hebbsmod dirs don't appear.
    process.env.MODULES_STORE_DIR = join(dataDir, "module-store");
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5586 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: jwtSecret },
    });

    app.module(createFrameworkModule);
    app.module(createMemoryModule);

    const server = await app.listen(0);
    try {
      const { tenants, agents } = await import("@boringos/db");
      const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
      const tenantId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const agentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const runId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      await db
        .insert(tenants)
        .values({ id: tenantId, name: "Test", slug: "test-admin" })
        .onConflictDoNothing();
      await db
        .insert(agents)
        .values({ id: agentId, tenantId, name: "T", role: "general" })
        .onConflictDoNothing();
      const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);

      // Trigger a couple of audit rows.
      const callAuth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      await fetch(`${server.url}/api/tools/framework.tasks.create`, {
        method: "POST",
        headers: callAuth,
        body: JSON.stringify({ title: "Audit test 1" }),
      });
      await fetch(`${server.url}/api/tools/framework.tasks.create`, {
        method: "POST",
        headers: callAuth,
        body: JSON.stringify({ title: "Audit test 2" }),
      });

      const adminHeaders = { "X-Tenant-Id": tenantId };

      // /modules — lists framework + memory.
      const modulesRes = await fetch(`${server.url}/api/admin/modules`, { headers: adminHeaders });
      expect(modulesRes.status).toBe(200);
      const modulesBody = await modulesRes.json() as {
        modules: Array<{ id: string; tools: unknown[]; skills: unknown[] }>;
      };
      const ids = modulesBody.modules.map((m) => m.id).sort();
      expect(ids).toEqual(["framework", "memory"]);
      const fw = modulesBody.modules.find((m) => m.id === "framework")!;
      expect(fw.tools.length).toBeGreaterThanOrEqual(9);
      expect(fw.skills.length).toBeGreaterThanOrEqual(3);

      // /tools — flat list across all modules.
      const toolsRes = await fetch(`${server.url}/api/admin/tools`, { headers: adminHeaders });
      const toolsBody = await toolsRes.json() as {
        tools: Array<{ fullName: string; inputSchema?: { type?: string; properties?: Record<string, unknown> } | null }>;
      };
      expect(toolsBody.tools.some((t) => t.fullName === "framework.tasks.create")).toBe(true);
      expect(toolsBody.tools.some((t) => t.fullName === "memory.remember")).toBe(true);

      // inputSchema — Zod inputs converted to JSON Schema so the
      // workflow editor can render a typed per-field form.
      const createTask = toolsBody.tools.find((t) => t.fullName === "framework.tasks.create");
      expect(createTask?.inputSchema?.type).toBe("object");
      expect(createTask?.inputSchema?.properties).toBeTruthy();
      expect(Object.keys(createTask!.inputSchema!.properties!)).toContain("title");

      // /tool-calls — audit log for the tenant.
      const callsRes = await fetch(`${server.url}/api/admin/tool-calls`, { headers: adminHeaders });
      const callsBody = await callsRes.json() as {
        toolCalls: Array<{ toolName: string; status: string }>;
      };
      expect(callsBody.toolCalls.length).toBeGreaterThanOrEqual(2);
      expect(callsBody.toolCalls.every((c) => c.toolName === "framework.tasks.create")).toBe(true);
      expect(callsBody.toolCalls.every((c) => c.status === "ok")).toBe(true);

      // Filter by tool.
      const filteredRes = await fetch(
        `${server.url}/api/admin/tool-calls?tool=framework.tasks.create`,
        { headers: adminHeaders },
      );
      const filteredBody = await filteredRes.json() as { toolCalls: unknown[] };
      expect(filteredBody.toolCalls.length).toBeGreaterThanOrEqual(2);

      // Missing tenant id → 401.
      const noTenantRes = await fetch(`${server.url}/api/admin/tool-calls`);
      expect(noTenantRes.status).toBe(401);

      // /installs reflects the lazy-installed default modules.
      const installsRes = await fetch(`${server.url}/api/admin/installs`, {
        headers: adminHeaders,
      });
      expect(installsRes.status).toBe(200);
      const installsBody = await installsRes.json() as {
        installs: Array<{ moduleId: string; version: string }>;
      };
      const installedIds = new Set(installsBody.installs.map((r) => r.moduleId));
      // Both registered modules are default-install — the first
      // tool call lazy-installs framework, but memory needs an
      // explicit GET on /installs to not show... actually GET
      // /installs only returns existing rows. Memory wasn't
      // called, so it isn't installed yet. That's correct
      // behavior — the dispatcher's lazy install only fires on
      // dispatch.
      expect(installedIds.has("framework")).toBe(true);
    } finally {
      await server.close();
    }
  }, 90000);
});
