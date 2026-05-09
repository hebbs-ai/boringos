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
} from "@boringos/runtime";
import type { RuntimeModule, RuntimeRegistry } from "@boringos/runtime";
import { createLocalStorage, scaffoldDrive } from "@boringos/drive";
import type { StorageBackend } from "@boringos/drive";
import { createDatabase, createMigrationManager, workflows as workflowsSchema } from "@boringos/db";
import type { Db, DatabaseConnection } from "@boringos/db";
import { and, eq as eqOp } from "drizzle-orm";
import { createAgentEngine, ContextPipeline } from "@boringos/agent";
import type { AgentEngine, ContextProvider, AgentRunJob } from "@boringos/agent";
import type { QueueAdapter } from "@boringos/pipeline";
import { createInProcessQueue } from "@boringos/pipeline";
// v1 @boringos/workflow engine deleted — workflows execute through
// the v2 `workflow.run` tool dispatcher. See run-workflow.ts.
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
// v1 callback routes deleted — agents now call /api/tools/*
import { runWorkflow } from "./run-workflow.js";
import { createV2Routes } from "./v2-routes.js";
import { createV2AdminRoutes } from "./v2-admin-routes.js";
import {
  createToolRegistry,
  createSkillRegistry,
  createModuleRegistry,
  createSkillsProvider,
  createToolCatalogProvider,
  createInstallManager,
} from "@boringos/agent";
import type {
  ToolRegistry as V2ToolRegistry,
  SkillRegistry as V2SkillRegistry,
  ModuleRegistry as V2ModuleRegistry,
  InstallManager as V2InstallManager,
} from "@boringos/agent";
import type { Module, ModuleFactory } from "@boringos/module-sdk";
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
// v1 copilot routes deleted — copilot is a v2 module, conversations
// go through /api/admin/tasks/* with originKind="copilot"
import { createPluginRegistry } from "./plugin-system.js";
import type { PluginDefinition } from "./plugin-system.js";
import { createPluginWebhookRoutes, createPluginAdminRoutes } from "./plugin-routes.js";
import { githubPlugin } from "./plugins/github.js";
import { provisionDefaultApps, type DefaultAppCatalogEntry } from "./tenant-provisioning.js";
import { createAppsAdminRoutes } from "./admin/apps.js";
import {
  createKernelInstallContext,
  loadCatalogFromDisk,
  type SlotInstallRuntime,
  type InstallEventBus,
  type AppRouteRegistry,
} from "@boringos/control-plane";
import { createAppRouteRegistry } from "@boringos/control-plane";

export class BoringOS {
  private config: BoringOSConfig;
  private memoryProvider: MemoryProvider = nullMemory;
  private extraRuntimes: RuntimeModule[] = [];
  private contextProviders: ContextProvider[] = [];
  private personas: Map<string, PersonaBundle> = new Map();
  private plugins: PluginManifest[] = [];
  private pluginDefs: PluginDefinition[] = [];
  // v1 ConnectorDefinition[] removed — connectors are v2 modules now.
  private beforeStartHooks: LifecycleHook[] = [];
  private afterStartHooks: LifecycleHook[] = [];
  private beforeShutdownHooks: LifecycleHook[] = [];
  private extraRoutes: Array<{ path: string; app: Hono; agentDocs?: string | ((callbackUrl: string) => string) }> = [];
  // BlockHandler API removed with the v1 workflow engine. Custom
  // workflow blocks should ship as v2 tools instead.
  private queueAdapter: QueueAdapter<AgentRunJob> | undefined;
  private userSchemaStatements: string[] = [];
  private inboxRoutes: Array<{ filter: (event: Record<string, unknown>) => boolean; transform: (event: Record<string, unknown>) => { source: string; subject: string; body?: string; from?: string; assigneeUserId?: string } }> = [];
  private tenantProvisionedHook: ((db: Db, tenantId: string) => Promise<void>) | undefined;
  private eventHandlers: Array<{ type: string | null; handler: (event: import("./event-bus.js").ConnectorEvent) => void | Promise<void> }> = [];
  // v2 — Skills + Tools + Modules. Empty in v1-only deployments.
  // Populated via `app.module(myModule)`. The boot sequence skips
  // mounting the v2 routes when this is empty, so v1 deployments
  // are unaffected.
  //
  // Two registration shapes:
  //   - inline `Module` — the manifest is plain data (typical for
  //     connector / capability modules built without DB access)
  //   - `ModuleFactory` — a function that receives framework
  //     services after boot and returns a `Module`. Used by
  //     built-ins (framework / memory / inbox / copilot / etc.)
  //     and by hybrid modules that own their own schema.
  private v2Modules: Array<Module | ModuleFactory> = [];

  constructor(config: BoringOSConfig = {}) {
    this.config = config;
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
   * Register a v2 Module (Skills + Tools + Modules architecture).
   *
   * In v2, every component — connectors, apps, plugins, built-in
   * subsystems — implements the `Module` interface from
   * `@boringos/module-sdk`. The framework collects them, walks
   * their tools into the tool registry, walks their skills into
   * the skill registry, runs migrations + lifecycle hooks per
   * tenant install, and exposes the unified
   * `POST /api/tools/<module-id>.<tool-name>` dispatch endpoint.
   *
   * v1 connectors / apps / plugins continue to work in parallel
   * during the phased migration. The v2 routes are mounted only
   * if at least one Module is registered, so v1-only hosts boot
   * exactly as before.
   */
  module(mod: Module | ModuleFactory): this {
    this.v2Modules.push(mod);
    return this;
  }

  async listen(port?: number): Promise<StartedServer> {
    const listenPort = port ?? 3000;

    // 1. Boot database
    const dbConfig = this.config.database ?? { embedded: true as const };
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

    // 4. Build runtime registry
    const runtimes = createRuntimeRegistry();
    for (const rt of [claudeRuntime, chatgptRuntime, geminiRuntime, ollamaRuntime, commandRuntime, webhookRuntime]) {
      runtimes.register(rt);
    }
    for (const rt of this.extraRuntimes) {
      runtimes.register(rt);
    }

    // 5. v2 — build Skills + Tools + Modules registries (always
    //    constructed; only populated + mounted when modules
    //    exist). Doing this before the pipeline build means the
    //    v2 providers can be added to the pipeline alongside v1's.
    const v2ToolRegistry: V2ToolRegistry = createToolRegistry();
    const v2SkillRegistry: V2SkillRegistry = createSkillRegistry();
    const v2ModuleRegistry: V2ModuleRegistry = createModuleRegistry({
      tools: v2ToolRegistry,
      skills: v2SkillRegistry,
    });
    // ModuleFactory functions are resolved here, after the DB +
    // drive are available (memory provider, agent + workflow
    // engines are wired in by reference later — built-ins that
    // need them close over the deps object). The factory pattern
    // lets built-ins access framework services without leaking
    // those types into the SDK's Module shape.
    const v2FactoryDeps = {
      db: dbConn.db,
      memory: this.memoryProvider,
      drive,
      // engine + workflowEngine are populated later in this
      // method; built-ins that need them read from the deps
      // object at call time, not at factory time.
      engine: undefined as unknown,
      workflowEngine: undefined as unknown,
      toolRegistry: v2ToolRegistry,
      realtimeBus: undefined as unknown,
    };
    const v2BoundModules: Module[] = [];
    for (const entry of this.v2Modules) {
      const mod = typeof entry === "function"
        ? entry(v2FactoryDeps)
        : entry;
      v2ModuleRegistry.register(mod);
      v2BoundModules.push(mod);
    }
    const v2HasModules = v2BoundModules.length > 0;

    // Construct the install manager early so the new-tenant hook
    // can fire onTenantCreate during signup. Backfill of existing
    // tenants happens later (fire-and-forget) once routes mount.
    const v2InstallManagerEarly: V2InstallManager | undefined = v2HasModules
      ? createInstallManager({ db: dbConn.db, modules: v2BoundModules })
      : undefined;

    // 6. Build context pipeline
    const pipeline = new ContextPipeline();
    for (const provider of this.contextProviders) {
      pipeline.add(provider);
    }

    // v2 prompt sections — additive. Registered alongside v1's
    // providers when modules are present, so the agent's prompt
    // shows BOTH v1 sections (drive-skill, memory-skill, etc.)
    // AND v2 sections (## Skills + ## Available tools). Cutover
    // removes the v1 providers; until then this overlap is
    // intentional and gives us the parity safety net.
    if (v2HasModules) {
      pipeline.add(createSkillsProvider({ registry: v2SkillRegistry }));
      pipeline.add(createToolCatalogProvider({ registry: v2ToolRegistry }));
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

    // Connector registry: kept for OAuth + webhook dispatch
    // (v2 modules wrap connector clients). The agent prompt
    // surfaces tools through the v2 tool-catalog provider, not
    const agentEngine = createAgentEngine({
      db: dbConn.db,
      runtimes,
      memory: this.memoryProvider,
      drive,
      pipeline,
      callbackUrl,
      jwtSecret,
      queue: resolvedQueue,
    });

    // Now that the agent engine exists, populate the deps holder
    // so v2 module handlers (e.g. framework.agents.wake) can
    // call into it. Module factories captured `v2FactoryDeps` by
    // reference at registration; reading `deps.engine` inside a
    // handler at dispatch time sees this value.
    (v2FactoryDeps as { engine: unknown }).engine = agentEngine;

    // 7. Workflow engine — replaced by v2 dispatcher. Workflows
    // execute via `workflow.run` tool (see run-workflow.ts). The
    // realtime bus is still needed below for connector events.
    let realtimeBusRef: import("./realtime.js").RealtimeBus | null = null;

    // 8. Build app context (eventBus added after creation below)
    const context: AppContext = {
      config: this.config,
      db: dbConn.db,
      memory: this.memoryProvider,
      drive,
      runtimes,
      agentEngine,
      // workflowEngine: removed — use the v2 `workflow.run` tool.
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
    // (v1 ConnectorRegistry + ActionRunner removed —
    // OAuth lives in core/oauth.ts, action invocation in /api/tools/*.)

    // Populate eventBus on context (was null placeholder before eventBus creation)
    context.eventBus = eventBus;

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
            // Fire-and-forget — runs through v2 dispatch.
            await runWorkflow(
              { db: dbConn.db, toolRegistry: v2ToolRegistry },
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

    // Health endpoint — also surfaces v2 module count so a quick
    // curl tells you whether v2 is wired up for this deployment.
    app.get("/health", (c) =>
      c.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        v2: {
          modules: v2BoundModules.map((m) => ({
            id: m.id,
            name: m.name,
            version: m.version,
            tools: m.tools?.length ?? 0,
            skills: m.skills?.length ?? 0,
          })),
          totalTools: v2ToolRegistry.list().length,
          totalSkills: v2SkillRegistry.list().length,
        },
      }),
    );

    // Phase 2 K7/K8/K9 wiring — kernel install context + default-app
    // catalog. Built once at boot and shared by /api/admin/apps (manual
    // installs) and the tenantProvisionedHook (auto-install of default
    // apps on signup).
    const appRouteRegistry: AppRouteRegistry = createAppRouteRegistry();
    // Note: appRouteRegistry.attachTo(app) is called AT THE END of route
    // mounting, so the per-app dispatcher catches /api/{appId}/* AFTER
    // all framework /api/* routes have been registered (otherwise the
    // dispatcher's catch-all 404 wins over framework routes).

    const installSlotRuntime: SlotInstallRuntime = {
      installApp: ({ appId }) => ({ appId }),
      uninstallApp: () => {},
    };
    const installEventBus: InstallEventBus = {
      emit: () => {},
    };
    const kernelInstallContext = createKernelInstallContext({
      db: dbConn.db,
      slotRuntime: installSlotRuntime,
      events: installEventBus,
      routeRegistry: appRouteRegistry,
    });

    let defaultAppsCatalog: DefaultAppCatalogEntry[] = [];
    if (this.config.defaultAppsDir) {
      try {
        const loaded = loadCatalogFromDisk(this.config.defaultAppsDir, {
          skipMalformed: true,
        });
        if (loaded.errors.length > 0) {
          console.warn(
            `[boringos] default-app catalog skipped ${loaded.errors.length} malformed entries:`,
            loaded.errors.map((x) => `${x.appDir}: ${x.message}`).join("; "),
          );
        }
        // Enrich each entry with the live AppDefinition by dynamic-importing
        // the compiled bundle. Without this, K3's agent registrar has
        // nothing to register (manifest alone doesn't carry agents/workflows).
        const { resolve: resolvePath } = await import("node:path");
        const { pathToFileURL } = await import("node:url");
        const { readFileSync, existsSync } = await import("node:fs");
        const { createHash } = await import("node:crypto");
        const enriched: DefaultAppCatalogEntry[] = [];
        for (const entry of loaded.entries) {
          const candidate = entry as unknown as DefaultAppCatalogEntry & { bundleDir?: string };
          let definition = candidate.definition;
          // Compute bundleDir from the catalog root + app id when the
          // loader didn't supply one (current K8 loader doesn't).
          const bundleDir =
            candidate.bundleDir ?? resolvePath(this.config.defaultAppsDir!, entry.id);
          const indexPath = resolvePath(bundleDir, "dist", "index.js");
          if (!definition) {
            try {
              const mod = await import(pathToFileURL(indexPath).href);
              definition =
                (mod.default as typeof candidate.definition) ??
                (mod as typeof candidate.definition);
            } catch (err) {
              console.warn(
                `[boringos] could not load bundle for default app ${entry.id}:`,
                err instanceof Error ? err.message : err,
              );
            }
          }
          // Re-hash to include the agents bundle (dist/index.js). The
          // disk-catalog loader only sees the UI bundle (dist/ui.js)
          // and the manifest; instruction edits in src/agents/*.ts go
          // through dist/index.js, which it never reads. Without this
          // step, edits to agent instructions don't invalidate the
          // re-install-protection cache and silently never reach the
          // DB on a re-install.
          let manifestHash = entry.manifestHash;
          if (existsSync(indexPath)) {
            const indexBytes = readFileSync(indexPath);
            manifestHash = createHash("sha256")
              .update(entry.manifestHash ?? "")
              .update(" ")
              .update(indexBytes)
              .digest("hex");
          }
          enriched.push({ ...candidate, bundleDir, definition, manifestHash });
        }
        defaultAppsCatalog = enriched;
      } catch (err) {
        console.warn(
          "[boringos] failed to load default-app catalog from",
          this.config.defaultAppsDir,
          err,
        );
      }
    }

    // Compose the tenantProvisionedHook: default-apps first, then any
    // host-supplied hook. If the host registered its own hook we still
    // run default-apps before it so the app entries exist when the
    // host's hook runs.
    const userHook = this.tenantProvisionedHook;
    const composedTenantHook =
      defaultAppsCatalog.length > 0 || userHook
        ? async (db: Db, tenantId: string) => {
            if (defaultAppsCatalog.length > 0) {
              try {
                await provisionDefaultApps({
                  db,
                  tenantId,
                  catalog: defaultAppsCatalog,
                  routeRegistry: appRouteRegistry,
                  slotRuntime: installSlotRuntime,
                  events: installEventBus,
                  kernelContext: kernelInstallContext,
                });
              } catch (err) {
                console.warn(
                  "[boringos] default-app provisioning failed for tenant",
                  tenantId,
                  err,
                );
              }
            }
            if (userHook) await userHook(db, tenantId);
            // v2: fire onTenantCreate hooks + write install rows
            // for every default-install module. Runs LAST so any
            // schema/data the user-hook created is in place
            // before module hooks read it.
            if (v2InstallManagerEarly) {
              try {
                await v2InstallManagerEarly.onTenantCreated(tenantId);
              } catch (err) {
                console.warn(
                  "[boringos] v2 onTenantCreated hooks failed for tenant",
                  tenantId,
                  err,
                );
              }
            }
          }
        : v2InstallManagerEarly
          ? async (_db: Db, tenantId: string) => {
              try {
                await v2InstallManagerEarly.onTenantCreated(tenantId);
              } catch (err) {
                console.warn(
                  "[boringos] v2 onTenantCreated hooks failed for tenant",
                  tenantId,
                  err,
                );
              }
            }
          : undefined;

    // Auth routes (login, signup, session)
    const authApp = createAuthRoutes(dbConn.db, jwtSecret, composedTenantHook);
    app.route("/api/auth", authApp);

    // Device auth routes (CLI login)
    const deviceAuthApp = createDeviceAuthRoutes(dbConn.db);
    app.route("/api/auth/device", deviceAuthApp);

    // The host MUST register at least one v2 module (typically
    // createFrameworkModule) for the agent surface to exist —
    // without modules, /api/tools/* serves only 404s.
    if (!v2HasModules) {
      console.warn(
        "[boringos] no v2 modules are registered. " +
          "Agents will have no callable surface. Register createFrameworkModule + " +
          "any other modules you need via app.module(...).",
      );
    }

    // v2 — mount the unified dispatch endpoint + admin views when
    // modules are present. The registries themselves were built
    // earlier (step 5) so the context pipeline could add the v2
    // providers.
    if (v2HasModules && v2InstallManagerEarly) {
      // Backfill install rows for every existing tenant ×
      // default-install module. Idempotent. Fire-and-forget on
      // boot so a slow backfill doesn't block listen().
      void v2InstallManagerEarly.backfill(v2BoundModules).catch((e) => {
        // eslint-disable-next-line no-console
        console.error("[v2] install-manager backfill failed:", e);
      });

      const v2App = createV2Routes({
        db: dbConn.db,
        registry: v2ToolRegistry,
        jwtSecret,
        installManager: v2InstallManagerEarly,
      });
      app.route("/api/tools", v2App);

      const v2AdminApp = createV2AdminRoutes({
        db: dbConn.db,
        toolRegistry: v2ToolRegistry,
        skillRegistry: v2SkillRegistry,
        modules: v2BoundModules,
        installManager: v2InstallManagerEarly,
        resolveTenantId: (req) => req.headers.get("x-tenant-id"),
      });
      app.route("/api/admin/v2", v2AdminApp);
    }

    // Connector routes (v1 actions surface — gated by v2-only flag).
    // The OAuth + webhook pieces of /api/connectors stay mounted so
    // OAuth flows and 3rd-party webhooks keep working — the gating
    // is specifically the actions invocation paths.
    const connectorApp = createConnectorRoutes(dbConn.db, eventBus, jwtSecret, callbackUrl, {
      shellOrigin: this.config.shellOrigin,
    });
    app.route("/api/connectors", connectorApp);

    // Admin API (for human management of the platform)
    const adminKeyValue = this.config.auth?.adminKey ?? jwtSecret;
    // Realtime SSE
    const realtimeBus = createRealtimeBus();
    // Now that the bus exists, connect the workflow engine's event sink.
    realtimeBusRef = realtimeBus;
    // Lazy-populate v2 module factory deps so workflow.run can emit
    // per-block events to the canvas.
    (v2FactoryDeps as { realtimeBus: unknown }).realtimeBus = realtimeBus;

    const adminApp = createAdminRoutes(dbConn.db, agentEngine, adminKeyValue, realtimeBus, v2ToolRegistry, runtimes);
    app.route("/api/admin", adminApp);

    // K10/K11 — apps install/uninstall HTTP endpoints. Mounted with an
    // auth resolver that reads the session token (same pattern as the
    // connector disconnect endpoint) so the shell's Apps screen can
    // call /api/admin/apps/install directly.
    const appsAdminApp = createAppsAdminRoutes({
      db: dbConn.db,
      kernelContext: kernelInstallContext,
      auth: {
        resolve: async (c) => {
          const bearer = c.req
            .header("Authorization")
            ?.replace("Bearer ", "");
          if (!bearer) return null;
          const { sql } = await import("drizzle-orm");
          const result = await dbConn.db.execute(sql`
            SELECT ut.tenant_id, ut.role, ut.user_id
            FROM auth_sessions s
            JOIN user_tenants ut ON ut.user_id = s.user_id
            WHERE s.token = ${bearer} AND s.expires_at > NOW()
            LIMIT 1
          `);
          const row = (
            result as unknown as Array<{
              tenant_id: string;
              role: string;
              user_id: string;
            }>
          )[0];
          if (!row) return null;
          return { tenantId: row.tenant_id, userId: row.user_id, role: row.role };
        },
      },
    });
    app.route("/api/admin/apps", appsAdminApp);
    const sseApp = createSSERoutes(realtimeBus, adminKeyValue);
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

    // Wire engine events to realtime bus
    agentEngine.beforeRun.use((event) => {
      realtimeBus.publish({
        type: "run:started",
        tenantId: event.tenantId,
        data: { runId: event.runId, agentId: event.agentId, taskId: event.taskId },
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

    // 10b. Copilot — v2 only. Browser shell talks to
    // /api/admin/tasks/* (creating tasks with originKind=
    // "copilot") and uses the copilot.start_session tool. The
    // per-tenant copilot agent provisioning still happens here.
    {

      // Auto-create Chief of Staff and Copilot for existing first tenant (backward compat)
      const { tenants: tenantsTable, agents: agentsTable } = await import("@boringos/db");
      const { eq, and } = await import("drizzle-orm");
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

        let cosId = existingCoS[0]?.id;
        if (!cosId && runtimeId) {
          // Create CoS if missing
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

        if (existingCopilot.length === 0 && runtimeId) {
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

    // K7 — installed apps' /api/{appId}/* dispatcher. Mounted LAST so
    // it only catches paths the framework itself didn't claim. The
    // dispatcher is empty at boot; tenant_apps installs add per-app
    // sub-routers via kernelInstallContext.
    appRouteRegistry.attachTo(app);

    // 11. Start HTTP server
    const server = serve({ fetch: app.fetch, port: listenPort });

    // Get the actual port (important when listenPort is 0)
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : listenPort;

    // 13. Start routine scheduler
    const scheduler = createRoutineScheduler(dbConn.db, agentEngine, v2ToolRegistry);
    scheduler.start();

    // Inbox snooze ticker: flips snoozed rows back to unread when their
    // snooze_until elapses. Cheap (one indexed UPDATE every 30s) so
    // wired unconditionally.
    const snoozeTicker = createInboxSnoozeTicker(dbConn.db);
    snoozeTicker.start();

    // Forward sync — ingest new Gmail messages into inbox_items every
    // 30 seconds. Replaces the v1 `gmail.gmail-sync` workflow + routine
    // that the deleted workflow engine used to run.
    //
    // The `onIngest` callback below replaces the v1 `triage-on-inbox`
    // and `draft-on-inbox` workflow templates: those used `create-task`
    // + `wake-agent` blocks which the v2 workflow runner doesn't support
    // yet. Until the runner gains those block kinds, we fan out
    // directly here. The triage/replier agents are looked up by the
    // names the default-app catalog seeds them under.
    const TRIAGE_AGENT_NAMES = new Set([
      "Generic Inbox Triage",
      "Generic Email Replier",
    ]);
    const forwardSyncTicker = createInboxGmailForwardSyncTicker(dbConn.db, {
      eventBus,
      async onIngest(item) {
        const { agents: agentsTable, tasks: tasksTable } = await import("@boringos/db");
        const candidates = await dbConn.db
          .select({ id: agentsTable.id, name: agentsTable.name })
          .from(agentsTable)
          .where(eqOp(agentsTable.tenantId, item.tenantId));
        for (const ag of candidates) {
          if (!TRIAGE_AGENT_NAMES.has(ag.name)) continue;
          const taskId = generateId();
          try {
            await dbConn.db.insert(tasksTable).values({
              id: taskId,
              tenantId: item.tenantId,
              title: `Triage inbox item: ${item.subject}`,
              description:
                `inbox-item-id: ${item.itemId}\n` +
                `source: ${item.source}\n` +
                `from: ${item.from ?? ""}\n` +
                `subject: ${item.subject}\n` +
                `---\n` +
                (item.body ?? ""),
              status: "todo",
              assigneeAgentId: ag.id,
              originKind: "inbox.item_created",
              originId: item.itemId,
            });
          } catch (err) {
            console.warn(
              `[inbox-fanout] failed to create task for agent=${ag.name} item=${item.itemId}:`,
              err instanceof Error ? err.message : err,
            );
            continue;
          }
          try {
            const outcome = await agentEngine.wake({
              agentId: ag.id,
              tenantId: item.tenantId,
              taskId,
              reason: "connector_event",
            });
            if (outcome.kind === "created") {
              await agentEngine.enqueue(outcome.wakeupRequestId);
            }
          } catch (err) {
            console.warn(
              `[inbox-fanout] failed to wake agent=${ag.name} item=${item.itemId}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      },
    });
    forwardSyncTicker.start();

    // Reverse sync — pull state changes from Gmail back into Hebbs
    // every 2 minutes. Skipped silently if no Gmail connector is wired
    // (the ticker iterates connected Gmail tenants; an empty set is a
    // no-op).
    const reverseSyncTicker = createInboxGmailReverseSyncTicker(dbConn.db);
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
        await dbConn.close();
      },
    };
  }
}
