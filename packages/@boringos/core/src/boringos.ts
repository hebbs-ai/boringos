import { generateId } from "@boringos/shared";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { nullMemory } from "@boringos/memory";
import type { MemoryProvider } from "@boringos/memory";
import {
  createRuntimeRegistry,
  claudeRuntime,
  chatgptRuntime,
  geminiRuntime,
  ollamaRuntime,
  commandRuntime,
  webhookRuntime,
  piRuntime,
} from "@boringos/runtime";
import type { RuntimeModule, RuntimeRegistry } from "@boringos/runtime";
import { createLocalStorage, scaffoldDrive } from "@boringos/drive";
import type { StorageBackend } from "@boringos/drive";
import { createDatabase, createMigrationManager, workflows as workflowsSchema } from "@boringos/db";
import type { Db, DatabaseConnection } from "@boringos/db";
import { and, eq, eq as eqOp } from "drizzle-orm";
import { createAgentEngine, ContextPipeline } from "@boringos/agent";
import type { AgentEngine, ContextProvider, AgentRunJob } from "@boringos/agent";
import type { QueueAdapter } from "@boringos/pipeline";
import { createInProcessQueue } from "@boringos/pipeline";
// Workflows execute through the workflow.run tool dispatcher (run-workflow.ts).
import { createEventBus } from "./event-bus.js";
import type {
  BoringOSConfig,
  AppContext,
  ConnectorDefinition,
  PersonaBundle,
  PluginManifest,
  LifecycleHook,
  StartedServer,
} from "./types.js";
import { runWorkflow } from "./run-workflow.js";
import { createToolRoutes } from "./tool-routes.js";
import { createModuleAdminRoutes } from "./module-admin-routes.js";
import { createModulePackageRoutes } from "./module-package-routes.js";
import { createModuleUiRoutes } from "./module-ui-routes.js";
import {
  createToolRegistry,
  createSkillRegistry,
  createModuleRegistry,
  createSkillsProvider,
  createToolCatalogProvider,
  createInstallManager,
  createSettingRegistry,
} from "@boringos/agent";
import type {
  ToolRegistry,
  SkillRegistry,
  ModuleRegistry,
  InstallManager,
  SettingRegistry,
} from "@boringos/agent";
import type { Module, ModuleFactory, ModuleFactoryDeps } from "@boringos/module-sdk";
import { createConnectorRoutes } from "./connector-routes.js";
import { createAdminRoutes } from "./admin-routes.js";
import { createRealtimeBus } from "./realtime.js";
import type { RealtimeBus } from "./realtime.js";
import { createSSERoutes } from "./sse-routes.js";
import { bootstrapAuthTables } from "./auth.js";
import { createAuthRoutes } from "./auth-routes.js";
import { createDeviceAuthRoutes } from "./device-auth-routes.js";
import { createRoutineScheduler } from "./scheduler.js";
import { createInboxSnoozeTicker } from "./inbox-snooze-ticker.js";
import { createInboxGmailReverseSyncTicker } from "./inbox-gmail-reverse-sync.js";
import { createInboxGmailForwardSyncTicker } from "./inbox-gmail-forward-sync.js";
import { createPluginRegistry } from "./plugin-system.js";
import type { PluginDefinition } from "./plugin-system.js";
import { createPluginWebhookRoutes, createPluginAdminRoutes } from "./plugin-routes.js";
import { githubPlugin } from "./plugins/github.js";
import { AuthManager } from "./auth-manager.js";
import { tenantContext, requireTenantId } from "./tenant-context.js";
import { googleConnector } from "@boringos/connector-google";
import { slackConnector } from "@boringos/connector-slack";
import { randomBytes } from "node:crypto";

export class BoringOS {
  private config: BoringOSConfig;
  private memoryProvider: MemoryProvider = nullMemory;
  private extraRuntimes: RuntimeModule[] = [];
  private contextProviders: ContextProvider[] = [];
  private personas: Map<string, PersonaBundle> = new Map();
  private plugins: PluginManifest[] = [];
  private pluginDefs: PluginDefinition[] = [];
  private beforeStartHooks: LifecycleHook[] = [];
  private afterStartHooks: LifecycleHook[] = [];
  private beforeShutdownHooks: LifecycleHook[] = [];
  private extraRoutes: Array<{ path: string; app: Hono; agentDocs?: string | ((callbackUrl: string) => string) }> = [];
  private queueAdapter: QueueAdapter<AgentRunJob> | undefined;
  private userSchemaStatements: string[] = [];
  private inboxRoutes: Array<{ filter: (event: Record<string, unknown>) => boolean; transform: (event: Record<string, unknown>) => { source: string; subject: string; body?: string; from?: string; assigneeUserId?: string } }> = [];
  private tenantProvisionedHook: ((db: Db, tenantId: string) => Promise<void>) | undefined;
  private eventHandlers: Array<{ type: string | null; handler: (event: import("./event-bus.js").ConnectorEvent) => void | Promise<void> }> = [];
  // Modules registered via `app.module(myModule)`.
  //
  // Two registration shapes:
  //   - inline `Module` — the manifest is plain data (typical for
  //     connector / capability modules built without DB access)
  //   - `ModuleFactory` — a function that receives framework
  //     services after boot and returns a `Module`. Used by
  //     built-ins (framework / memory / inbox / copilot / etc.)
  //     and by hybrid modules that own their own schema.
  private moduleEntries: Array<Module | ModuleFactory> = [];

  // ── Runtime wiring (populated in listen()) ────────────────────────
  // The boot loop builds the registries, install manager and factory
  // deps; we capture them here so post-listen `registerModule` /
  // `unregisterModule` calls can reuse them without the caller
  // re-supplying deps. This is what `.hebbsmod` upload (task_22) needs.
  private moduleRegistry: ModuleRegistry | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private skillRegistry: SkillRegistry | null = null;
  private settingRegistry: SettingRegistry | null = null;
  private installManagerRef: InstallManager | null = null;
  // Mutated by registerModule(). Shared by reference with the
  // install-manager (which reads `deps.modules` lazily) and the
  // module-admin routes closure.
  private boundModules: Module[] = [];
  // The same factory-deps holder the boot loop builds. Mutable by
  // design — the engine + buses populate fields post-construct
  // (see comments in listen()).
  private moduleFactoryDeps: ModuleFactoryDeps | null = null;
  // The root Hono app — kept so post-listen registers can mount
  // module webhooks (when wired in U3).
  private honoApp: Hono | null = null;

  constructor(config: BoringOSConfig = {}) {
    this.config = config;
  }

  /**
   * Internal accessor for tests + task_22 demo scripts. Exposes the
   * mutable factory-deps holder so `registerModule()` callers (the
   * forthcoming upload route, the U2 PoC) can pass the same `deps`
   * the boot loop used. Returns `null` before `listen()` runs.
   */
  get factoryDeps(): ModuleFactoryDeps | null {
    return this.moduleFactoryDeps;
  }

  memory(provider: MemoryProvider): this {
    this.memoryProvider = provider;
    return this;
  }

  runtime(module: RuntimeModule): this {
    this.extraRuntimes.push(module);
    return this;
  }

  contextProvider(provider: ContextProvider): this {
    this.contextProviders.push(provider);
    return this;
  }

  persona(role: string, bundle: PersonaBundle): this {
    this.personas.set(role, bundle);
    return this;
  }

  plugin(manifest: PluginManifest | PluginDefinition): this {
    if ("jobs" in manifest || "webhooks" in manifest) {
      this.pluginDefs.push(manifest as PluginDefinition);
    } else {
      this.plugins.push(manifest as PluginManifest);
    }
    return this;
  }

  queue(adapter: QueueAdapter<AgentRunJob>): this {
    this.queueAdapter = adapter;
    return this;
  }

  schema(ddlStatements: string | string[]): this {
    const stmts = Array.isArray(ddlStatements) ? ddlStatements : [ddlStatements];
    this.userSchemaStatements.push(...stmts);
    return this;
  }

  routeToInbox(config: { filter: (event: Record<string, unknown>) => boolean; transform: (event: Record<string, unknown>) => { source: string; subject: string; body?: string; from?: string; assigneeUserId?: string } }): this {
    this.inboxRoutes.push(config);
    return this;
  }

  onEvent(type: string | null, handler: (event: import("./event-bus.js").ConnectorEvent) => void | Promise<void>): this {
    this.eventHandlers.push({ type, handler });
    return this;
  }

  onTenantCreated(fn: (db: Db, tenantId: string) => Promise<void>): this {
    this.tenantProvisionedHook = fn;
    return this;
  }

  beforeStart(fn: LifecycleHook): this {
    this.beforeStartHooks.push(fn);
    return this;
  }

  afterStart(fn: LifecycleHook): this {
    this.afterStartHooks.push(fn);
    return this;
  }

  beforeShutdown(fn: LifecycleHook): this {
    this.beforeShutdownHooks.push(fn);
    return this;
  }

  /**
   * Mount a Hono sub-app at `path`.
   *
   * Pass `options.agentDocs` to teach agents how to call the endpoints under
   * this mount. The framework concatenates all registered agentDocs and
   * injects them into every agent run's system prompt via the built-in
   * api-catalog context provider — no per-app context provider needed.
   *
   * The docs string is markdown and may reference `$BORINGOS_TENANT_ID` and
   * `$BORINGOS_CALLBACK_TOKEN` (injected as env vars in the agent subprocess)
   * along with the callback URL, which the provider substitutes at build time.
   */
  route(path: string, app: Hono, options?: { agentDocs?: string | ((callbackUrl: string) => string) }): this {
    this.extraRoutes.push({ path, app, agentDocs: options?.agentDocs });
    return this;
  }

  /**
   * Register a Module (Skills + Tools + Modules architecture).
   *
   * Every component — connectors, apps, plugins, built-in subsystems —
   * implements the `Module` interface from `@boringos/module-sdk`. The
   * framework collects them, walks their tools into the tool registry,
   * walks their skills into the skill registry, runs migrations +
   * lifecycle hooks per tenant install, and exposes
   * `POST /api/tools/<module-id>.<tool-name>` for dispatch.
   */
  module(mod: Module | ModuleFactory): this {
    this.moduleEntries.push(mod);
    return this;
  }

  /**
   * Wire a single Module into the running registries. Used by the
   * boot loop and (post-`listen()`) by the `.hebbsmod` upload route +
   * the task_22 / U2 demo script.
   *
   * Behaviour matches the inline loop the boot path used previously:
   *  - Resolve `ModuleFactory` against `factoryDeps`
   *  - `moduleRegistry.register` (which also walks tools + skills
   *    into their per-domain registries)
   *  - register every contributed setting
   *  - push onto the shared `boundModules` array — the install
   *    manager + admin routes read from this array lazily, so
   *    post-listen additions are picked up automatically
   *  - kick off `installManager.backfill([mod])` for default-install
   *    modules so brand-new uploads become available for every
   *    existing tenant without a host restart (fire-and-forget;
   *    matches boot semantics)
   *
   * Webhooks: a permanent dispatcher is mounted at boot at
   * `/api/webhooks/:moduleId/:event` (see `listen()`). The dispatcher
   * looks up the module in the shared `boundModules` array per-request,
   * so adding/removing modules at runtime takes effect immediately
   * without re-mounting routes. We went with the boot-time dispatcher
   * because Hono *does* technically accept post-listen `app.route()`
   * calls (verified — see tests/runtime-webhook.test.ts) but has no
   * symmetric un-mount API, so `unregisterModule` would leak stale
   * routes otherwise.
   *
   * Routines: `Routine[]` from a Module is metadata; the scheduler
   * reads `routines` from the DB, not from module manifests. Seeding
   * the DB happens via `installManager.install`'s seeding path.
   * Conversely, `unregisterModule` does NOT stop in-flight routines —
   * they're per-tenant DB rows torn down by `installManager.uninstall`.
   */
  async registerModule(
    mod: Module | ModuleFactory,
    factoryDeps?: ModuleFactoryDeps,
  ): Promise<{ moduleId: string; toolsAdded: number; skillsAdded: number }> {
    if (!this.moduleRegistry || !this.toolRegistry || !this.skillRegistry || !this.settingRegistry) {
      throw new Error(
        "registerModule() called before listen(). Call app.module(...) " +
          "for boot-time registration, or wait until after listen() resolves " +
          "for runtime registration.",
      );
    }
    const deps = factoryDeps ?? this.moduleFactoryDeps;
    if (!deps) {
      throw new Error(
        "registerModule() requires factoryDeps. Pass them explicitly or " +
          "call after listen() so the framework can use the captured deps.",
      );
    }

    // Track the active moduleEntries list so a subsequent `listen()`
    // call (or a snapshot from outside) reflects the runtime registration.
    if (!this.moduleEntries.includes(mod)) {
      this.moduleEntries.push(mod);
    }

    const resolved: Module = typeof mod === "function" ? mod(deps) : mod;
    const beforeTools = this.toolRegistry.list().length;
    const beforeSkills = this.skillRegistry.list().length;

    this.moduleRegistry.register(resolved);
    for (const def of resolved.settings ?? []) {
      this.settingRegistry.register("module", resolved.id, def);
    }
    this.boundModules.push(resolved);

    // Default-install backfill — only meaningful after the
    // install-manager exists (i.e. post-listen). At boot time the
    // manager isn't built yet; the existing boot path runs a single
    // backfill across all modules after the loop.
    if (this.installManagerRef && resolved.defaultInstall !== false) {
      void this.installManagerRef
        .backfill([resolved])
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.error(
            `[boringos] backfill failed for newly-registered module ${resolved.id}:`,
            e,
          );
        });
    }

    return {
      moduleId: resolved.id,
      toolsAdded: this.toolRegistry.list().length - beforeTools,
      skillsAdded: this.skillRegistry.list().length - beforeSkills,
    };
  }

  /**
   * Inverse of `registerModule()`. Drops every tool/skill/setting/
   * webhook the module pushed and removes it from the registry. Does
   * NOT touch per-tenant install rows — callers should uninstall the
   * module for every affected tenant first if they want the data gone
   * (the host-level cascade here only clears the in-memory registries;
   * DB tables created by `installManager.install`'s schema migrations
   * stay put until `installManager.uninstall` is called per-tenant).
   *
   * Cascade order (intentional — settings before module so the owner
   * lookup still sees the module's id):
   *
   *   1. settingRegistry.unregisterOwner("module", id)
   *   2. moduleRegistry.unregister(id)
   *        → tools.unregisterModule(id)
   *        → skills.unregisterModule(id)
   *        → deletes Module from internal map
   *   3. Splice from boundModules (shared by reference with
   *      install-manager + admin routes — they go to "not found"
   *      on next call)
   *   4. Splice from moduleEntries (so a re-listen() doesn't
   *      resurrect the dropped module)
   *
   * Webhooks: the boot-time `/api/webhooks/:moduleId/:event`
   * dispatcher resolves the module from `boundModules` on every
   * request. Removing the entry in step 3 makes future webhook hits
   * return 404 automatically — nothing to unmount.
   *
   * The `restartRecommended: true` is a hint to operators that
   * Node's ESM module cache still holds references to the dropped
   * module's code (we can't unload imports). A fresh process avoids
   * any chance of zombie behaviour from closures the GC can't reach.
   */
  async unregisterModule(id: string): Promise<{
    moduleId: string;
    toolsRemoved: number;
    skillsRemoved: number;
    restartRecommended: true;
  }> {
    if (!this.moduleRegistry || !this.toolRegistry || !this.skillRegistry || !this.settingRegistry) {
      throw new Error("unregisterModule() called before listen().");
    }
    const beforeTools = this.toolRegistry.list().length;
    const beforeSkills = this.skillRegistry.list().length;

    // 1. Drop every setting this module contributed.
    this.settingRegistry.unregisterOwner("module", id);
    // 2. moduleRegistry.unregister walks tools + skills (which
    //    have unregisterModule(moduleId) methods that scan + splice).
    this.moduleRegistry.unregister(id);
    // 3. boundModules array (shared by reference with install-manager
    //    and admin routes) — strip the entry. Install-manager's lazy
    //    `getModule()` will now miss this id; the webhook dispatcher
    //    likewise won't find it.
    for (let i = this.boundModules.length - 1; i >= 0; i -= 1) {
      if (this.boundModules[i].id === id) this.boundModules.splice(i, 1);
    }
    // 4. moduleEntries — so a subsequent listen() (test reset path)
    //    doesn't re-register the dropped module.
    for (let i = this.moduleEntries.length - 1; i >= 0; i -= 1) {
      const entry = this.moduleEntries[i];
      const candidateId =
        typeof entry === "function" ? undefined : entry.id;
      if (candidateId === id) this.moduleEntries.splice(i, 1);
    }

    return {
      moduleId: id,
      toolsRemoved: beforeTools - this.toolRegistry.list().length,
      skillsRemoved: beforeSkills - this.skillRegistry.list().length,
      restartRecommended: true,
    };
  }

  async listen(port?: number): Promise<StartedServer> {
    const listenPort = port ?? 3000;

    // 1. Boot database
    const dbConfig: import("@boringos/db").DatabaseConfig = (() => {
      if (this.config.database) return this.config.database;
      const flag = process.env.PG_EMBEDDED;
      if (flag === "true") return { embedded: true as const };
      if (flag === "false") {
        if (!process.env.DATABASE_URL)
          throw new Error("PG_EMBEDDED=false requires DATABASE_URL to be set.");
        return { url: process.env.DATABASE_URL };
      }
      if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL };
      return { embedded: true as const };
    })();
    const dbConn = await createDatabase(dbConfig);

    // 2. Run migrations
    const migrator = createMigrationManager(dbConn.db);
    await migrator.apply();

    // 2b. Bootstrap auth tables
    await bootstrapAuthTables(dbConn.db);

    // 2c. Apply user schema DDL
    if (this.userSchemaStatements.length > 0) {
      const { sql: rawSql } = await import("drizzle-orm");
      for (const stmt of this.userSchemaStatements) {
        await dbConn.db.execute(rawSql.raw(stmt));
      }
    }

    // 3. Initialize drive
    const driveRoot = this.config.drive?.root ?? "./.data/drive";
    const drive = this.config.drive?.backend ?? createLocalStorage({ root: driveRoot });

    // task_24 — Drive-backed memory is the default when no external
    // memory provider was wired via app.memory(...). Installs without
    // Hebbs (or any other backend) are no longer amnesiac: every
    // tenant gets a file-based memory under their Drive namespace,
    // routed by wake-owner (user vs tenant scope). External
    // providers continue to take precedence if explicitly set.
    if (this.memoryProvider === nullMemory) {
      const { createDriveMemory } = await import("@boringos/memory");
      this.memoryProvider = createDriveMemory({ drive });
    }

    // 4. Build runtime registry
    const runtimes = createRuntimeRegistry();
    for (const rt of [claudeRuntime, chatgptRuntime, geminiRuntime, ollamaRuntime, commandRuntime, webhookRuntime, piRuntime]) {
      runtimes.register(rt);
    }
    for (const rt of this.extraRuntimes) {
      runtimes.register(rt);
    }

    // 5. Build Skills + Tools + Modules registries (always
    //    constructed; only populated + mounted when modules
    //    exist). Doing this before the pipeline build means the
    //    Module providers feed into the context pipeline.
    const toolRegistry: ToolRegistry = createToolRegistry();
    const skillRegistry: SkillRegistry = createSkillRegistry();
    const moduleRegistry: ModuleRegistry = createModuleRegistry({
      tools: toolRegistry,
      skills: skillRegistry,
    });
    // Tenant settings registry — aggregates SettingDefinition entries
    // from every registered module + the framework's own well-known
    // keys. Exposed via GET /api/admin/settings/manifest so the shell
    // can auto-render Settings → General. See task_17.
    const settingRegistry: SettingRegistry = createSettingRegistry();
    // Built-in framework settings — keys the host writes/reads itself.
    settingRegistry.register("framework", "framework", {
      key: "agents_paused",
      label: "Pause all agents",
      description:
        "When on, every agent run is short-circuited as 'skipped' without spending budget. Wake events still fire and tasks still queue; flipping back to off auto-rewakes anything pending.",
      type: "boolean",
      default: false,
    });
    // ── AuthManager (Connector SDK v2) ──────────────────────────────────
    // One AuthManager per BoringOS instance. Built-in connectors are
    // registered here at boot. Third-party connectors will register via
    // the install pipeline in a future task.
    //
    // The public URL is used as the base for OAuth redirect URIs.
    // Fall back to localhost:<port> when no explicit base is configured.
    const authManagerSecret =
      this.config.auth?.secret ?? randomBytes(32).toString("hex");
    const publicBase = `http://localhost:${listenPort}`;
    const authManager = new AuthManager(
      dbConn.db,
      authManagerSecret,
      (provider: string) => `${publicBase}/oauth/${provider}/callback`,
    );
    authManager.registerConnector(googleConnector);
    authManager.registerConnector(slackConnector);

    // ModuleFactory functions are resolved here, after the DB +
    // drive are available (memory provider, agent + workflow
    // engines are wired in by reference later — built-ins that
    // need them close over the deps object). The factory pattern
    // lets built-ins access framework services without leaking
    // those types into the SDK's Module shape.
    //
    // getConnectorToken / listConnectedAccounts / checkScopes thread
    // the tenantId through AsyncLocalStorage (see tenant-context.ts).
    // The tool dispatcher (tool-routes.ts) sets the store before every
    // dispatch call; these closures read it. Calling outside a
    // dispatched tool handler throws with a descriptive error.
    const factoryDeps: ModuleFactoryDeps = {
      db: dbConn.db,
      memory: this.memoryProvider,
      drive,
      // engine + workflowEngine + eventBus are populated later in
      // this method; built-ins that need them read from the deps
      // object at call time, not at factory time.
      engine: undefined as unknown,
      workflowEngine: undefined as unknown,
      toolRegistry: toolRegistry,
      realtimeBus: undefined as unknown,
      eventBus: undefined as unknown,
      getConnectorToken: (provider, callerModuleId, opts) => {
        const tenantId = requireTenantId();
        return authManager.getToken(provider, tenantId, callerModuleId, opts);
      },
      listConnectedAccounts: (provider) => {
        const tenantId = requireTenantId();
        return authManager.listAccounts(provider, tenantId);
      },
      checkScopes: (provider, scopes, opts) => {
        const tenantId = requireTenantId();
        // callerModuleId is not in the public signature; use "unknown" for audit.
        // TODO: thread callerModuleId via opts in a follow-up.
        return authManager.checkScopes(provider, tenantId, "unknown", scopes, opts);
      },
    };
    const boundModules: Module[] = [];

    // Stash everything `registerModule()` needs on `this` so the same
    // method handles boot wiring AND post-listen runtime registration
    // (task_22 / U2.1). The install manager is wired later in this
    // method; until that happens, registerModule() short-circuits the
    // install-manager calls.
    this.moduleRegistry = moduleRegistry;
    this.toolRegistry = toolRegistry;
    this.skillRegistry = skillRegistry;
    this.settingRegistry = settingRegistry;
    this.boundModules = boundModules;
    this.moduleFactoryDeps = factoryDeps;

    for (const entry of this.moduleEntries) {
      await this.registerModule(entry, factoryDeps);
    }
    const hasModules = boundModules.length > 0;

    // Construct the install manager early so the new-tenant hook
    // can fire onTenantCreate during signup. Backfill of existing
    // tenants happens later (fire-and-forget) once routes mount.
    // realtimeBusRef is assigned later in the boot sequence (line ~745).
    // Pass a closure-bound proxy so install/uninstall events emitted
    // from this manager land on the bus as soon as it exists.
    const installManagerEarly: InstallManager | undefined = hasModules
      ? createInstallManager({
          db: dbConn.db,
          // Pass the shared `boundModules` array by reference so
          // post-listen `registerModule()` additions show up in the
          // install manager too. The manager's internal `getModule`
          // helper resolves from this array on every call.
          modules: boundModules,
          realtimeBus: {
            publish: (event) => realtimeBusRef?.publish(event as Parameters<NonNullable<typeof realtimeBusRef>["publish"]>[0]),
          },
        })
      : undefined;
    // Expose the install manager to post-listen `registerModule()`
    // callers (the task_22 upload route + the U2 demo script) so a
    // newly-registered defaultInstall module gets its install rows
    // backfilled without a host restart.
    this.installManagerRef = installManagerEarly ?? null;

    // 6. Build context pipeline
    const pipeline = new ContextPipeline();
    for (const provider of this.contextProviders) {
      pipeline.add(provider);
    }

    // Module-driven prompt sections (## Skills + ## Available tools).
    if (hasModules) {
      pipeline.add(createSkillsProvider({ registry: skillRegistry }));
      pipeline.add(createToolCatalogProvider({ registry: toolRegistry }));
    }

    // 6. Create agent engine
    const jwtSecret = this.config.auth?.secret ?? "boringos-dev-secret";
    const callbackUrl = `http://localhost:${listenPort}`;

    // If the app didn't register a queue adapter, spin up the default
    // in-process one here so we can honor `config.queue.concurrency`. The
    // engine's own fallback doesn't know about app config.
    const resolvedQueue =
      this.queueAdapter ??
      createInProcessQueue<AgentRunJob>({ concurrency: this.config.queue?.concurrency });

    // Connector registry: kept for OAuth + webhook dispatch.
    // The agent prompt surfaces tools through the tool-catalog provider.
    const agentEngine = createAgentEngine({
      db: dbConn.db,
      runtimes,
      memory: this.memoryProvider,
      drive,
      pipeline,
      callbackUrl,
      jwtSecret,
      queue: resolvedQueue,
      // task_23 — Drive's local-FS root. The engine uses this to
      // symlink the wake's accessible Drive slice into each run's
      // workdir under <workDir>/drive/. Non-local backends (e.g.
      // a future S3) would leave this empty and the mount silently
      // skips, falling back to tool-only Drive access.
      driveRoot,
    });

    // Populate the deps holder so module handlers (e.g.
    // framework.agents.wake) can reach the engine. Module factories
    // captured `factoryDeps` by reference at registration; reading
    // `deps.engine` inside a handler at dispatch time sees this value.
    (factoryDeps as { engine: unknown }).engine = agentEngine;

    // 7. Workflows execute via `workflow.run` tool (see run-workflow.ts).
    //    The realtime bus is needed below for connector events.
    let realtimeBusRef: import("./realtime.js").RealtimeBus | null = null;

    // 8. Build app context (eventBus added after creation below)
    const context: AppContext = {
      config: this.config,
      db: dbConn.db,
      memory: this.memoryProvider,
      drive,
      runtimes,
      agentEngine,
      eventBus: null as any, // populated below after eventBus creation
    };

    // 8. Run beforeStart hooks
    for (const hook of this.beforeStartHooks) {
      await hook(context);
    }

    // 9. Setup plugins
    for (const plugin of this.plugins) {
      await plugin.setup(context);
    }

    // 9b. Setup plugin system
    const pluginRegistry = createPluginRegistry();
    pluginRegistry.register(githubPlugin); // built-in
    for (const def of this.pluginDefs) {
      pluginRegistry.register(def);
    }

    // 10. Setup connectors. The registry was created earlier so it
    // could be passed into the agent engine; here we populate it.
    const eventBus = createEventBus();
    // OAuth lives in core/oauth.ts, action invocation in /api/tools/*.

    // Populate eventBus on context (was null placeholder before eventBus creation)
    context.eventBus = eventBus;
    // Same for the factory deps holder — module handlers read
    // `deps.factoryDeps.eventBus` at dispatch time (the framework
    // module's inbox.update emits `triage.classified` from there).
    (factoryDeps as { eventBus: unknown }).eventBus = eventBus;

    // Register app event handlers
    for (const { type, handler } of this.eventHandlers) {
      if (type) {
        eventBus.on(type, handler);
      } else {
        eventBus.onAny(handler);
      }
    }

    // Wire connector events to agent wakeups + inbox routing
    eventBus.onAny(async (event) => {
      // Route events to inbox based on configured routes
      for (const route of this.inboxRoutes) {
        if (route.filter(event as unknown as Record<string, unknown>)) {
          const item = route.transform(event as unknown as Record<string, unknown>);
          const { inboxItems } = await import("@boringos/db");
          await dbConn.db.insert(inboxItems).values({
            id: generateId(),
            tenantId: event.tenantId,
            source: item.source,
            subject: item.subject,
            body: item.body ?? null,
            from: item.from ?? null,
            assigneeUserId: item.assigneeUserId ?? null,
          }).catch(() => {});
        }
      }
    });

    // Event-dispatch primitive: every connector event is checked against
    // all active workflows in the event's tenant. Any workflow whose entry
    // `trigger` block has config.eventType === event.type is auto-executed
    // with the event payload as the trigger data. This is how onEvent()
    // handlers become workflows — the workflow subscribes declaratively
    // via its trigger block, no hand-rolled dispatcher code per handler.
    //
    // Runs in the background (Promise.resolve().then) so a slow workflow
    // never blocks the event bus or starves other handlers.
    eventBus.onAny((event) => {
      Promise.resolve().then(async () => {
        try {
          const matches = await dbConn.db.select({
            id: workflowsSchema.id,
            blocks: workflowsSchema.blocks,
          }).from(workflowsSchema).where(
            and(
              eqOp(workflowsSchema.tenantId, event.tenantId),
              eqOp(workflowsSchema.status, "active"),
            ),
          );

          for (const w of matches) {
            const blocks = (w.blocks as Array<{ type: string; config?: Record<string, unknown> }>) ?? [];
            const trigger = blocks.find((b) => b.type === "trigger");
            const triggerEventType = trigger?.config?.eventType;
            if (typeof triggerEventType !== "string" || triggerEventType !== event.type) continue;
            // Fire-and-forget.
            await runWorkflow(
              { db: dbConn.db, toolRegistry: toolRegistry },
              {
                workflowId: w.id,
                tenantId: event.tenantId,
                payload: { ...(event.data ?? {}), eventType: event.type },
                invokedBy: "internal",
              },
            ).catch((err) => {
              console.warn(`[workflow-dispatch] ${w.id} failed:`, err);
            });
          }
        } catch (err) {
          console.warn("[workflow-dispatch] lookup failed:", err);
        }
      });
    });

    // 11. Build Hono app
    const app = new Hono();
    // Expose for post-listen registers. The permanent webhook
    // dispatcher below means we never need to call `app.route()`
    // post-listen for module webhooks — the dispatcher reads from
    // `boundModules` per-request — but the field stays available
    // for callers that genuinely need a runtime route mount.
    this.honoApp = app;

    // ── Permanent module webhook dispatcher ─────────────────────
    // Mounted at boot so runtime register/unregister works without
    // touching Hono's route tree. The dispatcher:
    //   1. Pulls (moduleId, event) from the path.
    //   2. Looks up the module in `boundModules` (the shared array
    //      that registerModule pushes into and unregisterModule
    //      splices out of). 404 if missing.
    //   3. Finds the webhooks[] entry whose `event` matches. 404 if
    //      no match.
    //   4. Verifies the request via the module's `verify()` callback.
    //      Returns 401 on rejection.
    //   5. Invokes the module's `handler(request, ctx)`. The handler
    //      is responsible for any tenant resolution it needs (typical
    //      pattern: parse a tenant id from the URL/header/body or
    //      look it up from a signed state param).
    //
    // Mounting this once at boot (versus dynamically) is the correct
    // call because Hono accepts mid-flight `app.route()` registrations
    // (verified — tests/runtime-webhook.test.ts) but provides no
    // symmetric unmount, which would leak stale routes on
    // `unregisterModule`.
    app.all("/api/webhooks/:moduleId/:event", async (c) => {
      const moduleId = c.req.param("moduleId");
      const event = c.req.param("event");
      const mod = this.boundModules.find((m) => m.id === moduleId);
      if (!mod) {
        return c.json({ ok: false, error: "module_not_found" }, 404);
      }
      const hook = mod.webhooks?.find((w) => w.event === event);
      if (!hook) {
        return c.json({ ok: false, error: "webhook_not_found" }, 404);
      }

      // Build the WebhookRequest shape the SDK declares. Hono headers
      // are case-insensitive; flatten them into a plain object so
      // module handlers can read them with `headers["x-signature"]`.
      const headers: Record<string, string> = {};
      c.req.raw.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const query: Record<string, string> = {};
      const url = new URL(c.req.url);
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      const bodyText = await c.req.text();
      const request = {
        method: c.req.method,
        headers,
        body: bodyText,
        query,
      };

      // Verify first; bail with 401 on rejection.
      try {
        const ok = await hook.verify(request);
        if (!ok) {
          return c.json({ ok: false, error: "verification_failed" }, 401);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[webhooks] verify() threw for ${moduleId}.${event}:`, err);
        return c.json({ ok: false, error: "verification_failed" }, 401);
      }

      // Tenant context for the handler. The SDK leaves tenant
      // resolution open-ended; many webhook handlers parse the
      // tenant from a state param. For now we pass an empty string
      // — handlers MUST own tenant resolution.
      const tenantId = (headers["x-tenant-id"] ?? "") as string;
      try {
        // SDK signature: handler returns Promise<void>. Some handlers
        // (e.g. tests) return a response-like object; treat that as
        // an opt-in extension.
        const result = (await hook.handler(request, { tenantId })) as
          | undefined
          | void
          | { status?: number; body?: unknown };
        if (result && typeof result === "object" && ("status" in result || "body" in result)) {
          const status = (result.status ?? 200) as 200 | 400 | 401 | 404 | 500;
          return c.json((result.body ?? { ok: true }) as object, status);
        }
        return c.json({ ok: true });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[webhooks] handler threw for ${moduleId}.${event}:`, err);
        return c.json({ ok: false, error: "handler_failed" }, 500);
      }
    });

    // Health endpoint — surfaces module count so a quick curl tells
    // you which modules are loaded.
    app.get("/health", (c) =>
      c.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        modules: boundModules.map((m) => ({
            id: m.id,
            name: m.name,
            version: m.version,
            tools: m.tools?.length ?? 0,
            skills: m.skills?.length ?? 0,
          })),
        toolCount: toolRegistry.list().length,
        skillCount: skillRegistry.list().length,
      }),
    );

    // Modules with `defaultInstall: true` auto-install via
    // install-manager.onTenantCreated().

    // composedTenantHook fires the user hook (if any) and the
    // install-manager.s onTenantCreated for Modules.
    const userHook = this.tenantProvisionedHook;
    const composedTenantHook = userHook || installManagerEarly
      ? async (db: Db, tenantId: string) => {
          if (userHook) await userHook(db, tenantId);
          if (installManagerEarly) {
            try {
              await installManagerEarly.onTenantCreated(tenantId);
            } catch (err) {
              console.warn(
                "[boringos] onTenantCreated hooks failed for tenant",
                tenantId,
                err,
              );
            }
          }
        }
      : undefined;

    // Auth routes (login, signup, session). Drive passed so signup
    // can scaffold preferences.md + memory/MEMORY.md per new user.
    const authApp = createAuthRoutes(dbConn.db, jwtSecret, composedTenantHook, drive);
    app.route("/api/auth", authApp);

    // Device auth routes (CLI login)
    const deviceAuthApp = createDeviceAuthRoutes(dbConn.db);
    app.route("/api/auth/device", deviceAuthApp);

    // The host MUST register at least one module (typically
    // createFrameworkModule) for the agent surface to exist —
    // without modules, /api/tools/* serves only 404s.
    if (!hasModules) {
      console.warn(
        "[boringos] no modules are registered. " +
          "Agents will have no callable surface. Register createFrameworkModule + " +
          "any other modules you need via app.module(...).",
      );
    }

    // Mount the unified dispatch endpoint + admin views when modules
    // are present. The registries themselves were built earlier
    // (step 5) so the context pipeline could add their providers.
    if (hasModules && installManagerEarly) {
      // Backfill install rows for every existing tenant ×
      // default-install module. Idempotent. Fire-and-forget on
      // boot so a slow backfill doesn't block listen().
      void installManagerEarly.backfill(boundModules).catch((e) => {
        // eslint-disable-next-line no-console
        console.error("[install-manager] backfill failed:", e);
      });

      const toolsApp = createToolRoutes({
        db: dbConn.db,
        registry: toolRegistry,
        jwtSecret,
        installManager: installManagerEarly,
      });
      app.route("/api/tools", toolsApp);

      const moduleAdminApp = createModuleAdminRoutes({
        db: dbConn.db,
        toolRegistry: toolRegistry,
        skillRegistry: skillRegistry,
        modules: boundModules,
        installManager: installManagerEarly,
        resolveTenantId: (req) => req.headers.get("x-tenant-id"),
      });
      // Unversioned admin surface — /api/admin/{modules,installs,
      // modules/:id/install, modules/:id/uninstall, tools, tool-calls}.
      //
      app.route("/api/admin", moduleAdminApp);

      // task_22 U3.1 / U3.3 / U3.5 — `.hebbsmod` upload + delete + list.
      const modulePackageApp = createModulePackageRoutes({
        db: dbConn.db,
        host: this,
        installManager: installManagerEarly,
        resolveTenantId: (req) => req.headers.get("x-tenant-id"),
        realtimeBus: realtimeBusRef ?? undefined,
      });
      app.route("/api/admin/modules", modulePackageApp);
    }

    // task_22 U4.1 — module UI asset serving. Mounted at `/modules`
    // (NOT under `/api/admin/modules`) so the shell can dynamic-
    // `import()` plugin UI bundles via the URL contract
    // `/modules/<id>/ui/<file>`. Mounted unconditionally — the
    // route reads from the `module_packages` table directly and
    // returns 404 if no UI is uploaded yet.
    const moduleUiApp = createModuleUiRoutes({ db: dbConn.db });
    app.route("/modules", moduleUiApp);

    // Connector routes (legacy actions surface — gated by  flag).
    // The OAuth + webhook pieces of /api/connectors stay mounted so
    // OAuth flows and 3rd-party webhooks keep working — the gating
    // is specifically the actions invocation paths.
    const connectorApp = createConnectorRoutes(dbConn.db, eventBus, jwtSecret, callbackUrl, {
      shellOrigin: this.config.shellOrigin,
    }, authManager);
    app.route("/api/connectors", connectorApp);

    // Admin API (for human management of the platform)
    const adminKeyValue = this.config.auth?.adminKey ?? jwtSecret;
    // Realtime SSE
    const realtimeBus = createRealtimeBus();
    // Now that the bus exists, connect the workflow engine's event sink.
    realtimeBusRef = realtimeBus;
    // Lazy-populate module factory deps so workflow.run can emit
    // per-block events to the canvas.
    (factoryDeps as { realtimeBus: unknown }).realtimeBus = realtimeBus;

    const adminApp = createAdminRoutes(dbConn.db, agentEngine, adminKeyValue, realtimeBus, toolRegistry, runtimes, eventBus, drive, settingRegistry, authManager);
    app.route("/api/admin", adminApp);

    const sseApp = createSSERoutes(realtimeBus, adminKeyValue, dbConn.db);
    app.route("/api", sseApp);

    // Bridge inbox.* connector events through to the realtime bus so
    // SSE-subscribed clients (the shell) refresh their inbox lists
    // without polling. Other connector events stay scoped to the
    // workflow event bus.
    eventBus.onAny((event) => {
      if (!event.type.startsWith("inbox.")) return;
      realtimeBus.publish({
        type: event.type,
        tenantId: event.tenantId,
        data: event.data,
        timestamp:
          event.timestamp instanceof Date
            ? event.timestamp.toISOString()
            : new Date().toISOString(),
      });
    });

    // task_24 F — register the memory-checkpoint subscriber. Every
    // run finalisation (success or failure) appends a structured
    // entry to the work's log file (tasks/<id>/log.md, or
    // users/<owner>/sessions/<sid>.md for copilot sessions). Logs
    // accumulate even when the agent forgets to remember.
    const { createMemoryCheckpoint } = await import("@boringos/agent");
    const memoryCheckpoint = createMemoryCheckpoint({
      drive,
      db: dbConn.db,
    });
    agentEngine.afterRun.use(memoryCheckpoint.onRunFinished);
    agentEngine.onError.use(memoryCheckpoint.onRunFailed);

    // Wire engine events to realtime bus
    agentEngine.beforeRun.use((event) => {
      realtimeBus.publish({
        type: "run:started",
        tenantId: event.tenantId,
        data: { runId: event.runId, agentId: event.agentId, taskId: event.taskId },
        timestamp: new Date().toISOString(),
      });
    });

    // Transient live "thinking" progress (pi-scoped today). Relayed to the
    // realtime bus only — never persisted. The shell renders it in a
    // temporary bubble and clears it when the reply comment arrives.
    agentEngine.onProgress.use((event) => {
      realtimeBus.publish({
        type: "run:thinking",
        tenantId: event.tenantId,
        data: {
          runId: event.runId,
          agentId: event.agentId,
          taskId: event.taskId,
          kind: event.kind,
          delta: event.delta,
          toolName: event.toolName,
        },
        timestamp: new Date().toISOString(),
      });
    });
    agentEngine.afterRun.use(async (event) => {
      const status = event.result.exitCode === 0 ? "run:completed" : "run:failed";
      realtimeBus.publish({
        type: status,
        tenantId: event.tenantId,
        data: { runId: event.runId, agentId: event.agentId, exitCode: event.result.exitCode },
        timestamp: new Date().toISOString(),
      });

      // ── Handoff state machine ────────────────────────────────────
      // Every agent run that touched a task hands the task back to the
      // human. Success flips next_actor='human' silently; failure flips
      // and stamps metadata.lastError so the UI can surface "Run failed —
      // [Retry] [Take over] [Mark done]". Tasks already 'done' are left
      // alone — a parallel branch (e.g. agent.tasks.patch) closing the
      // task wins. This is the rule that breaks self-reply loops: the
      // auto-rewake gate below skips next_actor='human'.
      if (event.taskId) {
        try {
          const { sql } = await import("drizzle-orm");
          if (event.result.exitCode === 0) {
            await dbConn.db.execute(sql`
              UPDATE tasks
                 SET next_actor = 'human',
                     updated_at  = now()
               WHERE id = ${event.taskId}::uuid
                 AND status NOT IN ('done', 'cancelled')
            `).catch(() => {});
          } else {
            const lastError = {
              runId: event.runId,
              exitCode: event.result.exitCode ?? null,
              error: (event.result as { error?: unknown }).error ?? null,
              at: new Date().toISOString(),
            };
            await dbConn.db.execute(sql`
              UPDATE tasks
                 SET next_actor = 'human',
                     metadata    = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ lastError })}::jsonb,
                     updated_at  = now()
               WHERE id = ${event.taskId}::uuid
                 AND status NOT IN ('done', 'cancelled')
            `).catch(() => {});
          }
        } catch {
          // Non-fatal — handoff is best-effort. Fallback path: the
          // existing auto-rewake's same-task skip still prevents loops.
        }
      }

      // Auto-post agent's result as a comment on the task (for copilot sessions + any task-based run)
      if (event.taskId && event.result.exitCode === 0) {
        try {
          const { agentRuns, taskComments: tc } = await import("@boringos/db");
          const runRows = await dbConn.db.select({ excerpt: agentRuns.stdoutExcerpt }).from(agentRuns)
            .where((await import("drizzle-orm")).eq(agentRuns.id, event.runId)).limit(1);
          const excerpt = runRows[0]?.excerpt;
          if (excerpt) {
            // Extract the result text from stream-json output
            let replyText = excerpt;
            try {
              // Try to parse the last JSON line for the result text
              const lines = excerpt.split("\n").filter(Boolean);
              for (let i = lines.length - 1; i >= 0; i--) {
                const parsed = JSON.parse(lines[i]);
                if (parsed.type === "result" && parsed.result) {
                  replyText = parsed.result;
                  break;
                }
              }
            } catch {
              // Use excerpt as-is if not parseable
            }

            if (replyText && replyText.length > 10) {
              await dbConn.db.insert(tc).values({
                id: generateId(),
                taskId: event.taskId,
                tenantId: event.tenantId,
                body: replyText,
                authorAgentId: event.agentId,
              });
            }
          }
        } catch {
          // Silently skip if posting fails
        }
      }

      // Auto-re-wake: drain the agent's queue of work that's still
      // assigned to it AND still expects the agent to act
      // (`next_actor='agent'`). The handoff above flipped the
      // just-finished task to `next_actor='human'`, so it's
      // automatically excluded from this scan — no special-case
      // needed. We still skip on failed runs to avoid replay storms
      // (~500 wakes in 30 min observed pre-fix).
      //
      // Sessions are task-scoped, so the wake must target a specific
      // task (the oldest pending one).
      if (event.result.exitCode === 0) {
        try {
          const { sql } = await import("drizzle-orm");
          const nextTaskRows = await dbConn.db.execute(sql`
            SELECT id FROM tasks
            WHERE assignee_agent_id = ${event.agentId}
              AND tenant_id = ${event.tenantId}
              AND status NOT IN ('done', 'cancelled')
              AND next_actor = 'agent'
            ORDER BY created_at ASC
            LIMIT 1
          `);
          const nextTaskId = (nextTaskRows as unknown as Array<{ id: string }>)[0]?.id;
          if (nextTaskId) {
            const outcome = await agentEngine.wake({
              agentId: event.agentId,
              tenantId: event.tenantId,
              taskId: nextTaskId,
              reason: "comment_posted", // re-wake reason
            });
            if (outcome.kind === "created") {
              await agentEngine.enqueue(outcome.wakeupRequestId);
            }
          }
        } catch {
          // Non-fatal
        }
      }
    });

    // Plugin webhook routes
    const pluginWebhookApp = createPluginWebhookRoutes(dbConn.db, pluginRegistry);
    app.route("/webhooks/plugins", pluginWebhookApp);

    // Plugin admin routes (under admin API auth)
    const pluginAdminApp = createPluginAdminRoutes(dbConn.db, pluginRegistry);
    app.route("/api/admin/plugins", pluginAdminApp);

    // Extra routes
    for (const { path, app: routeApp } of this.extraRoutes) {
      app.route(path, routeApp);
    }

    // 10b. Copilot — . Browser shell talks to
    // /api/admin/tasks/* (creating tasks with originKind=
    // "copilot") and uses the copilot.start_session tool. The
    // per-tenant copilot agent provisioning still happens here.
    {

      // Auto-create Chief of Staff and Copilot for existing first tenant (backward compat)
      const { tenants: tenantsTable, agents: agentsTable } = await import("@boringos/db");
      const { eq, and, isNull } = await import("drizzle-orm");
      const tenantRows = await dbConn.db.select().from(tenantsTable).limit(1);
      const firstTenant = tenantRows[0];

      if (firstTenant?.id) {
        const firstTenantId = firstTenant.id;
        const { createAgentFromTemplate } = await import("@boringos/agent");

        // Get available runtime for this tenant
        const rtRows = await dbConn.db.select().from(
          (await import("@boringos/db")).runtimes
        ).where(
          eq((await import("@boringos/db")).runtimes.tenantId, firstTenantId),
        ).limit(1);
        const runtimeId = rtRows[0]?.id;

        // Check for Chief of Staff
        const existingCoS = await dbConn.db.select().from(agentsTable).where(
          and(
            eq(agentsTable.tenantId, firstTenantId),
            eq(agentsTable.role, "chief-of-staff"),
          ),
        ).limit(1);

        // Check for any existing root agent — the unique index only allows one
        // agent with reports_to IS NULL per tenant, so we must not create a CoS
        // when another role (e.g. the quickstart's "engineer") already occupies
        // the root slot.
        const existingRootAgent = await dbConn.db.select({ id: agentsTable.id })
          .from(agentsTable)
          .where(and(eq(agentsTable.tenantId, firstTenantId), isNull(agentsTable.reportsTo)))
          .limit(1);

        let cosId = existingCoS[0]?.id;
        if (!cosId && runtimeId && existingRootAgent.length === 0) {
          // Create CoS only when the tenant has no root agent at all
          const cosResult = await createAgentFromTemplate(dbConn.db, "chief-of-staff", {
            tenantId: firstTenantId,
            name: "Chief of Staff",
            runtimeId,
            source: "shell",
          });
          cosId = cosResult.id;

          // Update tenant root_agent_id
          await dbConn.db.execute((await import("drizzle-orm")).sql`
            UPDATE tenants SET root_agent_id = ${cosId}, updated_at = now()
            WHERE id = ${firstTenantId}
          `);
        }

        // Check for Copilot
        const existingCopilot = await dbConn.db.select().from(agentsTable).where(
          and(
            eq(agentsTable.tenantId, firstTenantId),
            eq(agentsTable.role, "copilot"),
          ),
        ).limit(1);

        if (existingCopilot.length === 0 && runtimeId && cosId) {
          // Create Copilot under CoS
          await createAgentFromTemplate(dbConn.db, "copilot", {
            tenantId: firstTenantId,
            name: "Copilot",
            runtimeId,
            reportsTo: cosId,
            source: "shell",
          });
        } else if (existingCopilot[0] && cosId && !existingCopilot[0].reportsTo) {
          // Wire existing orphaned Copilot under CoS
          await dbConn.db.execute((await import("drizzle-orm")).sql`
            UPDATE agents SET reports_to = ${cosId}, updated_at = now()
            WHERE id = ${existingCopilot[0].id} AND reports_to IS NULL
          `);
        }
      }
    }

    // 10c. Recover wake requests + runs orphaned by a prior crash/restart.
    // Pending wakes go back in the queue; running runs are closed out as failed.
    try {
      const recovered = await agentEngine.recoverPending();
      if (recovered.orphanedRuns > 0 || recovered.reenqueued > 0) {
        console.log(
          `[boringos] recovered pending work: ${recovered.reenqueued} wake(s) re-enqueued, ${recovered.orphanedRuns} stale run(s) closed`,
        );
      }
    } catch (err) {
      console.error("[boringos] recoverPending failed:", err);
    }

    // 10d. Rehydrate third-party modules from the on-disk store.
    // `module_installs` rows say "this tenant has CRM installed" but
    // the in-process tool registry is rebuilt empty on every boot;
    // only built-ins (registered via app.module() in the host's
    // entry script) come back automatically. Without this loop, a
    // restart leaves every `.hebbsmod` module unregistered until
    // someone re-uploads — the UI then sees 404 "Unknown tool" for
    // every crm.*, etc. and renders as empty.
    //
    // Re-runs the same dynamic-import + registerModule path the
    // upload route uses (see `module-package-routes.ts`).
    try {
      const { readdir, readFile } = await import("node:fs/promises");
      const { resolve: pathResolve } = await import("node:path");
      const storeDir =
        process.env.MODULES_STORE_DIR ??
        pathResolve(process.cwd(), ".data", "module-store");
      let storeEntries: string[] = [];
      try {
        storeEntries = await readdir(storeDir);
      } catch {
        /* no store dir → no third-party modules to hydrate */
      }
      let hydrated = 0;
      for (const name of storeEntries) {
        if (name.startsWith(".")) continue;
        const moduleDir = pathResolve(storeDir, name);
        const manifestPath = pathResolve(moduleDir, "module.json");
        let manifest: { id: string; version?: string } | null = null;
        try {
          manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
            id: string;
            version?: string;
          };
        } catch {
          continue; // malformed or missing manifest — skip
        }
        // Skip if a same-id module is already bound (built-in
        // shadows third-party, and re-uploading would re-trigger
        // unregister first anyway).
        if (this.boundModules.find((m) => m.id === manifest.id)) continue;

        try {
          const entryUrl = new URL(`file://${moduleDir}/index.mjs`);
          const imported = (await import(entryUrl.href)) as Record<
            string,
            unknown
          >;
          const factoryName = `create${manifest.id.charAt(0).toUpperCase()}${manifest.id.slice(1)}Module`;
          const entry =
            (imported?.["default"] as Module | ModuleFactory | undefined) ??
            (imported?.[factoryName] as Module | ModuleFactory | undefined);
          if (!entry) continue;
          await this.registerModule(entry, this.moduleFactoryDeps);
          hydrated += 1;
        } catch (err) {
          console.warn(
            `[boringos] failed to rehydrate module "${name}" from store:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      if (hydrated > 0) {
        console.log(
          `[boringos] rehydrated ${hydrated} third-party module(s) from ${storeDir}`,
        );
      }
    } catch (err) {
      console.error("[boringos] module rehydration failed:", err);
    }

    //

    // 11. Start HTTP server
    const server = serve({ fetch: app.fetch, port: listenPort });

    // Get the actual port (important when listenPort is 0)
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : listenPort;

    // 13. Start routine scheduler
    const scheduler = createRoutineScheduler(dbConn.db, agentEngine, toolRegistry);
    scheduler.start();

    // Inbox snooze ticker: flips snoozed rows back to unread when their
    // snooze_until elapses. Cheap (one indexed UPDATE every 30s) so
    // wired unconditionally.
    const snoozeTicker = createInboxSnoozeTicker(dbConn.db, authManager);
    snoozeTicker.start();

    // Forward sync — ingest new Gmail messages into inbox_items every
    // 30 seconds. Replaces the legacy gmail.gmail-sync workflow + routine
    // that the deleted workflow engine used to run.
    //
    // Layered fan-out (per docs/coordination.md):
    //   1. Header-prefilter at ingest time pre-classifies clear
    //      newsletters / no-reply automated mail. When it fires, we
    //      skip the triage wake — paying for an LLM run only to
    //      discover "this is a newsletter" wastes credits.
    //   2. Otherwise we wake the triage agent. After it writes
    //      `metadata.triage`, the `triage.classified` listener below
    //      wakes the replier on every classified item — the replier
    //      itself decides whether to draft or skip. Centralising that
    //      decision in the replier (which has the full email + headers
    //      + triage label) avoids the legacy gate's brittleness, where
    //      the framework had to keep its allow-list in sync with the
    //      triage taxonomy and the score schema.
    //
    // The triage / replier agents are looked up by the names the
    // default-app catalog seeds them under.
    const TRIAGE_AGENT_NAME = "Generic Inbox Triage";
    const REPLIER_AGENT_NAME = "Generic Email Replier";

    function describeEmailHeaders(item: import("./inbox-gmail-forward-sync.js").IngestedInboxItem): string {
      const h = item.headers;
      const parts: string[] = [];
      parts.push(`list-unsubscribe: ${h.listUnsubscribe ?? "none"}`);
      parts.push(`list-id: ${h.listId ?? "none"}`);
      parts.push(`auto-submitted: ${h.autoSubmitted ?? "none"}`);
      parts.push(`precedence: ${h.precedence ?? "none"}`);
      parts.push(`reply-to: ${h.replyTo ?? "none"}`);
      const flag = item.automated.automated
        ? `prefilter: automated (${item.automated.kind ?? "?"}; ${item.automated.reasons.join(", ")})`
        : `prefilter: human`;
      parts.push(flag);
      return parts.join("\n");
    }

    async function createTriageTask(
      item: import("./inbox-gmail-forward-sync.js").IngestedInboxItem,
      agentId: string,
      titlePrefix: string,
    ): Promise<string | null> {
      const { tasks: tasksTable } = await import("@boringos/db");
      const taskId = generateId();
      try {
        await dbConn.db.insert(tasksTable).values({
          id: taskId,
          tenantId: item.tenantId,
          title: `${titlePrefix}: ${item.subject}`,
          description:
            `inbox-item-id: ${item.itemId}\n` +
            `source: ${item.source}\n` +
            `from: ${item.from ?? ""}\n` +
            `subject: ${item.subject}\n` +
            `${describeEmailHeaders(item)}\n` +
            `---\n` +
            (item.body ?? ""),
          status: "todo",
          assigneeAgentId: agentId,
          originKind: "inbox.item_created",
          originId: item.itemId,
        });
        return taskId;
      } catch (err) {
        console.warn(
          `[inbox-fanout] failed to create task for item=${item.itemId}:`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    }

    async function findAgentByName(
      tenantId: string,
      name: string,
    ): Promise<{ id: string } | null> {
      const { agents: agentsTable } = await import("@boringos/db");
      const rows = await dbConn.db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(
          and(
            eqOp(agentsTable.tenantId, tenantId),
            eqOp(agentsTable.name, name),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    }

    async function wakeAgentSafe(
      agentId: string,
      tenantId: string,
      taskId: string,
      label: string,
    ): Promise<void> {
      try {
        const outcome = await agentEngine.wake({
          agentId,
          tenantId,
          taskId,
          reason: "connector_event",
        });
        if (outcome.kind === "created") {
          await agentEngine.enqueue(outcome.wakeupRequestId);
        }
      } catch (err) {
        console.warn(
          `[inbox-fanout] failed to wake ${label} agent=${agentId} task=${taskId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // RC8 (Layer 2 fix). Forward-sync used to have an `onIngest`
    // direct-fanout callback that created a triage task in parallel
    // with the inbox-triage workflow firing on `inbox.item_created`
    // — every email got triaged twice. The workflow is now the sole
    // path; the automated-mail skip optimization lives in the
    // workflow's `check-not-automated` condition block (see
    // `buildTriageWorkflowBlocks` in modules/inbox-triage.ts).
    const forwardSyncTicker = createInboxGmailForwardSyncTicker(dbConn.db, authManager, {
      eventBus,
    });
    forwardSyncTicker.start();

    // @deprecated since RC1 (issue #33). The replier is now woken
    // by the `inbox-replier` Module's workflow, which triggers on
    // `triage.classified` and filters noise/fyi via condition
    // blocks before creating the task with the correct
    // `originKind: "inbox.draft_reply"`.
    //
    // This hand-coded listener used to create replier tasks via the
    // generic `createTriageTask` helper, which hardcoded
    // `originKind: "inbox.item_created"` — that's the wrong kind for
    // replier tasks, and after RC2's `appliesTo` switch it would
    // also load the WRONG skill for the agent at run time.
    //
    // The stub below is registered but does nothing — left here as
    // a structural breadcrumb so anyone reading boringos.ts and
    // expecting a `triage.classified` handler sees the historical
    // wake path documented + a pointer to the workflow that
    // replaced it. Safe to delete in a follow-up PR.
    eventBus.on("triage.classified", async () => {
      /* no-op — workflow path is canonical (Option A) */
    });

    // Reverse sync — pull state changes from Gmail back into Hebbs
    // every 2 minutes. Skipped silently if no Gmail connector is wired
    // (the ticker iterates connected Gmail tenants; an empty set is a
    // no-op).
    const reverseSyncTicker = createInboxGmailReverseSyncTicker(dbConn.db, authManager);
    reverseSyncTicker.start();

    // 13. Run afterStart hooks
    for (const hook of this.afterStartHooks) {
      await hook(context);
    }

    const url = `http://localhost:${actualPort}`;

    return {
      url,
      port: actualPort,
      context,
      async close() {
        scheduler.stop();
        server.close();
        // Drain in-flight agent runs (bounded) before tearing down the DB
        // pool, so a run that finalizes during shutdown doesn't query a
        // closed connection (CONNECTION_ENDED unhandled rejection).
        await resolvedQueue.close().catch(() => {});
        await dbConn.close();
      },
    };
  }
}
