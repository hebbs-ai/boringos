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

// Re-export key types from sub-packages for convenience
export type { MemoryProvider } from "@boringos/memory";
export type { RuntimeModule, RuntimeRegistry } from "@boringos/runtime";
export type { StorageBackend } from "@boringos/drive";
export type { AgentEngine, ContextProvider } from "@boringos/agent";
export type { WorkflowEngine, BlockHandler } from "@boringos/workflow";

export { createAuthMiddleware } from "./auth-middleware.js";
export {
  installDefaultWorkflows,
  pauseDefaultWorkflows,
} from "./connectors/post-connect.js";
export type { EventBus, ConnectorEvent } from "@boringos/connector";
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
