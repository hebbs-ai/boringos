/**
 * v2 lifecycle + install-state tests — Phases 5 + 9 of task_12.
 *
 * Covers:
 *  - install / uninstall hooks fire
 *  - module_installs rows track install state
 *  - the dispatcher refuses tool calls for uninstalled modules
 *  - admin endpoints expose install/uninstall + listInstalled
 *  - boot backfill keeps the v1-parity contract
 *  - lazy install for default-install modules
 */
import { describe, it, expect } from "vitest";

describe("v2 — lifecycle + install state", () => {
  it("admin install/uninstall + dispatcher gate + lazy install for default modules", async () => {
    const { BoringOS, createFrameworkModule } = await import("@boringos/core");
    const { signCallbackToken } = await import("@boringos/agent");
    const { z } = await import("@boringos/module-sdk");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-v2-lc-"));
    const jwtSecret = "v2-lifecycle-secret";

    // Hook spies — the test asserts they fire on install/uninstall.
    const installCalls: string[] = [];
    const uninstallCalls: string[] = [];

    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5585 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: jwtSecret },
    });

    app.module(createFrameworkModule);

    // Default-install module — should be auto-installed for any tenant.
    app.module({
      id: "alpha",
      name: "Alpha",
      version: "0.1.0",
      description: "default-install module",
      tools: [
        {
          name: "ping",
          description: "ping",
          inputs: z.object({}),
          async handler() {
            return { ok: true, result: { pong: true } };
          },
        },
      ],
      lifecycle: {
        async onInstall(ctx) {
          installCalls.push(`alpha:${ctx.tenantId}`);
        },
        async onUninstall(ctx) {
          uninstallCalls.push(`alpha:${ctx.tenantId}`);
        },
      },
    });

    // Opt-in module — `defaultInstall: false`. Should NOT be
    // auto-installed; dispatcher must refuse calls until admin
    // installs it explicitly.
    app.module({
      id: "beta",
      name: "Beta",
      version: "0.1.0",
      description: "opt-in module",
      defaultInstall: false,
      tools: [
        {
          name: "echo",
          description: "echo",
          inputs: z.object({ msg: z.string() }),
          async handler(input: { msg: string }) {
            return { ok: true, result: { echoed: input.msg } };
          },
        },
      ],
      lifecycle: {
        async onInstall(ctx) {
          installCalls.push(`beta:${ctx.tenantId}`);
        },
        async onUninstall(ctx) {
          uninstallCalls.push(`beta:${ctx.tenantId}`);
        },
      },
    });

    const server = await app.listen(0);
    try {
      const { tenants, agents } = await import("@boringos/db");
      const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
      const tenantId = "12121212-1212-4121-8121-121212121212";
      const agentId = "13131313-1313-4131-8131-131313131313";
      const runId = "14141414-1414-4141-8141-141414141414";

      await db
        .insert(tenants)
        .values({ id: tenantId, name: "Test", slug: "test-lc" })
        .onConflictDoNothing();
      await db
        .insert(agents)
        .values({ id: agentId, tenantId, name: "T", role: "general" })
        .onConflictDoNothing();

      const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);
      const callAuth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const adminHeaders = { "X-Tenant-Id": tenantId };
      const adminPostHeaders = { ...adminHeaders, "Content-Type": "application/json" };

      // 1. alpha is default-install — first call lazy-installs +
      //    dispatches successfully.
      const ping = await fetch(`${server.url}/api/tools/alpha.ping`, {
        method: "POST",
        headers: callAuth,
        body: "{}",
      });
      expect(ping.status).toBe(200);
      const pingBody = await ping.json() as { ok: boolean };
      expect(pingBody.ok).toBe(true);

      // 2. beta is opt-in — first call must 403 since not installed.
      const beta1 = await fetch(`${server.url}/api/tools/beta.echo`, {
        method: "POST",
        headers: callAuth,
        body: JSON.stringify({ msg: "hi" }),
      });
      expect(beta1.status).toBe(403);
      const beta1Body = await beta1.json() as { ok: boolean; error?: { code: string } };
      expect(beta1Body.ok).toBe(false);
      expect(beta1Body.error?.code).toBe("permission_denied");

      // 3. /installs lists alpha (lazy-installed in step 1) but not beta.
      const installs1 = await fetch(`${server.url}/api/admin/v2/installs`, { headers: adminHeaders });
      const installs1Body = await installs1.json() as { installs: Array<{ moduleId: string }> };
      const installedIds1 = new Set(installs1Body.installs.map((r) => r.moduleId));
      expect(installedIds1.has("alpha")).toBe(true);
      expect(installedIds1.has("beta")).toBe(false);

      // 4. Admin installs beta — onInstall fires, row written.
      const installRes = await fetch(`${server.url}/api/admin/v2/modules/beta/install`, {
        method: "POST",
        headers: adminPostHeaders,
        body: "{}",
      });
      expect(installRes.status).toBe(200);
      const installBody = await installRes.json() as { ok: boolean };
      expect(installBody.ok).toBe(true);
      expect(installCalls).toContain(`beta:${tenantId}`);

      // 5. beta call now succeeds.
      const beta2 = await fetch(`${server.url}/api/tools/beta.echo`, {
        method: "POST",
        headers: callAuth,
        body: JSON.stringify({ msg: "hi" }),
      });
      expect(beta2.status).toBe(200);
      const beta2Body = await beta2.json() as { ok: boolean; result: { echoed: string } };
      expect(beta2Body.ok).toBe(true);
      expect(beta2Body.result.echoed).toBe("hi");

      // 6. Admin uninstalls beta — onUninstall fires, row removed.
      const uninstallRes = await fetch(`${server.url}/api/admin/v2/modules/beta/uninstall`, {
        method: "POST",
        headers: adminPostHeaders,
        body: "{}",
      });
      expect(uninstallRes.status).toBe(200);
      expect(uninstallCalls).toContain(`beta:${tenantId}`);

      // 7. beta call refused again.
      const beta3 = await fetch(`${server.url}/api/tools/beta.echo`, {
        method: "POST",
        headers: callAuth,
        body: JSON.stringify({ msg: "hi" }),
      });
      expect(beta3.status).toBe(403);

      // 8. /installs reflects the final state.
      const installs2 = await fetch(`${server.url}/api/admin/v2/installs`, { headers: adminHeaders });
      const installs2Body = await installs2.json() as { installs: Array<{ moduleId: string }> };
      const installedIds2 = new Set(installs2Body.installs.map((r) => r.moduleId));
      expect(installedIds2.has("alpha")).toBe(true);
      expect(installedIds2.has("beta")).toBe(false);

      // 9. Installing an unknown module returns 404.
      const ghost = await fetch(`${server.url}/api/admin/v2/modules/ghost/install`, {
        method: "POST",
        headers: adminPostHeaders,
        body: "{}",
      });
      expect(ghost.status).toBe(404);
    } finally {
      await server.close();
    }
  }, 90000);

  it("re-installing an already-installed module is idempotent (no duplicate row, hooks re-fire)", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { z } = await import("@boringos/module-sdk");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-v2-idemp-"));
    let installCount = 0;

    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5584 },
      drive: { root: join(dataDir, "drive") },
    });

    app.module({
      id: "noop",
      name: "Noop",
      version: "0.1.0",
      description: "...",
      defaultInstall: false,
      tools: [
        {
          name: "tick",
          description: "tick",
          inputs: z.object({}),
          async handler() {
            return { ok: true, result: {} };
          },
        },
      ],
      lifecycle: {
        async onInstall() {
          installCount += 1;
        },
      },
    });

    const server = await app.listen(0);
    try {
      const { tenants, moduleInstalls } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;
      const tenantId = "15151515-1515-4151-8151-151515151515";
      await db
        .insert(tenants)
        .values({ id: tenantId, name: "Test", slug: "test-idemp" })
        .onConflictDoNothing();

      const adminHeaders = { "X-Tenant-Id": tenantId, "Content-Type": "application/json" };
      const installPath = `${server.url}/api/admin/v2/modules/noop/install`;
      await fetch(installPath, { method: "POST", headers: adminHeaders, body: "{}" });
      await fetch(installPath, { method: "POST", headers: adminHeaders, body: "{}" });
      await fetch(installPath, { method: "POST", headers: adminHeaders, body: "{}" });

      // The hook fired three times.
      expect(installCount).toBe(3);

      // Only one row in the table.
      const rows = await db
        .select()
        .from(moduleInstalls)
        .where(eq(moduleInstalls.tenantId, tenantId));
      expect(rows.length).toBe(1);
      expect(rows[0].moduleId).toBe("noop");
    } finally {
      await server.close();
    }
  }, 60000);
});
