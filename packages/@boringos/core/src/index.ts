export type {
  BoringOSConfig,
  AuthConfig,
  DriveAppConfig,
  LogConfig,
  AppContext,
  SkillDefinition,
  SkillSource,
  PersonaBundle,
  PluginManifest,
  LifecycleHook,
  StartedServer,
  TestInstance,
} from "./types.js";
// The canonical ConnectorDefinition lives in @boringos/module-sdk now.
// Re-export it here for convenience so consumers of @boringos/core can
// continue importing ConnectorDefinition from the same module.
export type { ConnectorDefinition } from "@boringos/module-sdk";

export { BoringOS } from "./boringos.js";

// Built-in module factories.
// Register them via `app.module(createFrameworkModule)`.
export { createFrameworkModule } from "./modules/framework.js";
export { createMemoryModule } from "./modules/memory.js";
export { createDriveModule } from "./modules/drive.js";
export { createWorkflowModule } from "./modules/workflow.js";
export { createInboxModule } from "./modules/inbox.js";
export { AuthManager } from "./auth-manager.js";
export { tenantContext, requireTenantId } from "./tenant-context.js";
export { createCopilotModule } from "./modules/copilot.js";
export { createTriageModule } from "./modules/triage.js";
export { createInboxTriageModule } from "./modules/inbox-triage.js";
export { createInboxReplierModule } from "./modules/inbox-replier.js";
export { createGoogleModule } from "./modules/google.js";
export { createSlackModule } from "./modules/slack.js";

// Re-export key types from sub-packages for convenience
export type { MemoryProvider } from "@boringos/memory";
export type { RuntimeModule, RuntimeRegistry } from "@boringos/runtime";
export type { StorageBackend } from "@boringos/drive";
export type { AgentEngine, ContextProvider } from "@boringos/agent";
// Workflows run through the workflow.run tool dispatcher.

export { createAuthMiddleware } from "./auth-middleware.js";
export type { EventBus, ConnectorEvent } from "./event-bus.js";
export {
  classifyAutomatedMail,
  extractEmailAddress,
  type AutomatedClassification,
  type AutomatedKind,
} from "./automated-mail.js";
export { buildIngestMetadata } from "./inbox-gmail-forward-sync.js";
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
  verifyModuleSignature,
  loadTrustedPublishers,
} from "./module-signature.js";

export {
  createModuleUiRoutes,
  resolveAssetPath as resolveModuleUiAssetPath,
  cacheControlFor as moduleUiCacheControlFor,
} from "./module-ui-routes.js";
export type {
  PublisherKey,
  SignatureVerifyResult,
  VerifyOptions,
} from "./module-signature.js";


