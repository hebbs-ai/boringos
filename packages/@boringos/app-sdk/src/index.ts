// SPDX-License-Identifier: MIT
//
// @boringos/app-sdk — public SDK for building apps and connectors on BoringOS.

/**
 * SDK version. Bumped per Phase 1 / Phase 2 / Phase 3 contract changes.
 * Stays in alpha until Phase 2 (CRM port) validates the contract; promotes
 * to beta once a second app validates it; goes to stable 1.0.0 thereafter.
 */
export const SDK_VERSION = "1.0.0-alpha.0" as const;

/* ── Manifest types (TASK-B2) ──────────────────────────────────────── */

export type {
  Manifest,
  BaseManifest,
  PublisherInfo,
  Capability,

  // Connector
  ConnectorManifest,
  AuthConfig,
  OAuth2AuthConfig,
  ApiKeyAuthConfig,
  ApiKeyField,
  CustomAuthConfig,
  EventDeclaration,
  ActionDeclaration,
  WebhookDeclaration,

  // App
  AppManifest,
  EntityTypeDeclaration,
  UIManifest,
  NavEntryDeclaration,
  EntityActionDeclaration,
  AppDependency,
} from "./manifest.js";

/* ── Builder helpers (TASK-B3) ─────────────────────────────────────── */

export { defineConnector } from "./define-connector.js";
export type {
  ConnectorDefinition,
  ConnectorOAuthConfig,
  ConnectorEventDefinition,
  ConnectorActionDefinition,
  ConnectorActionField,
  ConnectorCredentials,
  ConnectorClient,
  ConnectorActionResult,
  ConnectorSetupContext,
  ConnectorWebhookRequest,
  ConnectorWebhookResponse,
} from "./define-connector.js";

export { defineApp } from "./define-app.js";
export type {
  AppDefinition,
  AgentDefinition,
  WorkflowTemplate,
  ContextProvider,
  RouteRegistrar,
  AppSettingDefinition,
} from "./define-app.js";

export { defineUI } from "./define-ui.js";
export type { UIDefinition } from "./define-ui.js";

/* ── Lifecycle types (TASK-B4) ─────────────────────────────────────── */

export type {
  Logger,
  Database,
  LifecycleContext,
  UpgradeLifecycleContext,
  LifecycleHook,
  UpgradeHook,
} from "./lifecycle.js";

/* ── Runtime context types (TASK-B4) ───────────────────────────────── */

export type {
  CallerIdentity,
  ActionContext,
  ToolContext,
  CommandContext,
  ContextBuildContext,
  ContextProviderOutput,
  StructuredContext,
  JSONSchema,
} from "./context.js";

/* ── Slot interfaces (TASK-B4) ─────────────────────────────────────── */

export type {
  SlotComponent,
  Entity,

  NavSlot,
  DashboardWidget,
  EntityAction,
  EntityDetailPanel,
  SettingsPanel,
  CommandAction,
  CopilotTool,
  InboxHandler,
  InboxItem,
  InboxItemAction,
} from "./slots.js";

/* ── Manifest validation (TASK-D1) ─────────────────────────────────── */

export {
  validateManifest,
  isValidManifest,
  isConnectorManifest,
  isAppManifest,
  MANIFEST_SCHEMA,
} from "./validate.js";

export type { ValidationResult, ValidationError } from "./validate.js";

/* ── Branding (TASK-A9) ────────────────────────────────────────────── */

export type { Brand, PartialBrand } from "./branding.js";
