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
import {
  createWorkflowEngine,
  createWorkflowStore,
  createWorkflowRunStore,
  createHandlerRegistry,
  triggerHandler,
  conditionHandler,
  delayHandler,
  transformHandler,
  wakeAgentHandler,
  connectorActionHandler,
  forEachHandler,
  createInboxItemHandler,
  emitEventHandler,
  queryDatabaseHandler,
  updateRowHandler,
  createTaskHandler,
  waitForHumanHandler,
  invokeWorkflowHandler,
} from "@boringos/workflow";
import type { WorkflowEngine, BlockHandler } from "@boringos/workflow";
import {
  createConnectorRegistry,
  createEventBus,
  createActionRunner,
} from "@boringos/connector";
import type { ConnectorDefinition as ConnectorDef } from "@boringos/connector";
import type {
  BoringOSConfig,
  AppContext,
  ConnectorDefinition,
  PersonaBundle,
  PluginManifest,
  LifecycleHook,
  StartedServer,
} from "./types.js";
import { createCallbackRoutes } from "./routes.js";
import { createV2Routes } from "./v2-routes.js";
import {
  createToolRegistry,
  createSkillRegistry,
  createModuleRegistry,
  createSkillsProvider,
  createToolCatalogProvider,
} from "@boringos/agent";
import type {
  ToolRegistry as V2ToolRegistry,
  SkillRegistry as V2SkillRegistry,
  ModuleRegistry as V2ModuleRegistry,
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
import { createCopilotRoutes } from "./copilot-routes.js";
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
  private connectorDefs: ConnectorDef[] = [];
  private beforeStartHooks: LifecycleHook[] = [];
  private afterStartHooks: LifecycleHook[] = [];
  private beforeShutdownHooks: LifecycleHook[] = [];
  private extraRoutes: Array<{ path: string; app: Hono; agentDocs?: string | ((callbackUrl: string) => string) }> = [];
  private blockHandlers: BlockHandler[] = [];
  private queueAdapter: QueueAdapter<AgentRunJob> | undefined;
  private userSchemaStatements: string[] = [];
  private inboxRoutes: Array<{ filter: (event: Record<string, unknown>) => boolean; transform: (event: Record<string, unknown>) => { source: string; subject: string; body?: string; from?: string; assigneeUserId?: string } }> = [];
  private tenantProvisionedHook: ((db: Db, tenantId: string) => Promise<void>) | undefined;
  private eventHandlers: Array<{ type: string | null; handler: (event: import("@boringos/connector").ConnectorEvent) => void | Promise<void> }> = [];
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

  connector(definition: ConnectorDef): this {
    this.connectorDefs.push(definition);
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

  blockHandler(handler: BlockHandler): this {
    this.blockHandlers.push(handler);
    return this;
  }

  onEvent(type: string | null, handler: (event: import("@boringos/connector").ConnectorEvent) => void | Promise<void>): this {
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

    // Resolve apiCatalog lazily so routes registered in `beforeStart` hooks
    // (which run after engine creation) are still picked up. Walks BOTH
    // sources: statically-mounted host routes (`app.route(...)`) and
    // routes registered via the install pipeline (default apps,
    // user-installed apps). Without the install-pipeline source, an
    // app like the CRM that ships agentDocs would never reach the
    // agent's prompt — see task_07.
    let installedAppRouteRegistry: AppRouteRegistry | undefined;
    const apiCatalog = () => {
      const fromExtras = this.extraRoutes
        .filter((r) => r.agentDocs)
        .map((r) => ({ path: r.path, agentDocs: r.agentDocs! }));
      const fromInstalled = installedAppRouteRegistry?.getCatalog() ?? [];
      return [...fromExtras, ...fromInstalled];
    };

    // If the app didn't register a queue adapter, spin up the default
    // in-process one here so we can honor `config.queue.concurrency`. The
    // engine's own fallback doesn't know about app config.
    const resolvedQueue =
      this.queueAdapter ??
      createInProcessQueue<AgentRunJob>({ concurrency: this.config.queue?.concurrency });

    // Connector registry is created here (early) so the agent engine
    // can pass it into the connector-actions catalog provider. The
    // actual `register()` calls and actionRunner construction happen
    // later (alongside event-bus setup) — but the registry reference
    // is stable, so by the time an agent wakes the registry is fully
    // populated and the provider's `list()` returns everything.
    const connectorRegistry = createConnectorRegistry();

    const agentEngine = createAgentEngine({
      db: dbConn.db,
      runtimes,
      memory: this.memoryProvider,
      drive,
      pipeline,
      callbackUrl,
      jwtSecret,
      queue: resolvedQueue,
      apiCatalog,
      connectorRegistry,
    });

    // 7. Build workflow engine
    const handlerRegistry = createHandlerRegistry();
    handlerRegistry.register(triggerHandler);
    handlerRegistry.register(conditionHandler);
    handlerRegistry.register(delayHandler);
    handlerRegistry.register(transformHandler);
    handlerRegistry.register(wakeAgentHandler);
    handlerRegistry.register(connectorActionHandler);
    handlerRegistry.register(forEachHandler);
    handlerRegistry.register(createInboxItemHandler);
    handlerRegistry.register(emitEventHandler);
    handlerRegistry.register(queryDatabaseHandler);
    handlerRegistry.register(updateRowHandler);
    handlerRegistry.register(createTaskHandler);
    handlerRegistry.register(waitForHumanHandler);
    handlerRegistry.register(invokeWorkflowHandler);
    for (const handler of this.blockHandlers) {
      handlerRegistry.register(handler);
    }

    const workflowStore = createWorkflowStore(dbConn.db);
    const workflowRunStore = createWorkflowRunStore(dbConn.db);
    const memoryRef = this.memoryProvider;
    // Lazy service map — allows services registered after workflow engine creation
    // (e.g., actionRunner, connectorRegistry) to be available to block handlers.
    const serviceMap: Record<string, unknown> = { db: dbConn.db, memory: memoryRef, drive, agentEngine };
    // Forward-declare realtimeBus so we can close over it; the bus itself is
    // created below at step 10. The closure reads it lazily so initialization
    // order doesn't matter.
    let realtimeBusRef: import("./realtime.js").RealtimeBus | null = null;
    const workflowEngine = createWorkflowEngine({
      store: workflowStore,
      runStore: workflowRunStore,
      handlers: handlerRegistry,
      services: {
        get<T>(key: string): T | undefined {
          return serviceMap[key] as T | undefined;
        },
        has(key: string): boolean {
          return key in serviceMap;
        },
      },
      // Publish every engine event to the RealtimeBus so SSE consumers (the
      // live DAG view in the CRM) get pushed updates instead of polling.
      onEvent: (event) => {
        realtimeBusRef?.publish({
          type: `workflow:${event.type}`,
          tenantId: event.tenantId,
          data: event as unknown as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        });
      },
    });
    // Expose the engine itself in the service map so invoke-workflow blocks
    // can recursively call engine.execute on another workflow. Must set
    // after engine creation — the service map is consulted lazily.
    serviceMap.workflowEngine = workflowEngine;

    // 8. Build app context (eventBus added after creation below)
    const context: AppContext = {
      config: this.config,
      db: dbConn.db,
      memory: this.memoryProvider,
      drive,
      runtimes,
      agentEngine,
      workflowEngine,
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
    for (const def of this.connectorDefs) {
      connectorRegistry.register(def);
    }
    const actionRunner = createActionRunner(connectorRegistry);
    // Make actionRunner available to workflow block handlers (connector-action)
    serviceMap.actionRunner = actionRunner;
    serviceMap.connectorRegistry = connectorRegistry;
    serviceMap.eventBus = eventBus;

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
            // Fire-and-forget — the run is persisted, results visible in the UI.
            await workflowEngine.execute(w.id, {
              type: "event",
              data: { ...(event.data ?? {}), eventType: event.type },
            }).catch((err) => {
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
    // Now that the registry exists, point the lazy apiCatalog getter
    // at it so installed apps' agentDocs reach the agent prompt.
    installedAppRouteRegistry = appRouteRegistry;
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
          }
        : undefined;

    // Auth routes (login, signup, session)
    const authApp = createAuthRoutes(dbConn.db, jwtSecret, composedTenantHook);
    app.route("/api/auth", authApp);

    // Device auth routes (CLI login)
    const deviceAuthApp = createDeviceAuthRoutes(dbConn.db);
    app.route("/api/auth/device", deviceAuthApp);

    // Agent callback API
    const callbackApp = createCallbackRoutes(dbConn.db, agentEngine, jwtSecret);
    app.route("/api/agent", callbackApp);

    // v2 — mount the unified dispatch endpoint when modules are
    // present. The registries themselves were built earlier (step 5)
    // so the context pipeline could add the v2 providers.
    if (v2HasModules) {
      const v2App = createV2Routes({
        db: dbConn.db,
        registry: v2ToolRegistry,
        jwtSecret,
      });
      app.route("/api/tools", v2App);
    }

    // Connector routes
    const connectorApp = createConnectorRoutes(dbConn.db, connectorRegistry, eventBus, actionRunner, jwtSecret, callbackUrl, {
      shellOrigin: this.config.shellOrigin,
    });
    app.route("/api/connectors", connectorApp);

    // Admin API (for human management of the platform)
    const adminKeyValue = this.config.auth?.adminKey ?? jwtSecret;
    // Realtime SSE
    const realtimeBus = createRealtimeBus();
    // Now that the bus exists, connect the workflow engine's event sink.
    realtimeBusRef = realtimeBus;

    const adminApp = createAdminRoutes(dbConn.db, agentEngine, adminKeyValue, realtimeBus, workflowEngine, runtimes, actionRunner);
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

      // Auto-re-wake: if agent has remaining 'todo' tasks assigned to
      // it, wake on the next one — but ONLY when the current run
      // succeeded. Rewaking after a failed run just replays the same
      // failure (~500 wakes in 30 min observed). The next user-
      // initiated wake will pick up the todos normally once the
      // underlying issue clears.
      //
      // Sessions are task-scoped, so the wake must target a specific
      // task (the oldest pending one).
      if (event.result.exitCode === 0) {
        try {
          const { sql } = await import("drizzle-orm");
          // Skip the task we just finished. If it's still `todo`, the
          // agent didn't make progress — re-waking on it just loops
          // (BOS-003 hit this with 275 wakes in 23 min). The next
          // external trigger (user comment, routine, assign) picks it
          // up. Other todos for the agent still drain normally.
          const justFinishedTaskId = event.taskId ?? "";
          const nextTaskRows = await dbConn.db.execute(sql`
            SELECT id FROM tasks
            WHERE assignee_agent_id = ${event.agentId}
              AND tenant_id = ${event.tenantId}
              AND status = 'todo'
              AND id <> ${justFinishedTaskId}::uuid
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

    // 10b. Copilot routes — multi-tenant (resolves tenant from session)
    {
      const copilotApp = createCopilotRoutes(dbConn.db, agentEngine);
      app.route("/api/copilot", copilotApp);

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
    const scheduler = createRoutineScheduler(dbConn.db, agentEngine, workflowEngine);
    scheduler.start();

    // Inbox snooze ticker: flips snoozed rows back to unread when their
    // snooze_until elapses. Cheap (one indexed UPDATE every 30s) so
    // wired unconditionally.
    const snoozeTicker = createInboxSnoozeTicker(dbConn.db, { actionRunner });
    snoozeTicker.start();

    // Reverse sync — pull state changes from Gmail back into Hebbs
    // every 2 minutes. Skipped silently if no Gmail connector is wired
    // (the ticker iterates connected Gmail tenants; an empty set is a
    // no-op).
    const reverseSyncTicker = createInboxGmailReverseSyncTicker(dbConn.db, actionRunner);
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
