# Documentation index

Navigation across every doc in the repo, in the order most readers
want them.

---

## Start here

- [`README.md`](../README.md) — what BoringOS is, install, first
  Module in 60 seconds.
- [`CLAUDE.md`](../CLAUDE.md) — orientation for contributors
  (humans + AI). Mental model, monorepo layout, non-obvious behavior.

## Build a Module

- [`BUILD-A-MODULE.md`](../BUILD-A-MODULE.md) — step-by-step guide
  to writing your first v2 Module.
- [`MODULES.md`](../MODULES.md) — full Module manifest spec.
- [`TOOLS.md`](../TOOLS.md) — Tool spec: naming, error model,
  audit, idempotency.
- [`SKILLS.md`](../SKILLS.md) — Skill spec: file format,
  priorities, overrides.
- [`examples/quickstart/`](../examples/quickstart/) — runnable
  starter app.

## Migration

- [`MIGRATION-V1-TO-V2.md`](../MIGRATION-V1-TO-V2.md) — what
  changed, how to port v1 connectors / apps / plugins.

## Framework specifics

- [`PLUGINS.md`](../PLUGINS.md) — v1 plugin system (collapses into
  Module in v2).
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — code style, branching,
  PR conventions.

## Architecture

- [`docs/new_thesis.md`](new_thesis.md) — the v2 thesis
  (Skills + Tools + Modules).
- [`docs/overview.md`](overview.md) — system overview.
- [`docs/coordination.md`](coordination.md) — how agents coordinate
  via tasks + comments + the hierarchy.
- [`docs/capabilities.md`](capabilities.md) — feature surface.
- [`docs/app-sdk.md`](app-sdk.md) — v1 app authoring (legacy;
  Modules supersede this).
- [`docs/shell-screens.md`](shell-screens.md) — UI surface.
- [`docs/roadmap.md`](roadmap.md) — direction.

## Project context

- [`docs/investor-one-pager.md`](investor-one-pager.md)
- [`docs/licensing.md`](licensing.md)
- [`docs/v2/`](v2/) — v2 design notes.

## Plans + status

- [`docs/blockers/`](blockers/) — active blocker docs (work plans).
- [`docs/blockers/done/`](blockers/done/) — completed blockers.
- [`docs/tests/`](tests/) — phase test results.
- [`docs/build/`](build/) — build / phase plans.
- [`docs/phases/`](phases/) — phase histories.

## Per-package docs

Each `packages/@boringos/<pkg>/README.md` describes that package's
role, exports, and minimal usage:

- `agent/` — execution engine, context pipeline, v2 registries
- `app-sdk/` — v1 app authoring SDK
- `connector-google/` — Gmail + Calendar connector
- `connector-sdk/` — v1 connector type SDK
- `connector-slack/` — Slack connector
- `control-plane/` — control-plane surface
- `core/` — `BoringOS` class, Hono routes, app bootstrap
- `create-boringos/` — CLI generator
- `db/` — Drizzle schema + embedded Postgres + migrations
- `drive/` — `StorageBackend` + `DriveManager`
- `memory/` — `MemoryProvider` + Hebbs adapter
- `module-sdk/` — v2 Module / Tool / Skill type SDK
- `pipeline/` — `QueueAdapter` (in-process default, BullMQ opt-in)
- `runtime/` — 6 CLI runtimes (claude, chatgpt, gemini, ollama,
  command, webhook)
- `shared/` — base types, constants, utilities
- `shell/` — browser shell
- `ui/` — typed API client + React hooks

---

## Reading order for a new contributor

1. [`README.md`](../README.md)
2. [`CLAUDE.md`](../CLAUDE.md)
3. [`BUILD-A-MODULE.md`](../BUILD-A-MODULE.md)
4. [`MODULES.md`](../MODULES.md), [`TOOLS.md`](../TOOLS.md),
   [`SKILLS.md`](../SKILLS.md) as you need them
5. [`examples/quickstart/`](../examples/quickstart/) — pull it up
   in an editor and read alongside the docs.
