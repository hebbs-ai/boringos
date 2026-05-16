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
  to writing your first Module.
- [`MODULES.md`](../MODULES.md) — full Module manifest spec.
- [`TOOLS.md`](../TOOLS.md) — Tool spec: naming, error model,
  audit, idempotency.
- [`SKILLS.md`](../SKILLS.md) — Skill spec: file format,
  priorities, overrides.
- [`install-flow.md`](install-flow.md) — packaging, upload,
  per-tenant install / uninstall lifecycle.
- [`examples/quickstart/`](../examples/quickstart/) — runnable
  starter app.

## Framework specifics

- [`PLUGINS.md`](../PLUGINS.md) — plugin system (collapses into
  Module shape).
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — code style, branching,
  PR conventions.

## Architecture

- [`docs/thesis.md`](thesis.md) — **the Hebbs thesis** (Shell +
  Modules + framework + how we sell). Source of truth for all docs
  and marketing copy — read before writing any new doc.
- [`docs/overview.md`](overview.md) — system overview.
- [`docs/coordination.md`](coordination.md) — how agents coordinate
  via tasks + comments + the hierarchy.
- [`docs/capabilities.md`](capabilities.md) — feature surface.
- [`docs/shell-screens.md`](shell-screens.md) — UI surface.
- [`docs/roadmap.md`](roadmap.md) — direction.

## Project context

- [`docs/investor-one-pager.md`](investor-one-pager.md)
- [`docs/licensing.md`](licensing.md)

## Plans + status

- [`docs/blockers/`](blockers/) — active blocker docs (work plans).
- [`docs/blockers/done/`](blockers/done/) — completed blockers.
- [`docs/archive/`](archive/) — historical phase plans, test
  results, and design notes from earlier iterations.

## Per-package docs

Each `packages/@boringos/<pkg>/README.md` describes that package's
role, exports, and minimal usage:

- `agent/` — execution engine, context pipeline, registries
- `connector-google/` — Gmail + Calendar Module
- `connector-slack/` — Slack Module
- `core/` — `BoringOS` class, Hono routes, built-in Modules
- `create-boringos/` — CLI generator
- `db/` — Drizzle schema + embedded Postgres + migrations
- `drive/` — `StorageBackend` + `DriveManager`
- `memory/` — `MemoryProvider` + Hebbs adapter
- `module-sdk/` — Module / Tool / Skill type SDK
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
5. [`install-flow.md`](install-flow.md) — how Modules ship
   end-to-end
6. [`examples/quickstart/`](../examples/quickstart/) — pull it up
   in an editor and read alongside the docs.
