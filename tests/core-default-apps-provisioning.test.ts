/**
 * K9 — provisionDefaultApps: framework's onTenantCreated hook installs
 * the catalog. Failures don't block signup; an activity_log entry is
 * written per failure. Already-installed apps are not re-installed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { Hono } from "hono";

import { provisionDefaultApps } from "@boringos/core";
import {
  createAppRouteRegistry,
  type DefaultAppEntry,
} from "@boringos/control-plane";
import { defineApp, type AppManifest } from "@boringos/app-sdk";
import { InstallRuntime } from "@boringos/shell/runtime/install-runtime.js";

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let bundleDir: string;

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-k9-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5592,
  });
  await createMigrationManager(conn.db).apply();

  bundleDir = mkdtempSync(join(tmpdir(), "bos-k9-bundle-"));
  mkdirSync(join(bundleDir, "schema"), { recursive: true });
  writeFileSync(
    join(bundleDir, "schema", "001_init.sql"),
    `CREATE TABLE IF NOT EXISTS k9_thing (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id UUID NOT NULL,
       label TEXT NOT NULL
     )`,
    "utf8",
  );
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

async function freshTenant(): Promise<string> {
  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug)
    VALUES ('Tenant', ${"k9-" + Math.random().toString(36).slice(2, 8)})
    RETURNING id
  `);
  return (inserted as any[])[0].id as string;
}

const triageManifest: AppManifest = {
  kind: "app",
  id: "generic-triage",
  version: "0.1.0",
  name: "Generic Inbox Triage",
  description: "Default triage app",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "BUSL-1.1",
  hosting: "in-process",
  schema: "schema",
  entityTypes: [],
  ui: { entry: "dist/ui.js" },
  capabilities: ["events:subscribe:inbox.item_created", "agents:register"],
};

const replierManifest: AppManifest = {
  kind: "app",
  id: "generic-replier",
  version: "0.1.0",
  name: "Generic Replier",
  description: "Default replier app",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "BUSL-1.1",
  hosting: "in-process",
  entityTypes: [],
  ui: { entry: "dist/ui.js" },
  capabilities: ["events:subscribe:inbox.item_created"],
};

function createCatalogEntry(id: string, manifest: AppManifest, bundleText: string = ""): DefaultAppEntry {
  const manifestText = JSON.stringify(manifest);
  const manifestHash = createHash("sha256")
    .update(manifestText)
    .update(" ")
    .update(bundleText)
    .digest("hex");
  return { id, manifest, bundleText, manifestHash };
}

function buildContext() {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const coreApp = new Hono();
  const routeRegistry = createAppRouteRegistry();
  routeRegistry.attachTo(coreApp);
  const shellRuntime = new InstallRuntime();
  return {
    coreApp,
    routeRegistry,
    shellRuntime,
    slotRuntime: {
      installApp: (a: any) => shellRuntime.installApp(a),
      uninstallApp: (id: string) => shellRuntime.uninstallApp(id),
    },
    events: { emit: (type: string, payload: Record<string, unknown>) => { events.push({ type, payload }); } },
    emitted: events,
  };
}

describe("provisionDefaultApps", () => {
  it("installs every catalog entry with active status", async () => {
    const tenantId = await freshTenant();
    const ctx = buildContext();

    const catalog = [
      { id: "generic-triage", manifest: triageManifest, bundleDir, definition: defineApp({ id: "generic-triage" }) },
      { id: "generic-replier", manifest: replierManifest, definition: defineApp({ id: "generic-replier" }) },
    ];

    const result = await provisionDefaultApps({
      db: conn.db,
      tenantId,
      catalog,
      routeRegistry: ctx.routeRegistry,
      slotRuntime: ctx.slotRuntime,
      events: ctx.events,
    });

    expect(result.allInstalled).toBe(true);

    const rows = (await conn.db.execute(sql`
      SELECT app_id, status FROM tenant_apps WHERE tenant_id = ${tenantId}
      ORDER BY app_id
    `)) as Array<{ app_id: string; status: string }>;
    expect(rows.map((r) => r.app_id)).toEqual(["generic-replier", "generic-triage"]);
    expect(rows.every((r) => r.status === "active")).toBe(true);
  });

  it("re-running with the same catalog skips already-installed apps (no churn)", async () => {
    const tenantId = await freshTenant();
    const ctx = buildContext();

    const catalog: DefaultAppEntry[] = [
      createCatalogEntry("generic-replier", replierManifest, "/* replier bundle */"),
    ];

    await provisionDefaultApps({
      db: conn.db,
      tenantId,
      catalog,
      routeRegistry: ctx.routeRegistry,
      slotRuntime: ctx.slotRuntime,
      events: ctx.events,
    });

    const beforeInstalledAt = (await conn.db.execute(sql`
      SELECT installed_at FROM tenant_apps
      WHERE tenant_id = ${tenantId} AND app_id = 'generic-replier'
    `)) as Array<{ installed_at: Date }>;

    // Sleep a moment to ensure "would re-install" timestamps would diverge.
    await new Promise((r) => setTimeout(r, 50));

    await provisionDefaultApps({
      db: conn.db,
      tenantId,
      catalog,
      routeRegistry: ctx.routeRegistry,
      slotRuntime: ctx.slotRuntime,
      events: ctx.events,
    });

    const afterInstalledAt = (await conn.db.execute(sql`
      SELECT installed_at FROM tenant_apps
      WHERE tenant_id = ${tenantId} AND app_id = 'generic-replier'
    `)) as Array<{ installed_at: Date }>;

    expect(new Date(afterInstalledAt[0]!.installed_at).getTime()).toBe(
      new Date(beforeInstalledAt[0]!.installed_at).getTime(),
    );
  });

  it("a failing default app does not block signup; logs an activity_log entry", async () => {
    const tenantId = await freshTenant();
    const ctx = buildContext();

    const goodApp = {
      id: "generic-replier",
      manifest: replierManifest,
      definition: defineApp({ id: "generic-replier" }),
    };
    // Bad: definition's onTenantCreated throws.
    const badApp = {
      id: "generic-triage",
      manifest: triageManifest,
      bundleDir,
      definition: defineApp({
        id: "generic-triage",
        onTenantCreated: async () => {
          throw new Error("seed failed");
        },
      }),
    };

    const result = await provisionDefaultApps({
      db: conn.db,
      tenantId,
      catalog: [goodApp, badApp],
      routeRegistry: ctx.routeRegistry,
      slotRuntime: ctx.slotRuntime,
      events: ctx.events,
    });

    expect(result.allInstalled).toBe(false);
    const triageOutcome = result.outcomes.find((o) => o.appId === "generic-triage")!;
    expect(triageOutcome.installed).toBe(false);
    expect(triageOutcome.error?.message).toMatch(/seed failed/);

    // The good app still installed.
    const rows = (await conn.db.execute(sql`
      SELECT app_id, status FROM tenant_apps WHERE tenant_id = ${tenantId}
    `)) as Array<{ app_id: string; status: string }>;
    expect(rows.map((r) => r.app_id)).toEqual(["generic-replier"]);

    const activity = (await conn.db.execute(sql`
      SELECT action, metadata FROM activity_log
      WHERE tenant_id = ${tenantId} AND action = 'app.install_failed'
    `)) as Array<{ action: string; metadata: Record<string, unknown> }>;
    expect(activity).toHaveLength(1);
    expect(activity[0]?.metadata).toMatchObject({ appId: "generic-triage" });
  });
});
