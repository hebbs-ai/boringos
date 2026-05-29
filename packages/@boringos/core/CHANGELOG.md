# @boringos/core

## 0.4.1

### Patch Changes

- Updated dependencies [8594055]
  - @boringos/agent@0.4.0

## 0.4.0

### Minor Changes

- a53e6f4: Per-hook runtime policy + declarative `inboxSource` (MDK T7.3).

  - `@boringos/module-sdk` — new `InboxSource` type. `Module.inboxSource` is the manifest-level equivalent of `app.routeToInbox(...)`, with a JSONPath-lite field projection so `.hebbsmod` modules can declare inbox routing without smuggling closures.
  - `@boringos/core` — `registerModule()` compiles a manifest `inboxSource` into the existing `inboxRoutes` pipeline. Same downstream behaviour as `app.routeToInbox()`; the helper handles event-type matching, optional path-equals filtering, and `$.` references into the event payload.
  - `MODULES.md` — new "Hook reach" section codifying the policy table: tools/skills/schema/agents/workflows/routines/events/webhooks/inboxSource/lifecycle ship in the manifest; blockHandler is data-driven; contextProvider/persona/onTenantCreated/route stay host-only (and `route` is **explicitly disallowed** for runtime `.hebbsmod` — modules can't smuggle host-scope HTTP). Includes a worked `inboxSource` example.

  CRM has no `routeToInbox` call to migrate today — it reacts to inbox events via routine triggers instead. The manifest field ships for future authors + the third-party `.hebbsmod` path.

### Patch Changes

- Updated dependencies [a53e6f4]
  - @boringos/module-sdk@0.13.0
  - @boringos/agent@0.3.1
  - @boringos/connector-google@0.2.11
  - @boringos/connector-slack@0.2.11

## 0.3.2

### Patch Changes

- Updated dependencies [d1695e0]
  - @boringos/module-sdk@0.12.0
  - @boringos/db@0.2.0
  - @boringos/agent@0.3.0
  - @boringos/connector-google@0.2.10
  - @boringos/connector-slack@0.2.10
  - @boringos/drive@0.1.10

## 0.3.1

### Patch Changes

- Updated dependencies [0fe25a1]
  - @boringos/module-sdk@0.11.0
  - @boringos/agent@0.2.0
  - @boringos/connector-google@0.2.9
  - @boringos/connector-slack@0.2.9

## 0.3.0

### Minor Changes

- 610c3c8: Connector OAuth walkthrough for `hebbs dev` (MDK T6.4, scaffolding).

  - `@boringos/core` — built-in Google and Slack connector modules now declare `provides` so `dependsOn: [{ capability }]` resolves cleanly. Google provides `email-send`, `email-read`, `calendar`, `google-drive`, `google-contacts`. Slack provides `chat-send`, `chat-read`, `slack`.
  - `@boringos/dev-host` — new `DevHost.getAuthSteps()` returns `AuthStep[]` for every unmet capability dependency of the module under test. Each step carries the resolving connector module id, the OAuth `authorizeUrl` (preconfigured with `tenantId` + the provider's scopes), and a human-readable reason string. Pulls the registered modules from `app.boundModules` and the existing connection state from `connector_accounts`, so already-connected providers don't generate noise.
  - `@boringos/hebbs-cli` — `startDev()` eagerly computes auth steps and surfaces them on `DevHandle.authSteps`. `hebbs dev` prints a `⚠ N connector accounts not yet connected:` block listing each step's capability → provider → URL → scopes after the boot banner. `getAuthSteps()` errors don't fail the boot.

  **Live OAuth acceptance** — paste the URL into a browser, complete Google consent, see `connector_accounts` written, dispatch a tool that uses the token — is deferred behind a STOP/ASK on #50 (needs Parag's Google OAuth client_id/secret + a registered redirect URI). The walkthrough machinery is verified end-to-end against a fixture module that declares `dependsOn: [{ capability: "email-send" }]`.

## 0.2.5

### Patch Changes

- Updated dependencies [efba86b]
  - @boringos/module-sdk@0.10.0
  - @boringos/agent@0.1.17
  - @boringos/connector-google@0.2.8
  - @boringos/connector-slack@0.2.8

## 0.2.4

### Patch Changes

- Updated dependencies [88c018d]
  - @boringos/module-sdk@0.9.0
  - @boringos/agent@0.1.16
  - @boringos/connector-google@0.2.7
  - @boringos/connector-slack@0.2.7

## 0.2.3

### Patch Changes

- Updated dependencies [4a204a5]
  - @boringos/module-sdk@0.8.0
  - @boringos/agent@0.1.15
  - @boringos/connector-google@0.2.6
  - @boringos/connector-slack@0.2.6

## 0.2.2

### Patch Changes

- Updated dependencies [09fb6b7]
  - @boringos/module-sdk@0.7.0
  - @boringos/agent@0.1.14
  - @boringos/connector-google@0.2.5
  - @boringos/connector-slack@0.2.5

## 0.2.1

### Patch Changes

- Updated dependencies [097883c]
  - @boringos/module-sdk@0.6.0
  - @boringos/agent@0.1.13
  - @boringos/connector-google@0.2.4
  - @boringos/connector-slack@0.2.4

## 0.2.0

### Minor Changes

- a5699be: `module-package-routes` (the `POST /api/admin/modules/upload` route) now enforces `module.json.minFrameworkVersion` at upload time using `checkMinFrameworkVersion` from `@boringos/module-sdk`. A new optional `frameworkVersion` field on `ModulePackageRoutesDeps` declares the host's version; when set, uploads of bundles requesting a higher minimum return `400 { error: "incompatible_framework", message: "<id>@<version>: module requires framework >= X, host is Y" }` before the bundle is moved to the store. Hosts that don't set `frameworkVersion` fall back to the pre-T2.3 behaviour (no check). MDK T2.3.

## 0.1.12

### Patch Changes

- Updated dependencies [299ccc3]
  - @boringos/module-sdk@0.5.0
  - @boringos/agent@0.1.12
  - @boringos/connector-google@0.2.3
  - @boringos/connector-slack@0.2.3

## 0.1.11

### Patch Changes

- Updated dependencies [bed93db]
  - @boringos/module-sdk@0.4.0
  - @boringos/agent@0.1.11
  - @boringos/connector-google@0.2.2
  - @boringos/connector-slack@0.2.2

## 0.1.10

### Patch Changes

- a4ca940: Add `requiredScopes: ScopeDefinition[]` to `ConnectorDefinition` (closes the `profileService` hidden-service hack in `@boringos/connector-google`). `AuthManager.startOAuthFlow` now merges connector-required identity scopes with caller-requested service scopes (deduped) so any `ConnectorDefinition` can declare always-on OAuth scopes without piggybacking on the services flattener. `googleConnector` switches from `services: [profileService, …]` to `requiredScopes: PROFILE_SCOPES`; the `profileService` export is removed (it had no external consumers). Backward compatible: existing connectors without `requiredScopes` behave identically. Closes the `profileService` API-shape bullet in #61 (MDK Phase 0, T0.1 in `plans/module-dev-kit.md`).
- Updated dependencies [a4ca940]
- Updated dependencies [97d205a]
- Updated dependencies
  - @boringos/module-sdk@0.3.0
  - @boringos/connector-google@0.2.1
  - @boringos/db@0.1.9
  - @boringos/runtime@0.1.9
  - @boringos/memory@0.1.9
  - @boringos/drive@0.1.9
  - @boringos/pipeline@0.1.9
  - @boringos/agent@0.1.10
  - @boringos/connector-slack@0.2.1

## 0.1.9

### Patch Changes

- Updated dependencies [3d6eb97]
- Updated dependencies [42ea1e7]
- Updated dependencies [a1d8af9]
  - @boringos/connector-google@0.2.0
  - @boringos/module-sdk@0.2.0
  - @boringos/connector-slack@0.2.0
  - @boringos/agent@0.1.9

## 0.1.2

### Patch Changes

- Agent templates, team templates (5 built-in), hierarchy (org tree, delegation, escalation), workflow-triggered routines, wake-agent and connector-action block handlers.
- Updated dependencies
  - @boringos/shared@0.1.1
  - @boringos/memory@0.1.1
  - @boringos/runtime@0.1.1
  - @boringos/drive@0.1.1
  - @boringos/db@0.1.2
  - @boringos/agent@0.1.1
  - @boringos/workflow@0.1.2
  - @boringos/pipeline@0.1.1
  - @boringos/connector@0.1.1

## 0.1.0

### Minor Changes

- Initial release of BoringOS — the framework that takes away all the boring parts of building agentic platforms.

### Patch Changes

- Updated dependencies
  - @boringos/shared@0.1.0
  - @boringos/memory@0.1.0
  - @boringos/runtime@0.1.0
  - @boringos/drive@0.1.0
  - @boringos/db@0.1.0
  - @boringos/agent@0.1.0
  - @boringos/workflow@0.1.0
  - @boringos/pipeline@0.1.0
  - @boringos/connector@0.1.0
