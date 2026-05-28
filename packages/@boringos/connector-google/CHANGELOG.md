# @boringos/connector-google

## 0.2.6

### Patch Changes

- Updated dependencies [4a204a5]
  - @boringos/module-sdk@0.8.0

## 0.2.5

### Patch Changes

- Updated dependencies [09fb6b7]
  - @boringos/module-sdk@0.7.0

## 0.2.4

### Patch Changes

- Updated dependencies [097883c]
  - @boringos/module-sdk@0.6.0

## 0.2.3

### Patch Changes

- Updated dependencies [299ccc3]
  - @boringos/module-sdk@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [bed93db]
  - @boringos/module-sdk@0.4.0

## 0.2.1

### Patch Changes

- a4ca940: Add `requiredScopes: ScopeDefinition[]` to `ConnectorDefinition` (closes the `profileService` hidden-service hack in `@boringos/connector-google`). `AuthManager.startOAuthFlow` now merges connector-required identity scopes with caller-requested service scopes (deduped) so any `ConnectorDefinition` can declare always-on OAuth scopes without piggybacking on the services flattener. `googleConnector` switches from `services: [profileService, …]` to `requiredScopes: PROFILE_SCOPES`; the `profileService` export is removed (it had no external consumers). Backward compatible: existing connectors without `requiredScopes` behave identically. Closes the `profileService` API-shape bullet in #61 (MDK Phase 0, T0.1 in `plans/module-dev-kit.md`).
- Updated dependencies [a4ca940]
- Updated dependencies [97d205a]
  - @boringos/module-sdk@0.3.0

## 0.2.0

### Minor Changes

- 3d6eb97: BREAKING (0.x): removed legacy `executeAction`-based `GmailClient` and `CalendarClient` classes. Use typed methods (`listMessages`, `sendEmail`, `listEvents`, `createEvent`, etc.) instead. The exports now point to what was previously `GmailClientV2`/`CalendarClientV2`. Following 0.x semver, this breaking change is a minor bump. Token-provider constructor and typed methods are documented in the package README and skill files.

### Patch Changes

- Updated dependencies [42ea1e7]
  - @boringos/module-sdk@0.2.0

## 0.1.1

### Patch Changes

- Agent templates, team templates (5 built-in), hierarchy (org tree, delegation, escalation), workflow-triggered routines, wake-agent and connector-action block handlers.
- Updated dependencies
  - @boringos/shared@0.1.1
  - @boringos/connector@0.1.1

## 0.1.0

### Minor Changes

- Initial release of BoringOS — the framework that takes away all the boring parts of building agentic platforms.

### Patch Changes

- Updated dependencies
  - @boringos/shared@0.1.0
  - @boringos/connector@0.1.0
