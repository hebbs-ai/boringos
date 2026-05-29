# @boringos/dev-host

## 0.5.4

### Patch Changes

- Updated dependencies [8594055]
  - @boringos/agent@0.4.0
  - @boringos/core@0.4.1

## 0.5.3

### Patch Changes

- Updated dependencies [a53e6f4]
  - @boringos/module-sdk@0.13.0
  - @boringos/core@0.4.0
  - @boringos/agent@0.3.1

## 0.5.2

### Patch Changes

- Updated dependencies [d1695e0]
  - @boringos/module-sdk@0.12.0
  - @boringos/db@0.2.0
  - @boringos/agent@0.3.0
  - @boringos/core@0.3.2

## 0.5.1

### Patch Changes

- Updated dependencies [0fe25a1]
  - @boringos/module-sdk@0.11.0
  - @boringos/agent@0.2.0
  - @boringos/core@0.3.1

## 0.5.0

### Minor Changes

- 610c3c8: Connector OAuth walkthrough for `hebbs dev` (MDK T6.4, scaffolding).

  - `@boringos/core` — built-in Google and Slack connector modules now declare `provides` so `dependsOn: [{ capability }]` resolves cleanly. Google provides `email-send`, `email-read`, `calendar`, `google-drive`, `google-contacts`. Slack provides `chat-send`, `chat-read`, `slack`.
  - `@boringos/dev-host` — new `DevHost.getAuthSteps()` returns `AuthStep[]` for every unmet capability dependency of the module under test. Each step carries the resolving connector module id, the OAuth `authorizeUrl` (preconfigured with `tenantId` + the provider's scopes), and a human-readable reason string. Pulls the registered modules from `app.boundModules` and the existing connection state from `connector_accounts`, so already-connected providers don't generate noise.
  - `@boringos/hebbs-cli` — `startDev()` eagerly computes auth steps and surfaces them on `DevHandle.authSteps`. `hebbs dev` prints a `⚠ N connector accounts not yet connected:` block listing each step's capability → provider → URL → scopes after the boot banner. `getAuthSteps()` errors don't fail the boot.

  **Live OAuth acceptance** — paste the URL into a browser, complete Google consent, see `connector_accounts` written, dispatch a tool that uses the token — is deferred behind a STOP/ASK on #50 (needs Parag's Google OAuth client_id/secret + a registered redirect URI). The walkthrough machinery is verified end-to-end against a fixture module that declares `dependsOn: [{ capability: "email-send" }]`.

### Patch Changes

- Updated dependencies [610c3c8]
  - @boringos/core@0.3.0

## 0.4.0

### Minor Changes

- 5df7340: `recipes/docker/` Compose recipe + `hebbs dev --postgres-url` (MDK T6.3, scope-down).

  - New `recipes/docker/docker-compose.yml` — Postgres 16 on `127.0.0.1:5439`, named volume `hebbs-dev-pgdata`, healthchecked. The "wp-env-equivalent" for module authors who want persistent state across `hebbs dev` restarts or are hitting macOS `kern.sysv.shmmni` shm limits with the embedded default.
  - `recipes/docker/README.md` — quickstart, when-to-use guidance, lifecycle commands, and a roadmap note pointing at the deferred full `hebbs dev --docker` flag.
  - `DevHostOptions.databaseUrl` — opt out of embedded Postgres and point at an external instance. Migrations still run on boot.
  - `hebbs dev --postgres-url <url>` (or `$DATABASE_URL`) — surfaces the same option through the CLI. The boot summary now shows `postgres: embedded | external`.

  The full `hebbs dev --docker` flag (orchestrates this Compose file + a containerised Shell+Core) is **deferred** — it requires `@boringos/shell` to ship as a published OCI image, which is a separate piece of work.

## 0.3.0

### Minor Changes

- 8700a8c: Hot reload for `hebbs dev` (MDK T6.2).

  - `DevHost.reload()` — drops the currently-registered module and re-imports + re-registers from the original path. Uses a `?t=<token>` cache-buster so Node's ESM cache hands back the new code, and (for `.hebbsmod` archives) re-extracts into a sibling dir each time. Returns `{ toolsRemoved/Added, skillsRemoved/Added, moduleVersion, durationMs }`. `DevHost.moduleVersion` is now a getter so reload-time version bumps land in the handle.
  - `hebbs dev` arms an `fs.watch(modulePath, { recursive: true })` watcher when given a directory (skipped automatically for `.hebbsmod` archives; opt out with `--no-watch`). Edits debounce 250ms, then trigger `reload()`. CLI prints `↻ reloaded <id>@<ver> (tools R→A, skills R→A, Nms)` after each successful reload.
  - Programmatic API: `startDev({ modulePath, watch: "auto" | true | false, watchDebounceMs, onReload, onReloadError })` — `DevHandle.watching` reports whether a watcher is armed.
  - File events from `node_modules/`, `.git/`, swap files (`*~`, `*.swp`), and non-source extensions are filtered before the debounce.
  - Reload errors don't crash the host; they print to stderr (or surface via `onReloadError`) and the watcher stays armed.

## 0.2.0

### Minor Changes

- 94e73b7: New package `@boringos/dev-host` — a reusable headless harness that boots BoringOS with all built-ins, registers a `.hebbsmod` (or a pre-built module package), seeds a tenant, mints a callback JWT, and exposes a `dispatch(toolName, inputs)` helper plus direct DB access for assertions. The single `createDevHost({ modulePath })` call replaces the bespoke `scripts/try-runtime-install.mjs` orchestration — future `hebbs test` and CI acceptance scripts consume this entrypoint. MDK T4.1.
