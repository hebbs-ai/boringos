// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Module SDK — core types for Skills + Tools + Modules.
//
// These are types only. Runtime behaviour (registry, dispatcher,
// HTTP mounts, prompt assembly) lives in @boringos/agent and
// @boringos/core. Everything in this file is greenfield-additive
// — nothing here replaces  types yet. The migration to using
// these as the canonical shape is sequenced in the task_12 phase
// plan.
//
// See docs/blockers/task_12_greenfield_rebuild.md for the full
// architectural rationale.

/**
 * Anything carrying a tenantId. Modules are tenant-scoped via
 * install state; tools and skills are dispatched within a tenant.
 */
export interface TenantContext {
  tenantId: string;
}

/**
 * Context passed to every Tool handler at dispatch time.
 *
 * - `tenantId`: the calling JWT's tenant claim
 * - `agentId`: the calling agent (may be undefined for routine /
 *    workflow / admin invocations)
 * - `runId`: the agent run id, if invoked from a run
 * - `taskId`: the active task id, if any
 *
 * Handlers receive this alongside their validated input. They use
 * it to scope DB queries and audit. Tools that mutate state should
 * read tenantId from this context — never from inputs.
 */
export interface ToolContext {
  tenantId: string;
  agentId?: string;
  runId?: string;
  taskId?: string;
  /**
   * task_23 — the human owner of the wake this dispatch is part of,
   * if any. Plumbed from the callback JWT's `wake_owner_user_id`
   * claim for agent dispatches; from the session user-id for admin
   * dispatches; undefined for routine / cron / internal calls with
   * no human at the origin. Drive ACL uses this to allow agent
   * writes into `users/<wakeOwnerUserId>/` without opening up the
   * whole `users/` namespace.
   */
  wakeOwnerUserId?: string;
  /**
   * Free-form invocation source for audit. Examples:
   * "agent" (HTTP from agent JWT), "routine" (cron),
   * "workflow" (DAG node), "admin" (UI), "internal" (engine).
   */
  invokedBy: ToolInvocationSource;
}

export type ToolInvocationSource =
  | "agent"
  | "routine"
  | "workflow"
  | "admin"
  | "internal";

/**
 * Structured error returned by a tool handler. Tools throw for
 * unexpected bugs; they return `{ ok: false, error }` for expected
 * failures the agent should reason about.
 */
export interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export type ToolErrorCode =
  | "invalid_input"
  | "not_found"
  | "permission_denied"
  | "upstream_unavailable"
  | "rate_limited"
  | "conflict"
  | "internal";

export type ToolResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: ToolError };

/**
 * A single Tool — the universal callable operation.
 *
 * Tools are registered by Modules. They have schema-validated
 * inputs and (optionally) outputs. The framework dispatches them
 * via `POST /api/tools/<module>.<name>` for HTTP callers and via
 * `toolRegistry.invoke()` for in-process callers (workflow nodes,
 * routines).
 *
 * `inputs` and `output` are typed loosely as `unknown` here so
 * this package doesn't take a hard runtime dep on Zod. Callers
 * declare them as Zod schemas in real Modules; the registry uses
 * `safeParse()` at dispatch time.
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  /** Local name within the Module. URL becomes `<module-id>.<name>`. */
  name: string;
  description: string;
  /**
   * Zod schema for inputs. Typed as `unknown` here to avoid a
   * Zod runtime dep at the SDK layer; the registry casts at
   * dispatch.
   */
  inputs: SchemaLike<TInput>;
  /** Optional output schema. */
  output?: SchemaLike<TOutput>;
  /**
   * Method-shorthand declaration so TypeScript treats the
   * parameter types bivariantly. Without this, a handler typed
   * `(input: { foo: string }) => ...` cannot be assigned to a
   * `Tool<unknown>` slot — even though at runtime the dispatcher
   * always passes a Zod-validated value matching the schema.
   * Method shorthand is the standard escape hatch.
   */
  handler(inputs: TInput, ctx: ToolContext): Promise<ToolResult<TOutput>>;
  /** Roles that may call this tool. Empty/undefined = open within tenant. */
  permissions?: string[];
  /** Idempotency mode. "key" requires `Idempotency-Key` header. */
  idempotency?: "none" | "key";
  /** Hint for budget enforcement and routine scheduling. */
  costHint?: "cheap" | "moderate" | "expensive";
  /** Optional examples shown to the agent for non-obvious inputs. */
  examples?: ToolExample<TInput, TOutput>[];
}

export interface ToolExample<TInput = unknown, TOutput = unknown> {
  description: string;
  input: TInput;
  output?: TOutput;
}

/**
 * Minimal schema interface — anything with a `safeParse` method
 * shaped like Zod's. The registry uses this; we don't lock the
 * SDK to Zod specifically.
 */
export interface SchemaLike<T> {
  safeParse(value: unknown): SchemaParseResult<T>;
}

export type SchemaParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues?: unknown; message?: string } };

/**
 * A Skill — markdown teaching, loaded into the agent's prompt
 * under the `## Skills` section.
 *
 * Sources:
 *  - Module-shipped (built-in or installed Module's SKILL.md)
 *  - Persona (a persona Module's role-specific skill)
 *  - Per-agent instructions (the `agents.instructions` column)
 *  - Tenant override (admin-curated replacement for a Module's
 *    bundled skill)
 *
 * Higher priority skills appear later in the prompt, closer to
 * the task — so they have more influence.
 */
export interface Skill {
  /** Unique identifier — by convention `<module-id>` or
   * `<module-id>.<sub-skill>`. */
  id: string;
  /** Where the content originated. */
  source: SkillSource;
  /** The markdown body. Frontmatter is parsed into the other
   * fields before the body lands here. */
  body: string;
  /** Ordering hint within the prompt. Defaults documented in
   * docs/blockers/task_12_greenfield_rebuild.md §9.2. */
  priority?: number;
  /** Optional gating predicate evaluated at prompt-build time. */
  appliesTo?: (event: SkillApplicabilityEvent) => boolean;
  /** Tools this skill teaches. Used at Module load to flag drift
   * (a skill referencing a non-existent tool). */
  requires?: string[];
}

export type SkillSource =
  | "framework"
  | "module"
  | "persona"
  | "agent-instructions"
  | "tenant-override";

export interface SkillApplicabilityEvent {
  tenantId: string;
  agentId: string;
  agentRole?: string;
  taskId?: string;
  taskOriginKind?: string;
}

/**
 * A scheduled Tool call. Three trigger types:
 *
 *  - `cron` — fires on a cron expression (with timezone)
 *  - `event` — fires when a connector / module event matches
 *  - `webhook` — fires when an inbound webhook hits this Module's
 *    namespace
 *
 * The routine specifies which Tool to invoke and the inputs (with
 * optional template substitution from the trigger payload).
 */
export interface Routine {
  id: string;
  title: string;
  trigger: RoutineTrigger;
  /** Fully-qualified tool name to invoke. */
  tool: string;
  /** Static or templated inputs. */
  inputs?: Record<string, unknown>;
  /** What to do when the previous run is still active. */
  concurrency?: "skip_if_active" | "coalesce_if_active" | "allow_concurrent";
  /** Disable without deleting. */
  enabled?: boolean;
}

export type RoutineTrigger =
  | { type: "cron"; expression: string; timezone?: string }
  | { type: "event"; eventType: string; filter?: Record<string, unknown> }
  | { type: "webhook"; event: string };

/**
 * An EventSpec — what events this Module can emit. Other Modules
 * subscribe via routines or `dependsOn` capability resolution.
 */
export interface EventSpec {
  /** Fully-qualified event type, e.g. "gmail.email_received". */
  type: string;
  description: string;
  /** Optional payload schema. */
  payload?: SchemaLike<unknown>;
}

/**
 * An inbound webhook handler. The framework mounts each Module's
 * webhooks under `/api/webhooks/<module-id>/<event>`. Auth is the
 * Module's responsibility — declare a verifier here.
 */
export interface Webhook {
  /** Path segment under the Module's namespace. */
  event: string;
  description: string;
  /** Verifies authenticity. The handler runs only if this
   * returns true. */
  verify: (request: WebhookRequest) => Promise<boolean>;
  /** What to do with a verified webhook. Typically: emit an
   * event, invoke a tool, or write to inbox. */
  handler: (
    request: WebhookRequest,
    ctx: TenantContext,
  ) => Promise<void>;
}

export interface WebhookRequest {
  method: string;
  headers: Record<string, string>;
  body: string;
  query: Record<string, string>;
}

/**
 * OAuth configuration for connector Modules. The framework runs
 * the dance; the Module declares parameters.
 */
export interface OAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: string[];
  /** PKCE on by default. */
  pkce?: boolean;
}

/**
 * A schema migration owned by this Module. Tables created here
 * MUST use the prefix `<module-id>__` — enforced at install time.
 */
export interface Migration {
  /** Unique within the Module — used to track applied state. */
  id: string;
  /** Forward DDL. */
  up: (db: ModuleDb) => Promise<void>;
  /** Reverse DDL. Required for clean uninstall. */
  down: (db: ModuleDb) => Promise<void>;
}

/**
 * Loose DB handle passed to Module migrations and lifecycle
 * hooks. Real implementation is a Drizzle Db; this interface
 * keeps the SDK Drizzle-free.
 */
export interface ModuleDb {
  execute(sql: string): Promise<unknown>;
}

/**
 * UI surface a Module can register with the host shell.
 *
 * The shell imports a Module's React exports at host-app build
 * time and renders nav entries / panels for any tenant that has
 * the Module installed. Component references here are paths or
 * symbolic names; the actual React import happens in the shell.
 */
export interface ModuleUI {
  screens?: ScreenDef[];
  taskPanels?: PanelDef[];
  inboxFilters?: FilterDef[];
  settingsPanels?: PanelDef[];
}

export interface ScreenDef {
  id: string;
  label: string;
  icon?: string;
  /** Path relative to the shell's router, e.g. "/apps/crm/deals". */
  path: string;
  /** Symbolic component name; resolved by the shell at build time. */
  component: string;
}

export interface PanelDef {
  id: string;
  label: string;
  component: string;
  /** Optional condition the shell evaluates before rendering. */
  appliesTo?: Record<string, unknown>;
}

export interface FilterDef {
  id: string;
  label: string;
  component: string;
}

/**
 * Lifecycle hooks the framework invokes around Module install
 * state.
 */
export interface ModuleLifecycle {
  /** Run schema migrations + seed defaults for a tenant. */
  onInstall?: (ctx: ModuleContext) => Promise<void>;
  /** Roll back schema + seeded data. Must be idempotent. */
  onUninstall?: (ctx: ModuleContext) => Promise<void>;
  /** Fires for newly-created tenants if this Module is in the
   * default-install list. Most Modules opt out. */
  onTenantCreate?: (ctx: ModuleContext) => Promise<void>;
}

/**
 * Context passed to lifecycle hooks. Wraps the DB handle, the
 * tenant id, and Module-scoped helpers.
 */
export interface ModuleContext {
  tenantId: string;
  moduleId: string;
  db: ModuleDb;
}

/**
 * Framework services injected into a `ModuleFactory` at boot.
 *
 * Inline `Module` manifests are plain data — but built-in modules
 * (framework / memory / inbox / copilot) and hybrid modules
 * (CRM, support desk, …) need to close over framework services
 * (DB handle, eventually agent engine, etc.) at boot time. They
 * register a factory function instead of a manifest, and the
 * framework calls the factory after services are available.
 *
 * Typed loosely so the SDK doesn't take a Drizzle dep — host
 * narrows to its own concrete types.
 */
export interface ModuleFactoryDeps {
  db: unknown;
  /** The configured MemoryProvider (cast to your concrete type). */
  memory?: unknown;
  /** The configured StorageBackend. */
  drive?: unknown;
  /** The agent engine instance. */
  engine?: unknown;
  /** The workflow engine instance. */
  workflowEngine?: unknown;
  /**
   * The tool registry. Modules that need to invoke other
   * tools internally (workflow.run dispatching DAG nodes, agent
   * orchestration code) cast this to ToolRegistry from
   * `@boringos/agent`.
   */
  toolRegistry?: unknown;
  /**
   * The realtime SSE bus. Modules that emit live events (workflow
   * block_started/completed for the canvas, run progress for the
   * shell) cast this to `RealtimeBus` from `@boringos/core`.
   *
   * Populated lazily by the host — read at call time, not at
   * factory time.
   */
  realtimeBus?: unknown;
  /**
   * The connector / cross-app event bus. Modules cast this to
   * `EventBus` from `@boringos/core`. Read at call time so module
   * factories don't need to resolve before the host has built the
   * bus.
   */
  eventBus?: unknown;
  /**
   * Get a token handle for the connector account bound to the calling module.
   * Returns null if no account is connected or bound. The returned handle's
   * getToken() refreshes transparently on expiry.
   *
   * `provider` is the connector provider id (e.g. "google", "slack").
   * `callerModuleId` is your module's own id — written to the audit table.
   * Self-reported; pass your own manifest id (e.g. "executive-assistant").
   *
   * The tenant is resolved from the ambient tool-call context (AsyncLocalStorage)
   * so it does not appear in this signature. Calling this outside a dispatched
   * tool handler throws.
   */
  getConnectorToken?: (
    provider: string,
    callerModuleId: string,
    opts?: { accountId?: string },
  ) => Promise<ConnectorTokenHandle | null>;
  listConnectedAccounts?: (provider: string) => Promise<ConnectedAccount[]>;
  checkScopes?: (
    provider: string,
    scopes: string[],
    opts?: { accountId?: string },
  ) => Promise<ScopeCheckResult>;
}

export type ModuleFactory = (deps: ModuleFactoryDeps) => Module;

/**
 * `dependsOn` entry. Either concrete (specific module id) or
 * abstract (any module that announces a capability).
 */
export type ModuleDependency =
  | { moduleId: string; optional?: boolean }
  | { capability: string; optional?: boolean };

/**
 * The author's hint for how this Module should be grouped in UI.
 *
 *  - `"connector"` — primarily brokers a 3rd-party service (owns
 *    `oauth`, raw API tools); shown under Settings → Connectors.
 *  - `"module"` — primarily owns data + logic (`schema`, tools);
 *    shown under Apps → Modules.
 *  - `"hybrid"` — both: owns its own data AND brokers a 3rd-party
 *    integration.
 *
 * Purely a UI grouping hint. Dispatch / install / uninstall
 * behaviour is identical regardless of `kind`. See
 * `inferModuleKind` for the inference rule used when the field is
 * omitted.
 */
export type ModuleKind = "connector" | "module" | "hybrid";

/**
 * The Module manifest — the universal component shape.
 *
 * Three roles, same shape, different fields populated:
 *
 *  - **Connector module**: owns `oauth` + raw API tools
 *  - **Capability module**: declares `dependsOn`, no `oauth`
 *  - **Hybrid module**: owns `schema` + tools + may have `oauth`
 *
 * All registered via the same verb: `app.module(myModule)`.
 */
export interface Module {
  /** Stable id — lowercase, hyphen-separated. */
  id: string;
  /** Human-friendly name. */
  name: string;
  /** Semver. */
  version: string;
  /** One sentence. */
  description: string;
  /**
   * The author's hint for UI grouping. Optional — the framework
   * infers when missing: `oauth && !schema → "connector"`,
   * `schema && !oauth → "module"`, both → `"hybrid"`. Dispatch /
   * install / uninstall behaviour is identical regardless.
   */
  kind?: ModuleKind;
  /** Other Modules required for this one to function. */
  dependsOn?: ModuleDependency[];
  /** Capability labels this Module announces. */
  provides?: string[];
  /** SKILL.md files (path strings or inline `Skill` objects). */
  skills?: SkillFileRef[];
  /** Tools registered with the framework's tool registry. */
  tools?: Tool[];
  /** Default workflow definitions seeded on install. */
  workflows?: WorkflowSeed[];
  /** Default agents seeded on install. */
  agents?: AgentSeed[];
  /** Cron / event / webhook routines seeded on install. */
  routines?: Routine[];
  /** Events this Module can emit. */
  events?: EventSpec[];
  /** Inbound webhooks. Mounted at `/api/webhooks/<id>/<event>`. */
  webhooks?: Webhook[];
  /** Required for connector modules brokering a 3rd party. */
  oauth?: OAuthConfig;
  /** DDL the Module owns. Tables MUST be prefixed `<id>__`. */
  schema?: Migration[];
  /** Browser-facing surface registered with the shell. */
  ui?: ModuleUI;
  /** Install / uninstall / tenant-create hooks. */
  lifecycle?: ModuleLifecycle;
  /** Default permissions; per-tool overrides allowed. */
  permissions?: ModulePermissions;
  /**
   * Tenant-level settings this module contributes to the host's
   * settings manifest. The shell auto-renders each declared key in
   * Settings → General. See task_17_tenant_settings_manifest.md.
   */
  settings?: import("@boringos/shared").SettingDefinition[];
  /**
   * Whether this module should be auto-installed for every
   * tenant at boot (and for new tenants via `onTenantCreate`).
   *
   * Defaults to `true`. The boolean flag is backwards
   * compatible — every host-registered module is callable for
   * every existing tenant immediately. Third-party modules that
   * should require explicit per-tenant install set this to
   * `false`.
   */
  defaultInstall?: boolean;
  /**
   * Filesystem directory the framework should treat as the
   * module's "home" for resolving relative paths in
   * `skills: ["./SKILL.md"]`. Set by the module's factory using
   * `dirname(fileURLToPath(import.meta.url))`. If unset, string
   * skill refs fall back to relative-to-cwd, which is rarely
   * what you want; setting this is highly recommended for any
   * module that ships SKILL.md files.
   */
  __moduleDir?: string;
  /**
   * Advisory declaration of which connectors and services this module uses.
   * Used by the host for pre-install UI display (e.g., "this module uses Gmail and Calendar").
   * Runtime checkScopes is authoritative; this field does NOT gate access.
   */
  connectors?: Record<string, {
    services: ServiceDefinition[];
  }>;
}

export type SkillFileRef =
  | string                // path to SKILL.md relative to package
  | Skill;                // inline declaration

export interface ModulePermissions {
  /** Roles that can call any of this Module's tools by default. */
  defaultRoles?: string[];
}

/**
 * A workflow definition seeded by a Module's install hook. Same
 * shape as a tenant-edited workflow; the Module ships defaults,
 * tenants can edit/disable in the visual editor.
 */
export interface WorkflowSeed {
  name: string;
  description?: string;
  /** DAG nodes — see docs/blockers/task_12_greenfield_rebuild.md
   * §13b.3 for the full schema. */
  blocks: WorkflowBlock[];
  edges: WorkflowEdge[];
  trigger?: RoutineTrigger;
}

export interface WorkflowBlock {
  id: string;
  kind:
    | "trigger"
    | "tool"
    | "condition"
    | "for_each"
    | "delay"
    | "transform"
    | "branch";
  /** Required when kind is "tool". Fully-qualified tool name. */
  tool?: string;
  /** Tool inputs (kind="tool") with optional `{{nodeId.field}}`
   * template references. */
  inputs?: Record<string, unknown>;
  /** Per-kind config for control-flow blocks. */
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  /** For condition blocks: "true" | "false". */
  sourceHandle?: string;
}

/**
 * An agent template seeded by a Module's install hook.
 */
export interface AgentSeed {
  name: string;
  /** Persona module id, e.g. "personas-default.sales-rep". */
  persona: string;
  instructions?: string;
  /** Tools this agent is permitted to call. */
  tools?: string[];
  /** Optional reportsTo target by name. */
  reportsTo?: string;
}

/**
 * Resolve the effective `ModuleKind` for a manifest.
 *
 * Honours `mod.kind` if set; otherwise infers:
 *   - `oauth && !schema` → `"connector"`
 *   - `schema && !oauth` → `"module"`
 *   - both present       → `"hybrid"`
 *   - neither present    → `"module"` (capability modules count
 *                          as plain modules for grouping)
 *
 * Used by the shell for grouping (Settings → Connectors vs Apps →
 * Modules) and by `module.json` generation when packing
 * `.hebbsmod` bundles.
 */
export function inferModuleKind(mod: Module): ModuleKind {
  if (mod.kind) return mod.kind;
  const hasOauth = !!mod.oauth;
  const hasSchema = !!mod.schema && mod.schema.length > 0;
  if (hasOauth && hasSchema) return "hybrid";
  if (hasOauth) return "connector";
  return "module";
}

// ============================================================
// Connector SDK contract (v2)
// ============================================================

export interface OAuth2Strategy {
  type: "oauth2";
  authorizationUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  pkce?: boolean;
  accessType?: string;
  prompt?: string;
}

export interface ApiKeyStrategy {
  type: "api-key";
  headerName?: string;
  prefix?: string;
}

export interface BotTokenStrategy {
  type: "bot-token";
  tokenUrl?: string;
}

export interface PatStrategy {
  type: "pat";
  headerName?: string;
}

export type AuthStrategy = OAuth2Strategy | ApiKeyStrategy | BotTokenStrategy | PatStrategy;

export interface ScopeDefinition {
  scope: string;
  description: string;
  required: boolean;
}

export interface ServiceDefinition {
  id: string;
  displayName: string;
  scopes: ScopeDefinition[];
}

export interface ConnectorDefinition {
  provider: string;
  displayName: string;
  icon?: string;
  version?: number;
  auth: AuthStrategy[];
  services: ServiceDefinition[];
  resolveAccountId(tokenResponse: Record<string, unknown>): string;
}

export interface ConnectedAccount {
  accountId: string;
  provider: string;
  grantedScopes: string[];
  status: "active" | "expired" | "revoked";
}

export interface ConnectorTokenHandle {
  getToken: () => Promise<string>;
}

export interface ScopeCheckResult {
  granted: boolean;
  missing: string[];
  consentUrl?: string;
}
