# @boringos/module-sdk

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
