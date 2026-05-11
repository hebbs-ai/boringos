# BoringOS — CLAUDE.md

> Agent orientation. Read before touching the framework. Reference material lives elsewhere — this file is for what's non-obvious.

## What is BoringOS?

An **open-source framework for building agentic platforms** — agents receive tasks, execute autonomously, report back. Rails for AI agents.

**Key principle:** agents always run as agentic CLI tools (Claude Code, Codex, Gemini CLI, Ollama, …). The framework never calls LLM APIs directly — CLIs are the agents, BoringOS is the orchestrator.

## Tech stack

Hono on Node ≥ 22, TypeScript ESM (`"type": "module"`, `.js` imports for local files), pnpm 9, Drizzle ORM on Postgres (embedded by default, external via `DATABASE_URL`), Vitest, MIT.

## Commands

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm test:run        # single pass
pnpm test            # watch
```

## Monorepo layout

```
packages/@boringos/
  shared/         base types, constants, Hook<T>, utilities
  memory/         MemoryProvider iface + Hebbs + nullMemory
  runtime/        6 CLI runtimes (claude, chatgpt, gemini, ollama, command, webhook)
  drive/          StorageBackend iface + local FS + DriveManager
  db/             Drizzle schema + embedded Postgres + migrations
  agent/          execution engine, context pipeline, wakeups, personas, registries
  pipeline/       QueueAdapter (in-process default, BullMQ opt-in)
  module-sdk/     Module / Tool / Skill type SDK
  connector-slack, connector-google   reference Modules wrapping 3rd-party APIs
  shell/          UI shell
  ui/             typed API client + headless React hooks
  core/           BoringOS class, Hono routes, app bootstrap, built-in Modules
  create-boringos CLI generator (npx create-boringos)

examples/quickstart    runnable example
tests/                 smoke tests (Vitest)
docs/                  architecture, plans, blockers, thesis
```

For per-package APIs read `src/index.ts` of the package — the export list is the surface.

## Skills — every component teaches the agent

The framework's prompt-side abstraction. Every component (connector, app, agent, plus core subsystems) ships markdown that gets concatenated into the agent's system prompt under `## Skills`. Read once per wake.

| Component | Where the skill lives |
|---|---|
| Module (incl. connectors) | `Module.skills[]` in the Module manifest — typically loaded from `SKILL.md` files in the package |
| Agent (per-row) | `agents.instructions` column **plus** persona bundle keyed off `agents.role` (`packages/@boringos/agent/src/personas/<role>/`) |
| Memory / drive / runtime | `skillMarkdown()` on the provider interface |
| Tenant-curated | Synced via `/api/admin/skills` (github/url sources, trust levels), symlinked into agent workdir |

Behavioral teaching goes in `SKILL.md` — not into hand-edited copies of `protocol.ts`.

## Architecture — Skills, Tools, Modules

Three primitives — see [`docs/new_thesis.md`](docs/new_thesis.md), [`BUILD-A-MODULE.md`](BUILD-A-MODULE.md), [`MODULES.md`](MODULES.md), [`TOOLS.md`](TOOLS.md), [`SKILLS.md`](SKILLS.md).

| Primitive | What it is |
|---|---|
| **Skill** | Markdown loaded into the agent's prompt under `## Skills` |
| **Tool** | Zod-typed callable, dispatched at `POST /api/tools/<module>.<name>` |
| **Module** | Bundles skills + tools + (optionally) schema, routines, webhooks, OAuth, UI |

Modules register via two paths:

1. **Static, at boot** — `app.module(myModule)` before `app.listen()`. Used for framework built-ins (framework, memory, drive, inbox, workflow, copilot, slack, google, triage, inbox-triage, inbox-replier). They live in `packages/@boringos/core/src/modules/` and are the only modules the dev-server wires up.
2. **Runtime, via upload** — third-party `.hebbsmod` bundles dropped onto the Apps screen go through `POST /api/admin/modules/upload`. The framework extracts, signature-checks (or accepts with `HEBBS_DEV_MODULES=true`), dynamic-imports the bundle, and calls the same registration path on a live process. See [`docs/install-flow.md`](docs/install-flow.md). CRM is the first third-party module to ship this way — it has no static workspace link in the framework.

One Module concept, one install pipeline (`install-manager`), one HTTP surface (`/api/admin/{modules,installs,...}` + `/api/tools/<module>.<tool>`).

## Non-obvious behavior worth knowing

These are subtle and easy to break — read before touching the engine, auth, or scheduler.

- **`tenantId` everywhere** — never `companyId`. Multi-tenant by default; every domain row carries it.
- **Auto-rewake only on success.** After every run, if the agent has remaining `todo` tasks, the engine wakes it again — *but only if the run succeeded*. Failed runs (credits exhausted, crash, API error) do NOT rewake — prevents tight money-burning loops. Next user/routine/event wake retries normally.
- **Wakeup coalescing.** `createWakeup()` deduplicates pending wakes so simultaneous events don't spawn N concurrent runs of the same agent.
- **Boot recovery sweep.** `engine.recoverPending()` (called from `BoringOS.listen()`) closes stale `running` runs as failed (process died mid-run) and re-enqueues orphaned `pending` wakes from the previous process's in-memory queue.
- **Callback auth = HMAC-SHA256 JWT, 4h expiry.** Engine signs `{ sub: runId, agent_id, tenant_id, exp }`, injects as `BORINGOS_CALLBACK_TOKEN`, verifies on `/api/agent/*`. Routes read identity from claims, **not** request body — agents cannot impersonate. Secret via `auth.secret` config (random per boot if unset). `/health` is unauthenticated. Utilities: `signCallbackToken` / `verifyCallbackToken` from `@boringos/agent`.
- **Agents run with `--dangerously-skip-permissions`.** Full FS read/write; no interactive approval. Designed for autonomous operation — assume the agent can edit anything in its workdir.
- **Auto-post results as comments.** After every run on a task, the framework posts the run's result text as a comment with `authorAgentId`. This is what makes copilot/conversational flows work end-to-end.
- **Pause semantics.** `agents_paused` setting (global) or per-agent `status: "paused"` skips CLI spawning only. Events still fire, tasks still get created, budget is not consumed. New runs land as `status: "skipped"` with `errorCode`. Setting `agents_paused: "false"` auto-rewakes agents with pending todos.
- **Default queue is in-process, serial.** Bump via `BoringOS({ queue: { concurrency: N } })`. Each slot spawns a CLI subprocess — raise carefully (RAM, rate limits, DB pool). BullMQ via `app.queue(createBullMQQueue(...))`.
- **Auth dual-mode.** Admin API accepts both `X-API-Key` (machine) and `Authorization: Bearer` (session). `createAuthMiddleware(db)` is exported — apps mount it on their own routes instead of reimplementing.
- **Workflow templates: `{{blockName.field}}`.** Reference upstream block outputs by *name*, not id. Branching via `selectedHandle` on condition blocks (`condition-true` / `condition-false`).
- **Workflow-targeted routines = "smart routines".** A routine can target a workflow instead of an agent — workflow runs the cron tick, decides via `condition` block, and only fires `wake-agent` when there's actually work. Avoids waking expensive agents on every tick.

## Agent execution pipeline

```
wake → coalesce → enqueue → fetch agent → create run row
     → ContextPipeline (system: header, persona, guidelines, skills, protocol;
                        context: session, task, comments, memory, approval)
     → resolve runtime → spawn CLI subprocess
     → stream stdout/stderr/cost callbacks → finalize run + persist session
     → auto-post result comment → maybe auto-rewake
```

## Database

Drizzle schema in `packages/@boringos/db/src/schema/`. Embedded Postgres boots automatically (data in `.data/postgres`); pass `DATABASE_URL` for external. Every tool dispatch writes a row to `tool_calls` for audit.

## Feature inventory (pointers, not enumeration)

The host (`@boringos/core`) ships an admin API, auth (sessions + invitations + team mgmt + device auth), SSE realtime bus, budget enforcement, routine scheduler, plugins, projects/goals/labels, drive indexing + memory sync, onboarding, evals, inbox, agent templates + team templates, hierarchy + delegation, custom-schema integration, entity linking, event-to-inbox routing, cross-entity search, multi-tenant copilot.

Don't enumerate routes here — read source:

- Admin API: `packages/@boringos/core/src/admin/` and `module-admin-routes.ts`
- Auth + sessions: `packages/@boringos/core/src/auth/`
- Plugins: [`PLUGINS.md`](PLUGINS.md)
- Module authoring: [`BUILD-A-MODULE.md`](BUILD-A-MODULE.md)
- Module packaging + install/uninstall flow: [`docs/install-flow.md`](docs/install-flow.md)
- Runnable example: `examples/quickstart/`

## Builder hooks (registration shape)

```ts
const app = new BoringOS({ /* config */ });
app.memory(provider).runtime(module).queue(adapter)
   .contextProvider(p).persona(role, bundle).blockHandler(h)
   .plugin(p).module(factoryOrManifest)
   .onEvent(type, handler).onTenantCreated(fn)
   .beforeStart(fn).afterStart(fn).beforeShutdown(fn)
   .route(path, hono).schema(ddl)
   .routeToInbox({ filter, transform });
await app.listen(3000);
```

For "how do I add a custom X" recipes, see `examples/quickstart/` and `BUILD-A-MODULE.md` — those stay in sync with the code; this file does not.

## Code style

- TypeScript ESM. Local imports use `.js` extensions.
- `tenantId`, never `companyId`.
- Every Module ships `skills[]` (typically loaded from `SKILL.md` files) alongside its tools.
- Convention over configuration. In-process defaults; external services (Redis, Postgres) opt-in.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | |
| `PORT` | `3000` | |
| `DATABASE_URL` | — | external Postgres; if unset, embedded PG is used |
| `HEBBS_ENDPOINT` / `HEBBS_API_KEY` / `HEBBS_WORKSPACE` | — | optional Hebbs memory |
| `RESEND_API_KEY` | — | enables email notifications |
