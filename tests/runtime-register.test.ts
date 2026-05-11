/**
 * task_22 U2.1 — runtime register integration test.
 *
 * Mirrors `tests/v2-builtin-modules.test.ts`'s shape but exercises
 * the *post-listen* registration path. We boot BoringOS with the
 * framework + memory modules only, then call
 * `app.registerModule(createCrmModule, app.factoryDeps!)` after
 * listen() has resolved. CRM is imported statically from
 * `@boringos-crm/server` (NOT from the .hebbsmod bundle — that's
 * the U2.2 demo script's job). What we test here is that the
 * `registerModule()` method itself wires the registries + the
 * install manager correctly.
 *
 * The script then:
 *  1. Inserts a tenant + runtime + agent.
 *  2. Installs CRM for that tenant via `installManager.install`.
 *  3. Signs a callback JWT, dispatches `crm.contacts.create`,
 *     asserts 200 + verified DB row.
 *  4. Calls `app.unregisterModule("crm")`, dispatches again,
 *     asserts 404.
 */
import { describe, it, expect } from "vitest";

describe("task_22 — runtime registerModule()", () => {
  it(
    "boots without CRM, registers it post-listen, installs + dispatches a tool, then unregisters",
    async () => {
      const { BoringOS, createFrameworkModule, createMemoryModule } = await import(
        "@boringos/core"
      );
      const { signCallbackToken } = await import("@boringos/agent");
      const { createCrmModule } = await import("@boringos-crm/server");
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { randomUUID } = await import("node:crypto");

      const dataDir = await mkdtemp(join(tmpdir(), "boringos-u2-reg-"));
      const jwtSecret = "u2-runtime-register-secret";
      const app = new BoringOS({
        // Pin a non-default Postgres port so we don't collide with
        // sibling phase tests using 5586 / 5592 / 5576 / 5436 / etc.
        database: { embedded: true, dataDir, port: 5588 },
        drive: { root: join(dataDir, "drive") },
        auth: { secret: jwtSecret },
        queue: { concurrency: 1 },
      });

      // Boot with just framework + memory. CRM is NOT registered up-front.
      app.module(createFrameworkModule);
      app.module(createMemoryModule);

      const server = await app.listen(0);
      try {
        const { tenants, agents, runtimes } = await import("@boringos/db");
        const { sql } = await import("drizzle-orm");
        const db = (server as unknown as { context: { db: import("@boringos/db").Db } })
          .context.db;

        // /health reflects the current registry state. Pre-register
        // there should be NO crm module.
        const healthPre = (await (await fetch(`${server.url}/health`)).json()) as {
          modules: Array<{ id: string }>;
        };
        expect(healthPre.modules.some((m) => m.id === "crm")).toBe(false);

        // ── Step 1: register CRM at runtime ─────────────────────
        const deps = app.factoryDeps;
        expect(deps).not.toBeNull();
        const regResult = await app.registerModule(createCrmModule, deps!);
        expect(regResult.moduleId).toBe("crm");
        expect(regResult.toolsAdded).toBeGreaterThan(0);
        expect(regResult.skillsAdded).toBeGreaterThanOrEqual(0);

        // /health now lists crm.
        const healthPost = (await (await fetch(`${server.url}/health`)).json()) as {
          modules: Array<{ id: string; tools: number }>;
        };
        const crmRow = healthPost.modules.find((m) => m.id === "crm");
        expect(crmRow).toBeDefined();
        expect(crmRow!.tools).toBeGreaterThan(0);

        // ── Step 2: insert tenant + runtime + agent ─────────────
        const tenantId = randomUUID();
        const runtimeId = randomUUID();
        const agentId = randomUUID();
        const runId = randomUUID();
        await db
          .insert(tenants)
          .values({ id: tenantId, name: "U2 Test", slug: `u2-${Date.now()}` })
          .onConflictDoNothing();
        await db.insert(runtimes).values({
          id: runtimeId,
          tenantId,
          name: "claude",
          type: "claude",
        });
        await db.insert(agents).values({
          id: agentId,
          tenantId,
          name: "U2 Test Agent",
          role: "general",
          runtimeId,
        });

        // ── Step 3: install CRM for the tenant ───────────────────
        const installRes = await fetch(
          `${server.url}/api/admin/modules/crm/install`,
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
        const installBody = (await installRes.json()) as {
          ok: boolean;
          hookError?: string;
        };
        expect(installBody.ok).toBe(true);

        // The schema migration should have created crm__contacts.
        const tableCheck = await db.execute(
          sql`SELECT to_regclass('public.crm__contacts') AS t`,
        );
        const tableRow = (
          Array.isArray(tableCheck)
            ? tableCheck[0]
            : (tableCheck as unknown as { rows: Array<{ t: string | null }> }).rows?.[0]
        ) as { t: string | null } | undefined;
        expect(tableRow?.t).not.toBeNull();

        // ── Step 4: dispatch crm.contacts.create ─────────────────
        const token = signCallbackToken({ runId, agentId, tenantId }, jwtSecret);
        const dispatchRes = await fetch(
          `${server.url}/api/tools/crm.contacts.create`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              firstName: "Ada",
              lastName: "Lovelace",
              email: "ada@example.com",
            }),
          },
        );
        expect(dispatchRes.status).toBe(200);
        const dispatchBody = (await dispatchRes.json()) as {
          ok: boolean;
          result: { data: { id: string; firstName: string } };
        };
        expect(dispatchBody.ok).toBe(true);
        expect(dispatchBody.result.data.firstName).toBe("Ada");

        // Confirm the DB row landed.
        const rowCheck = await db.execute(sql`
          SELECT id, first_name, email
            FROM crm__contacts
           WHERE id = ${dispatchBody.result.data.id}::uuid
             AND tenant_id = ${tenantId}::uuid
        `);
        const rows = Array.isArray(rowCheck)
          ? rowCheck
          : (rowCheck as unknown as { rows: unknown[] }).rows ?? [];
        expect(rows.length).toBe(1);

        // ── Step 5: unregister + dispatch should now 404 ────────
        const unregResult = await app.unregisterModule("crm");
        expect(unregResult.moduleId).toBe("crm");
        expect(unregResult.toolsRemoved).toBeGreaterThan(0);
        expect(unregResult.restartRecommended).toBe(true);

        const postUnreg = await fetch(
          `${server.url}/api/tools/crm.contacts.create`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              firstName: "Grace",
              lastName: "Hopper",
              email: "grace@example.com",
            }),
          },
        );
        // After unregister, the tool is gone → 404 from the dispatcher.
        expect(postUnreg.status).toBe(404);

        // /health no longer lists crm either.
        const healthFinal = (await (await fetch(`${server.url}/health`)).json()) as {
          modules: Array<{ id: string }>;
        };
        expect(healthFinal.modules.some((m) => m.id === "crm")).toBe(false);
      } finally {
        await server.close();
      }
    },
    120_000,
  );
});
