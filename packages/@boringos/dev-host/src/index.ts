// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `@boringos/dev-host` — reusable headless harness that boots
// BoringOS with built-ins, registers a `.hebbsmod` (or a built
// module package), seeds a tenant, mints a callback JWT, and
// exposes a minimal `dispatch` helper to drive tools against the
// running host. Replaces the bespoke `scripts/try-runtime-install.mjs`
// — call sites in the framework + future `hebbs test` CLI consume
// this single function.
//
// MDK T4.1.

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve as resolvePath } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";

import {
  BoringOS,
  createFrameworkModule,
  createMemoryModule,
  createDriveModule,
  createInboxModule,
  createWorkflowModule,
  createCopilotModule,
  createSlackModule,
  createGoogleModule,
  createTriageModule,
  createInboxTriageModule,
  createInboxReplierModule,
} from "@boringos/core";
import { signCallbackToken } from "@boringos/agent";
import type { Db } from "@boringos/db";
import type {
  Module,
  ModuleFactory,
  ModuleFactoryDeps,
} from "@boringos/module-sdk";

// ── Public API ───────────────────────────────────────────────────────────

export interface DevHostOptions {
  /** Either a path to a `.hebbsmod` archive OR a directory with a
   * built `dist/index.mjs`. */
  modulePath: string;
  /** Required for AuthManager (post-#60). Random per-call by default. */
  encryptionKey?: string;
  /** Embedded Postgres port. Random per-call by default. Ignored when
   *  `databaseUrl` is set. */
  pgPort?: number;
  /**
   * Point the dev-host at an external Postgres (e.g. the Docker
   * Compose recipe in `recipes/docker/`). When set, the dev-host
   * skips spinning up the embedded Postgres entirely — handy for
   * persistence across restarts or when SysV shm limits are tight.
   *
   * Migrations still run automatically against the external DB on
   * boot. MDK T6.3.
   */
  databaseUrl?: string;
  /** Auth JWT secret. Random per-call by default. */
  jwtSecret?: string;
  /** Override the framework root used to host the bundle extract.
   * Defaults to the dev-host package's own root, which Node can
   * resolve `@boringos/*` from. */
  frameworkRoot?: string;
}

export interface DevHost {
  /** Base URL the embedded server is listening on. */
  url: string;
  /** Tenant id created during setup — pre-installed with the module. */
  tenantId: string;
  /** Callback JWT signed for the seeded agent — pass as
   *  `Authorization: Bearer ${token}` for tool dispatch. */
  callbackToken: string;
  /** The underlying Drizzle db handle, for direct row assertions. */
  db: Db;
  /** Manifest id pulled from the bundled module.json. */
  moduleId: string;
  /** Manifest version pulled from the bundled module.json. */
  moduleVersion: string;
  /** Dispatch a tool against the running host. Mirrors the HTTP
   *  contract: 200 on success, throws otherwise. */
  dispatch<T = unknown>(
    fullToolName: string,
    inputs: unknown,
  ): Promise<T>;
  /**
   * Drop the currently-registered module and re-import + re-register
   * from `modulePath`. Powers `hebbs dev` hot reload (MDK T6.2).
   *
   * For `.hebbsmod` archives, the archive is re-extracted into a fresh
   * sibling dir first. For directory paths, the entry file is
   * re-imported with a `?t=<now>` cache-buster — Node's ESM cache
   * otherwise serves the old module verbatim. `restartRecommended` from
   * `unregisterModule()` is surfaced for callers that want to log it
   * (the dev workflow accepts the closure-leak risk in exchange for
   * sub-second feedback).
   */
  reload(): Promise<ReloadResult>;
  /** Tear down the server, drop the extract dir, and remove the
   *  per-run dataDir. */
  close(): Promise<void>;
}

export interface ReloadResult {
  moduleId: string;
  /** Tools that vanished during the unregister pass. */
  toolsRemoved: number;
  /** Skills that vanished during the unregister pass. */
  skillsRemoved: number;
  /** Tools the re-registered module brought in. */
  toolsAdded: number;
  /** Skills the re-registered module brought in. */
  skillsAdded: number;
  /** Manifest version after reload — may differ if the author bumped
   *  it between edits. */
  moduleVersion: string;
  /** Wall-clock ms from `reload()` entry to re-register completion. */
  durationMs: number;
}

// ── Implementation ──────────────────────────────────────────────────────

/**
 * Boot a headless BoringOS with every built-in, register the module
 * at `opts.modulePath`, sign up a tenant, install the module for that
 * tenant, and return a {@link DevHost} for downstream assertions.
 *
 * Equivalent to `scripts/try-runtime-install.mjs` but reusable from
 * any test, CLI, or scaffolder.
 */
export async function createDevHost(opts: DevHostOptions): Promise<DevHost> {
  const encryptionKey =
    opts.encryptionKey ?? randomEncryptionKey();
  const pgPort = opts.pgPort ?? randomPort();
  const jwtSecret = opts.jwtSecret ?? randomUUID();
  const frameworkRoot = opts.frameworkRoot ?? defaultFrameworkRoot();

  process.env.BORINGOS_ENCRYPTION_KEY = encryptionKey;

  // Per-run scratch dirs.
  const dataDir = await mkdtemp(join(tmpdir(), "dev-host-data-"));
  const harnessRoot = await mkdtemp(join(frameworkRoot, ".dev-host-"));
  const extractDir = join(harnessRoot, "extract");
  await mkdir(extractDir, { recursive: true });

  // Wipe persistent module-store so a previous run doesn't rehydrate
  // and trip the precondition we're trying to set up.
  const moduleStorePath = join(frameworkRoot, ".data", "module-store");
  if (existsSync(moduleStorePath)) {
    await rm(moduleStorePath, { recursive: true, force: true });
  }

  // ── 1. Boot BoringOS with built-ins ──────────────────────────
  // T6.3: opt in to external Postgres (e.g. recipes/docker/) via
  // `databaseUrl`; otherwise the embedded Postgres path stays the
  // default for fast inner-loop iteration.
  const databaseConfig = opts.databaseUrl
    ? { url: opts.databaseUrl }
    : { embedded: true as const, port: pgPort, dataDir: join(dataDir, "pg") };
  const app = new BoringOS({
    database: databaseConfig,
    drive: { root: join(dataDir, "drive") },
    auth: { secret: jwtSecret },
    queue: { concurrency: 1 },
  });
  app.module(createFrameworkModule);
  app.module(createMemoryModule);
  app.module(createDriveModule);
  app.module(createInboxModule);
  app.module(createWorkflowModule);
  app.module(createCopilotModule);
  app.module(createSlackModule);
  app.module(createGoogleModule);
  app.module(createTriageModule);
  app.module(createInboxTriageModule);
  app.module(createInboxReplierModule);

  const server = await app.listen(0);

  // ── 2. Resolve module bundle + register factory ──────────────
  //
  // Wrapped in a closure so `reload()` can re-run the same path with
  // a fresh extract dir + cache-busted import.
  let bundleDir: string;
  const resolveAndImport = async (
    cacheBustToken: string | null,
  ): Promise<{
    factory: ModuleFactory;
    manifest: { id: string; version: string };
  }> => {
    if (opts.modulePath.endsWith(".hebbsmod")) {
      // Each reload extracts into a fresh sibling so we don't try to
      // overwrite the still-imported files (and so the cache-buster
      // URL distinguishes them on disk).
      const reExtractDir = join(
        harnessRoot,
        cacheBustToken ? `extract-${cacheBustToken}` : "extract",
      );
      await mkdir(reExtractDir, { recursive: true });
      const unzip = spawnSync("unzip", [
        "-q",
        "-o",
        opts.modulePath,
        "-d",
        reExtractDir,
      ]);
      if (unzip.status !== 0) {
        throw new Error(
          `dev-host: unzip failed (status=${unzip.status}): ${unzip.stderr?.toString() ?? "no stderr"}`,
        );
      }
      bundleDir = reExtractDir;
    } else {
      // Pre-built module package directory.
      bundleDir = opts.modulePath;
    }

    const manifest = JSON.parse(
      await readFile(join(bundleDir, "module.json"), "utf8"),
    ) as { id: string; version: string };

    const entryPath = join(bundleDir, "index.mjs");
    const entryUrl = cacheBustToken
      ? `${pathToFileURL(entryPath).href}?t=${cacheBustToken}`
      : pathToFileURL(entryPath).href;
    const bundleMod = (await import(entryUrl)) as Record<string, unknown>;
    const factory =
      (bundleMod.default as ModuleFactory | undefined) ??
      (bundleMod[
        `create${capitalize(manifest.id)}Module`
      ] as ModuleFactory | undefined);
    if (typeof factory !== "function") {
      throw new Error(
        `dev-host: bundle did not expose a ModuleFactory. Keys: ${Object.keys(bundleMod).join(", ")}`,
      );
    }
    return { factory, manifest };
  };

  const { factory, manifest } = await resolveAndImport(null);

  // ── 3. registerModule() ──────────────────────────────────────
  const deps = (app as unknown as { factoryDeps?: ModuleFactoryDeps })
    .factoryDeps;
  if (!deps) {
    throw new Error("dev-host: app.factoryDeps was null after listen()");
  }
  type RegisterFn = (
    f: ModuleFactory | Module,
    d: ModuleFactoryDeps,
  ) => Promise<{ moduleId: string; toolsAdded: number; skillsAdded: number }>;
  type UnregisterFn = (id: string) => Promise<{
    moduleId: string;
    toolsRemoved: number;
    skillsRemoved: number;
    restartRecommended: true;
  }>;
  const appReg = app as unknown as {
    registerModule: RegisterFn;
    unregisterModule: UnregisterFn;
  };
  await appReg.registerModule(factory, deps);

  // Tracks the latest manifest version so reload() can surface bumps
  // back to the caller without re-reading after the fact.
  let currentManifestVersion = manifest.version;

  // ── 5. Sign up a tenant ──────────────────────────────────────
  const signupRes = await fetch(`${server.url}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Dev Host",
      email: `dev-host-${Date.now()}@example.com`,
      password: "dev-host-pw",
      tenantName: "Dev Host Org",
    }),
  });
  if (signupRes.status !== 201) {
    throw new Error(
      `dev-host: /api/auth/signup failed status=${signupRes.status} body=${await signupRes.text()}`,
    );
  }
  const signup = (await signupRes.json()) as { token: string };
  const sessionToken = signup.token;

  const db = (
    server as unknown as { context: { db: Db } }
  ).context.db;
  const { tenants, agents, runtimes } = await import("@boringos/db");
  const { eq, and, isNull } = await import("drizzle-orm");

  const tenantRows = await db
    .select()
    .from(tenants)
    .limit(50);
  const tenant = tenantRows.find((t) => t.name === "Dev Host Org");
  if (!tenant) {
    throw new Error("dev-host: freshly-signed-up tenant not in DB");
  }

  // ── 6. Install module for tenant ─────────────────────────────
  const installRes = await fetch(
    `${server.url}/api/admin/modules/${manifest.id}/install`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-Tenant-Id": tenant.id,
        "Content-Type": "application/json",
      },
    },
  );
  if (installRes.status !== 200) {
    throw new Error(
      `dev-host: install returned ${installRes.status}: ${await installRes.text()}`,
    );
  }

  // ── 7. Provision an agent + mint a callback JWT ──────────────
  const rtRows = await db
    .select()
    .from(runtimes)
    .where(eq(runtimes.tenantId, tenant.id));
  const rt = rtRows[0];
  if (!rt) throw new Error("dev-host: no runtime seeded for tenant");

  const rootRows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.tenantId, tenant.id), isNull(agents.reportsTo)))
    .limit(1);
  const reportsTo = rootRows[0]?.id ?? null;

  const agentId = randomUUID();
  await db.insert(agents).values({
    id: agentId,
    tenantId: tenant.id,
    name: "Dev Host Agent",
    role: "general",
    runtimeId: rt.id,
    reportsTo,
  });
  const runId = randomUUID();
  const callbackToken = signCallbackToken(
    { runId, agentId, tenantId: tenant.id },
    jwtSecret,
  );

  // ── 8. Build the DevHost handle ──────────────────────────────
  return {
    url: server.url,
    tenantId: tenant.id,
    callbackToken,
    db,
    moduleId: manifest.id,
    // moduleVersion is exposed through a getter below so reload()
    // bumps land in the handle without re-construction.

    async dispatch<T>(fullToolName: string, inputs: unknown): Promise<T> {
      const r = await fetch(
        `${server.url}/api/tools/${fullToolName}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${callbackToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(inputs),
        },
      );
      const body = (await r.json()) as Record<string, unknown>;
      if (r.status !== 200) {
        throw new Error(
          `dev-host: ${fullToolName} returned ${r.status}: ${JSON.stringify(body)}`,
        );
      }
      return body as T;
    },

    async reload(): Promise<ReloadResult> {
      const t0 = Date.now();
      const unreg = await appReg.unregisterModule(manifest.id);
      const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { factory: nextFactory, manifest: nextManifest } =
        await resolveAndImport(cacheBust);
      const reg = await appReg.registerModule(nextFactory, deps);
      currentManifestVersion = nextManifest.version;
      return {
        moduleId: reg.moduleId,
        toolsRemoved: unreg.toolsRemoved,
        skillsRemoved: unreg.skillsRemoved,
        toolsAdded: reg.toolsAdded,
        skillsAdded: reg.skillsAdded,
        moduleVersion: nextManifest.version,
        durationMs: Date.now() - t0,
      };
    },

    get moduleVersion(): string {
      return currentManifestVersion;
    },

    async close(): Promise<void> {
      try {
        await server.close();
      } catch {
        /* best-effort */
      }
      await safeRm(extractDir);
      await safeRm(dataDir);
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function randomEncryptionKey(): string {
  return createHash("sha256")
    .update(randomUUID())
    .digest("hex");
}

function randomPort(): number {
  return 5400 + Math.floor(Math.random() * 200);
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

function defaultFrameworkRoot(): string {
  // dist/index.js → packages/@boringos/dev-host/dist → packages/@boringos/dev-host
  // → packages/@boringos → packages → <framework root>
  // The harness extract dir must live somewhere Node can resolve
  // `@boringos/*` from at import time, hence the framework root.
  const here = dirname(new URL(import.meta.url).pathname);
  return resolvePath(here, "..", "..", "..", "..");
}

async function safeRm(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
