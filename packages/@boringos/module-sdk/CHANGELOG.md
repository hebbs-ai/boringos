# @boringos/module-sdk

## 0.12.0

### Minor Changes

- d1695e0: Seed upgrade policy via `__seed_meta` + content hashes (MDK T7.2).

  - `@boringos/db` — new `__seed_meta` table (and Drizzle export) tracking every framework-seeded agent / workflow / routine per tenant. Columns: `tenant_id`, `module_id`, `kind`, `seed_id`, `target_id`, `baseline_hash`, `module_version`. Unique on `(tenant_id, module_id, kind, seed_id)`; secondary index on `target_id` for reverse lookups.
  - `@boringos/module-sdk` — `AgentSeed`, `WorkflowSeed`, and `Routine` gain optional `seedId` (defaults to name / title / id) so authors can rename a seed without losing the upgrade thread.
  - `@boringos/agent` — `runSeed` now compares the current row's canonical-JSON hash against `__seed_meta.baseline_hash` to decide what to do on re-install:
    - Hash matches baseline AND payload changed → update the row + bump the meta.
    - Hash matches baseline AND payload unchanged → skip (no churn).
    - Hash differs from baseline → tenant edited; skip and leave their edit alone.
  - The "modified_since_install" check is implicit: no extra column on the seed target. The framework compares hashes at re-install time, so tenant edits via any path (admin API, manual SQL, future tools) are honoured without the framework having to remember to set a flag.

  Acceptance test (`tests/seed-upgrade-policy.test.ts`): tenant edits a routine, author bumps the seed, the tenant's edit survives. Companion test: untouched routine gets upgraded.

### Patch Changes

- @boringos/drive@0.1.10

## 0.11.0

### Minor Changes

- 0fe25a1: Lifecycle.seed + declarative auto-seed (MDK T7.1).

  - `@boringos/module-sdk` — new `Lifecycle.seed(ctx, { agents, workflows, routines, custom })` helper. Authors call it from `onInstall` when seeding needs preconditions (e.g. a fetched runtime id, a `reportsTo` chain). `ModuleContext` gains an optional `seed` method the framework provisions; calling `Lifecycle.seed` outside a lifecycle hook throws cleanly. New types: `SeedPayload`, `SeedResult`, `SeedFn`, `LifecycleContext`.
  - `@boringos/agent` — install-manager auto-seeds the manifest-level `agents` / `workflows` / `routines` collections after `onInstall` returns, and again on `onTenantCreated`. Idempotency keys: agents `(tenantId, source_app_id=<id>, name)` (with `source='app'` to satisfy `agents_source_app_id_check`); workflows `(tenantId, type='module:<id>', name)`; routines `(tenantId, title)`. Seeded agents default `reportsTo` to the tenant's existing root so the `agents_tenant_one_root_idx` unique stays satisfied. Routine non-cron triggers are skipped for now — T7.3 wires event/webhook routines via the inbox-source / events surfaces.
  - `MODULES.md` — new "Seeding agents / workflows / routines" section covering both paths with a worked example.

  CRM still ships its own seeder. T8.3 moves CRM onto this helper.

## 0.10.0

### Minor Changes

- efba86b: Make `PluginUI` (from `@boringos/ui`) the canonical UI contract that the SDK re-exports — module authors get all 7 slot types (`navItems`, `dashboardWidgets`, `entityPanels`, `entityActions`, `settingsPanels`, `copilotTools`, `inboxFilters`) plus `PluginElement`, `NavItem`, `EntityActionContext`, `DashboardWidgetSize`, `DashboardWidgetSlot` with one import. `@boringos/ui` is now an **optional** peer dependency — modules that don't ship a UI don't need it installed.

  The legacy `ModuleUI` server-side type (symbolic component names, only 4 fields) is kept for backward compatibility but marked `@deprecated`; new modules should ship a separate web bundle exporting `<id>UI: PluginUI` and point `module.json`'s `ui.entry` / `ui.sourcePath` at it. MDK T3.2.

## 0.9.0

### Minor Changes

- 88c018d: Extract a narrow `ToolRegistry` interface (`get` / `list` / `listByModule`) plus `RegisteredTool` into `@boringos/module-sdk`; type `ModuleFactoryDeps.toolRegistry` with it. Replaces the pre-MDK `unknown` cast pattern. The agent's concrete `ToolRegistry` in `@boringos/agent` keeps the wider `register` / `unregisterModule` / `listByCapability` surface for host-side use and structurally implements the SDK's read-only view. Completes the T3.1 sub-task ladder (`memory`, `drive`, `realtimeBus`, `eventBus`, `toolRegistry` now all typed). MDK T3.1d.

## 0.8.0

### Minor Changes

- 4a204a5: Extract a narrow `EventBus` interface (just `emit(event)`) plus the `ConnectorEvent` shape into `@boringos/module-sdk`; type `ModuleFactoryDeps.eventBus` with it. Replaces the pre-MDK `unknown` cast pattern. The host's concrete bus in `@boringos/core` keeps the wider `on`/`onAny`/`off` surface for in-process subscribers and structurally implements the SDK interface for module-facing use. CRM's local `CrmEventBus` shim is now redundant and can be retired in Phase 8 / T8.1. MDK T3.1c.

## 0.7.0

### Minor Changes

- 09fb6b7: Extract a narrow `RealtimeBus` interface (just `publish(event)`) plus the `RealtimeEvent` shape into `@boringos/module-sdk`; type `ModuleFactoryDeps.realtimeBus` with it. Replaces the pre-MDK `unknown` cast pattern and fixes the doc-comment drift (the old comment said "emit" — the method is actually `publish`). `@boringos/core`'s concrete realtime bus implements the new interface structurally; no behaviour change. MDK T3.1b.

## 0.6.0

### Minor Changes

- 097883c: Type `ModuleFactoryDeps.memory` as `MemoryProvider` (from `@boringos/memory`) and `ModuleFactoryDeps.drive` as `StorageBackend` (from `@boringos/drive`) — replacing the pre-MDK `unknown` casts (MDK T3.1a, per the T0.4 audit). Both packages are declared as **optional** peer dependencies (`peerDependenciesMeta.optional: true`), so modules that don't consume memory or storage don't need to install them. Cycle-free: neither package depends on `@boringos/module-sdk`.

## 0.5.0

### Minor Changes

- 299ccc3: Add `ManifestSchema` (a zod schema for `module.json`) and helpers `parseManifest`, `compareSemver`, `checkMinFrameworkVersion`, plus the `MODULE_ID_RE` / `SEMVER_RE` constants (MDK T2.2). Replaces the ad-hoc field-by-field validation that lived inside `pack-hebbsmod`. Third-party scaffolders and the host install-manager now have a single typed entry point for `module.json` validation, including the `minFrameworkVersion` install-time compatibility gate.

## 0.4.0

### Minor Changes

- bed93db: `pack-hebbsmod` now derives the bundled `module.json` from the Module factory at pack time (MDK T2.1). Runtime fields (`id`, `name`, `version`, `description`, `kind`, `dependsOn`, `provides`, `defaultInstall`) come from the factory's returned Module; pack-time-only fields (`entry`, `ui`, `publisher`, `license`, `minFrameworkVersion`) come from the on-disk static `module.json` unchanged. Drift between the two is logged on stdout. Exports a new `mergeManifest(static, runtime)` helper for callers who need the merge logic standalone.

## 0.3.0

### Minor Changes

- a4ca940: Add `requiredScopes: ScopeDefinition[]` to `ConnectorDefinition` (closes the `profileService` hidden-service hack in `@boringos/connector-google`). `AuthManager.startOAuthFlow` now merges connector-required identity scopes with caller-requested service scopes (deduped) so any `ConnectorDefinition` can declare always-on OAuth scopes without piggybacking on the services flattener. `googleConnector` switches from `services: [profileService, …]` to `requiredScopes: PROFILE_SCOPES`; the `profileService` export is removed (it had no external consumers). Backward compatible: existing connectors without `requiredScopes` behave identically. Closes the `profileService` API-shape bullet in #61 (MDK Phase 0, T0.1 in `plans/module-dev-kit.md`).

### Patch Changes

- 97d205a: Hoist the tool result payload convention into `TOOLS.md` and `module-sdk/README.md` as a first-class rule (list-style tools return a named-key object keyed by the plural resource; singular tools return the value directly). Closes the "Tool result shape convention" bullet in #61. Pure documentation — no API or runtime changes.

## 0.2.0

### Minor Changes

- 42ea1e7: Add ConnectorDefinition, ServiceDefinition, AuthStrategy, ScopeDefinition, ConnectedAccount, ConnectorTokenHandle, ScopeCheckResult types. Extend ModuleFactoryDeps with optional listConnectedAccounts and checkScopes methods. Add optional advisory connectors field to Module manifest. All changes are additive.
