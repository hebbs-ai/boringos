export type {
  BoringOSConfig,
  AuthConfig,
  DriveAppConfig,
  LogConfig,
  AppContext,
  ConnectorDefinition,
  SkillDefinition,
  SkillSource,
  PersonaBundle,
  PluginManifest,
  LifecycleHook,
  StartedServer,
  TestInstance,
} from "./types.js";

export { BoringOS } from "./boringos.js";

// v2 (Skills + Tools + Modules) — built-in module factories.
// Hosts opt into v2 by registering them: `app.module(createFrameworkModule)`.
export { createFrameworkModule } from "./v2-modules/framework.js";
export { createMemoryModule } from "./v2-modules/memory.js";
export { createDriveModule } from "./v2-modules/drive.js";
export { createWorkflowModule } from "./v2-modules/workflow.js";
export { createInboxModule } from "./v2-modules/inbox.js";
export { createSlackModule } from "./v2-modules/slack.js";
export { createGoogleModule } from "./v2-modules/google.js";
export { createHebbsCrmModule } from "./v2-modules/hebbs-crm.js";
export { createCopilotModule } from "./v2-modules/copilot.js";
export { createTriageModule } from "./v2-modules/triage.js";

// Re-export key types from sub-packages for convenience
export type { MemoryProvider } from "@boringos/memory";
export type { RuntimeModule, RuntimeRegistry } from "@boringos/runtime";
export type { StorageBackend } from "@boringos/drive";
export type { AgentEngine, ContextProvider } from "@boringos/agent";
// WorkflowEngine + BlockHandler types removed — workflows run
// through the v2 `workflow.run` tool dispatcher now.

export { createAuthMiddleware } from "./auth-middleware.js";
// installDefaultWorkflows + pauseDefaultWorkflows removed —
// drove the v1 BlockHandler engine which no longer exists.
export type { EventBus, ConnectorEvent } from "./event-bus.js";
export { createRealtimeBus } from "./realtime.js";
export type { RealtimeBus, RealtimeEvent, EventType } from "./realtime.js";

export { createNotificationService } from "./notifications.js";

export { createPluginRegistry, createPluginStateStore } from "./plugin-system.js";
export type { PluginDefinition, PluginJob, PluginWebhook, PluginJobContext, PluginStateStore, PluginRegistry } from "./plugin-system.js";
export { githubPlugin } from "./plugins/github.js";
export type { NotificationService, NotificationConfig } from "./notifications.js";

export { nullMemory } from "@boringos/memory";
export { createHebbsMemory } from "@boringos/memory";

export {
  provisionDefaultApps,
  type DefaultAppCatalogEntry,
  type ProvisionDefaultAppsArgs,
} from "./tenant-provisioning.js";

export {
  createAppsAdminRoutes,
  type AppsAdminAuth,
  type CreateAppsAdminRoutesOptions,
} from "./admin/apps.js";
