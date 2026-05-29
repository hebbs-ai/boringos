# @boringos/hebbs-cli

## 0.8.1

### Patch Changes

- @boringos/dev-host@0.5.4

## 0.8.0

### Minor Changes

- 5830d7c: Codemod runner foundation + one bundled codemod (MDK T7.5).

  - New `Codemod` interface (`id`, `description`, `extensions`, `transform`). Regex-driven by design — no `ts-morph` / `jscodeshift` / `babel` dep, so the CLI bundle stays slim.
  - `runCodemod(codemod, { modulePath, write })` walks `src/**` filtered by extension and applies the transform. Dry-run by default; `--write` applies.
  - Ships `moduleUiToPluginUi` — renames the deprecated `ModuleUI` import to `PluginUI` (the MDK T3.2 surface change). The structural slot move still needs a manual pass — see BUILD-A-MODULE.md — but this codemod handles the name churn.
  - CLI: `hebbs codemod <module> --codemod <id> [--write]`. `hebbs codemod <module>` with no flags lists available codemods.
  - Programmatic API exports `runCodemod`, `bundledCodemods`, `moduleUiToPluginUi`, plus the types.

## 0.7.0

### Minor Changes

- 6a6fda1: `hebbs doctor <module>` — health-check a module package (MDK T7.4).

  Five checks today:

  - `missing-module-sdk` — error if `@boringos/module-sdk` isn't in `dependencies`.
  - `stale-module-sdk` — warn if pinned below the current MDK SDK floor (0.11.0).
  - `non-versioned-dep` — error on any `link:` / `workspace:` / `file:` dep so authors don't accidentally ship a bundle that only resolves on their machine.
  - `deprecated-module-ui` — scan `src/**` for `ModuleUI` imports from `@boringos/module-sdk` (deprecated since T3.2) and emit a migration warning with file + line.
  - Happy path returns `ok: true` with no findings.

  CLI: `hebbs doctor <module-path>` prints findings with severity icons + file references; `--json` emits a machine-readable report. Exit 0 when no errors, 1 otherwise.

  Programmatic API: `runDoctor({ modulePath, currentSdkVersion? })` from `@boringos/hebbs-cli`. T7.5 will layer codemod-driven auto-fixes on the same finding codes.

## 0.6.3

### Patch Changes

- @boringos/dev-host@0.5.3

## 0.6.2

### Patch Changes

- @boringos/dev-host@0.5.2

## 0.6.1

### Patch Changes

- @boringos/dev-host@0.5.1

## 0.6.0

### Minor Changes

- 610c3c8: Connector OAuth walkthrough for `hebbs dev` (MDK T6.4, scaffolding).

  - `@boringos/core` — built-in Google and Slack connector modules now declare `provides` so `dependsOn: [{ capability }]` resolves cleanly. Google provides `email-send`, `email-read`, `calendar`, `google-drive`, `google-contacts`. Slack provides `chat-send`, `chat-read`, `slack`.
  - `@boringos/dev-host` — new `DevHost.getAuthSteps()` returns `AuthStep[]` for every unmet capability dependency of the module under test. Each step carries the resolving connector module id, the OAuth `authorizeUrl` (preconfigured with `tenantId` + the provider's scopes), and a human-readable reason string. Pulls the registered modules from `app.boundModules` and the existing connection state from `connector_accounts`, so already-connected providers don't generate noise.
  - `@boringos/hebbs-cli` — `startDev()` eagerly computes auth steps and surfaces them on `DevHandle.authSteps`. `hebbs dev` prints a `⚠ N connector accounts not yet connected:` block listing each step's capability → provider → URL → scopes after the boot banner. `getAuthSteps()` errors don't fail the boot.

  **Live OAuth acceptance** — paste the URL into a browser, complete Google consent, see `connector_accounts` written, dispatch a tool that uses the token — is deferred behind a STOP/ASK on #50 (needs Parag's Google OAuth client_id/secret + a registered redirect URI). The walkthrough machinery is verified end-to-end against a fixture module that declares `dependsOn: [{ capability: "email-send" }]`.

### Patch Changes

- Updated dependencies [610c3c8]
  - @boringos/dev-host@0.5.0

## 0.5.0

### Minor Changes

- 5df7340: `recipes/docker/` Compose recipe + `hebbs dev --postgres-url` (MDK T6.3, scope-down).

  - New `recipes/docker/docker-compose.yml` — Postgres 16 on `127.0.0.1:5439`, named volume `hebbs-dev-pgdata`, healthchecked. The "wp-env-equivalent" for module authors who want persistent state across `hebbs dev` restarts or are hitting macOS `kern.sysv.shmmni` shm limits with the embedded default.
  - `recipes/docker/README.md` — quickstart, when-to-use guidance, lifecycle commands, and a roadmap note pointing at the deferred full `hebbs dev --docker` flag.
  - `DevHostOptions.databaseUrl` — opt out of embedded Postgres and point at an external instance. Migrations still run on boot.
  - `hebbs dev --postgres-url <url>` (or `$DATABASE_URL`) — surfaces the same option through the CLI. The boot summary now shows `postgres: embedded | external`.

  The full `hebbs dev --docker` flag (orchestrates this Compose file + a containerised Shell+Core) is **deferred** — it requires `@boringos/shell` to ship as a published OCI image, which is a separate piece of work.

### Patch Changes

- Updated dependencies [5df7340]
  - @boringos/dev-host@0.4.0

## 0.4.0

### Minor Changes

- 8700a8c: Hot reload for `hebbs dev` (MDK T6.2).

  - `DevHost.reload()` — drops the currently-registered module and re-imports + re-registers from the original path. Uses a `?t=<token>` cache-buster so Node's ESM cache hands back the new code, and (for `.hebbsmod` archives) re-extracts into a sibling dir each time. Returns `{ toolsRemoved/Added, skillsRemoved/Added, moduleVersion, durationMs }`. `DevHost.moduleVersion` is now a getter so reload-time version bumps land in the handle.
  - `hebbs dev` arms an `fs.watch(modulePath, { recursive: true })` watcher when given a directory (skipped automatically for `.hebbsmod` archives; opt out with `--no-watch`). Edits debounce 250ms, then trigger `reload()`. CLI prints `↻ reloaded <id>@<ver> (tools R→A, skills R→A, Nms)` after each successful reload.
  - Programmatic API: `startDev({ modulePath, watch: "auto" | true | false, watchDebounceMs, onReload, onReloadError })` — `DevHandle.watching` reports whether a watcher is armed.
  - File events from `node_modules/`, `.git/`, swap files (`*~`, `*.swp`), and non-source extensions are filtered before the debounce.
  - Reload errors don't crash the host; they print to stderr (or surface via `onReloadError`) and the watcher stays armed.

### Patch Changes

- Updated dependencies [8700a8c]
  - @boringos/dev-host@0.3.0

## 0.3.0

### Minor Changes

- 98fa7bf: Add `hebbs dev <module>` — boots a headless host against the module and keeps it alive (Ctrl+C to stop), printing the URL, tenant id, callback JWT, and a ready-to-paste `curl` example. Mirrors `hebbs test` for arguments (`--tool` / `--inputs`) but never tears down on its own. Programmatic API: `startDev()` from `@boringos/hebbs-cli`. MDK T6.1. Hot-reload via file watcher lands in T6.2.

## 0.2.0

### Minor Changes

- 5305c60: New package `@boringos/hebbs-cli` — the Hebbs CLI. Initial command: `hebbs test <module>` boots a headless host (via `@boringos/dev-host`) against a `.hebbsmod` archive or a built module package directory, optionally dispatches one smoke tool (`--tool <fq-name> --inputs '<json>'`), and emits either a human summary or `--json` for machine consumers. Exit code 0 on success, 1 on failure. MDK T4.2.
