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

// Built-in module factories.
// Register them via `app.module(createFrameworkModule)`.
export { createFrameworkModule } from "./modules/framework.js";
export { createMemoryModule } from "./modules/memory.js";
export { createDriveModule } from "./modules/drive.js";
export { createWorkflowModule } from "./modules/workflow.js";
export { createInboxModule } from "./modules/inbox.js";
export { createSlackModule } from "./modules/slack.js";
export { createGoogleModule } from "./modules/google.js";
export { createCopilotModule } from "./modules/copilot.js";
export { createTriageModule } from "./modules/triage.js";
export { createInboxTriageModule } from "./modules/inbox-triage.js";
export { createInboxReplierModule } from "./modules/inbox-replier.js";

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
export {
  translate as translateCrmLegacyPath,
  createCrmShimRoutes,
  NoLegacyRouteError,
  type Translation as CrmLegacyTranslation,
  type CrmShimDeps,
} from "./crm-shim-routes.js";
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


