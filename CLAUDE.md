# BoringOS — CLAUDE.md

> Agent orientation guide. Read this first before making any changes.
> Last synced with implementation: 2026-04-08 (workflow engine, JWT auth, examples)

## What is BoringOS?

BoringOS is an **open-source framework for building agentic platforms** — systems where AI agents receive tasks, execute autonomously, and report back. Think: Rails for AI agents.

**Key principle:** Agents always run as agentic CLI tools (Claude Code, Codex, Gemini CLI, Ollama, etc.). The framework never calls LLM APIs directly — CLIs are the agents, BoringOS is the orchestrator.

---

## Monorepo Layout

```
boringos/
├── packages/@boringos/
│   ├── shared/           # Base types, constants, Hook<T>, utilities
│   ├── memory/           # MemoryProvider interface + Hebbs + nullMemory
│   ├── runtime/          # 6 runtime modules + registry + subprocess spawning
│   ├── drive/            # StorageBackend interface + local filesystem
│   ├── db/               # Drizzle schema + embedded Postgres + migrations
│   ├── agent/            # Execution engine, context pipeline, wakeups, personas
│   ├── workflow/         # DAG workflow engine + block handlers + store
│   ├── pipeline/         # QueueAdapter interface + InProcess + BullMQ
│   ├── connector/        # Connector SDK — interfaces, registry, OAuth, EventBus
│   ├── connector-slack/  # Slack reference connector
│   ├── connector-google/ # Google Workspace reference connector (Gmail + Calendar)
│   ├── create-boringos/# CLI generator (npx create-boringos)
│   ├── ui/               # Typed API client + headless React hooks
│   └── core/             # BoringOS class, Hono callback API, app bootstrap
├── examples/
│   └── quickstart/       # Runnable quickstart example
├── tests/                # Smoke tests (accumulated per phase, 118 tests)
├── plans/                # Architecture and implementation plans
├── LICENSE               # MIT
└── vitest.config.ts      # Test configuration
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| HTTP server | [Hono](https://hono.dev/) on Node.js |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/) |
| Embedded DB | `embedded-postgres` (zero-config development) |
| Memory | [Hebbs](https://hebbs.ai/) (pluggable via `MemoryProvider`) |
| Language | TypeScript (ESM, `"type": "module"`) |
| Runtime | Node.js ≥ 22 |
| Package manager | pnpm 9 |
| Testing | Vitest |
| License | MIT |

---

## Skills — every component teaches the agent

The framework's prompt-side abstraction. Every component (connector,
app, agent, plus core subsystems like memory and drive) ships a
**`SKILL.md`** that gets concatenated into the agent's system
prompt under `## Skills`. The agent reads them once per wake; they
describe how to think about and use that component.

| Component kind | Where the skill lives | Loaded into prompt by |
|---|---|---|
| **Connector** (Google, Slack, …) | `SKILL.md` in the connector package, exposed via `ConnectorDefinition.skillMarkdown()` | Skill registry (every connector contributes one) |
| **App** (CRM, custom) | `SKILL.md` in the app package, registered via `app.route(..., { agentDocs })` today | App registry / api-catalog provider |
| **Agent** (per-row) | The `agents.instructions` DB column **plus** the persona bundle keyed off `agents.role` (markdown in `packages/@boringos/agent/src/personas/<role>/`) | `persona` + `agent-instructions` providers |
| **Memory / drive / approvals / runtime** | `skillMarkdown()` on the provider interface (`MemoryProvider`, `RuntimeModule`, …) | The matching context provider |
| **Tenant-curated** (style guides, runbooks) | Synced via the admin skill system (`/api/admin/skills`, github / url sources, trust levels) — symlinked into the agent's working directory | `injectSkills(db, agentId, workDir, config)` |

So when this doc says "the agent has a skill," it means: markdown
that lands in the agent's system prompt. For an agent that markdown
comes from two places stitched together — a role-based persona
bundle (shared across all agents of that role) and an `instructions`
column (per-agent custom text). Same shape, two sources, both
markdown, both rendered as part of the prompt.

**Direction (drafted in `docs/blockers/task_11_skills_and_tools.md`):**
collapse the function-form `skillMarkdown()` into a literal
`SKILL.md` file shipped at the root of every package. One file
shape across connectors, apps, and built-in components. The agent
DB column and persona markdown stay where they are — they're
already files / strings, just per-row instead of per-package.

Every connector, app, or agent has a SKILL.md (or its current
equivalent). When you author one, that's where the behavioral
teaching goes — not into hand-edited copies of `protocol.ts`.

---

## Commands

```bash
pnpm install              # Install dependencies
pnpm -r build             # Build all packages
pnpm -r typecheck         # Typecheck all packages
pnpm test:run             # Run all tests (single pass)
pnpm test                 # Watch mode
```

---

## Package Details

### `@boringos/shared`

Foundation types used by all other packages.

- **Types:** `Agent`, `Task`, `AgentRun`, `Approval`, `Routine`, `TaskComment`
- **Base types:** `Identifiable`, `Timestamped`, `TenantScoped`
- **Constants:** `AGENT_STATUSES`, `TASK_STATUSES`, `RUN_STATUSES`, `WAKE_REASONS`, etc.
- **Interfaces:** `SkillProvider` (Code + Knowledge pattern), `Hook<T>` (typed event system)
- **Utilities:** `createHook()`, `generateId()`, `slugify()`, `sanitizePath()`

### `@boringos/memory`

Pluggable cognitive memory system.

- **`MemoryProvider`** interface: `remember`, `recall`, `prime`, `forget`, `ping`, `skillMarkdown`
- **`nullMemory`** — no-op provider (default)
- **`createHebbsMemory(config)`** — Hebbs HTTP client implementing `MemoryProvider`
- Every provider includes `skillMarkdown()` that teaches agents how to use memory

### `@boringos/runtime`

Agent execution backends. Each runtime spawns a CLI subprocess.

- **6 built-in runtimes:** `claude`, `chatgpt`, `gemini`, `ollama`, `command`, `webhook`
- **`createRuntimeRegistry()`** — injectable registry with alias resolution
- **`spawnAgent()`** — subprocess spawning utility with stdin/stdout/stderr streaming
- **`detectCli()`** — checks if a CLI tool is available on PATH
- Each runtime implements `testEnvironment()` for health checks and `skillMarkdown()`

### `@boringos/drive`

File storage abstraction.

- **`StorageBackend`** interface: `read`, `readText`, `write`, `delete`, `exists`, `list`, `move`, `stat`
- **`createLocalStorage({ root })`** — filesystem backend with path traversal protection
- **`scaffoldDrive(root, tenantId)`** — creates default folder structure
- Includes drive skill markdown for agent file organization

### `@boringos/db`

Database schema and connection management.

- **17 framework tables** with `tenantId` (not `companyId`) — multi-tenant by default
- **`createDatabase(config)`** — boots embedded Postgres or connects to external URL
- **`createMigrationManager(db)`** — schema bootstrap via DDL
- **Key tables:** `tenants`, `agents`, `tasks`, `agent_runs`, `agent_wakeup_requests`, `runtimes`, `cost_events`, `approvals`, `workflows`, `connectors`, `drive_files`, `activity_log`

### `@boringos/agent`

The execution engine — the core of the framework.

- **`createAgentEngine(config)`** — the orchestrator with hooks: `beforeRun`, `buildContext`, `afterRun`, `onCost`, `onError`
- **`ContextPipeline`** — composable pipeline of `ContextProvider` instances, sorted by phase (system/context) and priority
- **12 built-in context providers:**
  - System: header, persona, tenant guidelines, drive skill, memory skill, agent instructions, execution protocol
  - Context: session (3 modes), task, comments, memory context, approval
- **`createWakeup(db, request)`** — wakeup coalescing (prevents duplicate runs)
- **`engine.recoverPending()`** — boot-time sweep: closes stale `running` runs as failed (process died mid-run), re-enqueues orphaned `pending` wakes (queued in the old process's memory, never actually ran). Called automatically during `BoringOS.listen()`.
- **`createRunLifecycle(db)`** — run status tracking, log appending
- **Persona system:** 12 persona bundles (34 markdown files), role resolution with 30+ aliases
- **Pluggable job queue** — in-process default (no Redis), BullMQ opt-in via `@boringos/pipeline`
- **Auto-rewake discipline** — after every run, if the agent still has `todo` tasks assigned, the engine wakes it again *only if the current run succeeded*. A failed run (credits exhausted, subprocess crashed, API error) does NOT rewake — prevents tight loops where a broken agent re-queues itself until it exhausts credits or tokens. The next user/routine/event wake retries normally.

### `@boringos/workflow`

DAG-based workflow engine with typed block handlers and condition branching.

- **`buildDAG(blocks, edges)`** — constructs executable graph from block/edge arrays
- **`createWorkflowEngine({ store, handlers, services })`** — core execution loop with topological walk
- **`createWorkflowStore(db)`** — Drizzle-backed CRUD for workflow definitions
- **`createHandlerRegistry()`** — maps block types to handlers
- **`createExecutionState()`** — tracks block status + outputs during execution
- **`resolveTemplate(template, state, nameToId)`** — substitutes `{{blockName.field}}` references
- **9 built-in handlers:** `trigger` (entry point), `condition` (true/false branching), `delay` (wait), `transform` (data mapping), `wake-agent` (wake an agent from workflow), `connector-action` (call a connector action), `for-each` (iterate arrays), `create-inbox-item` (store to inbox), `emit-event` (emit connector events)
- **`wake-agent` handler:** Wakes an agent from within a workflow. Config: `{ agentId, reason?, taskId? }`. Uses `agentEngine.wake()` + `enqueue()`. Enables "smart routines" — workflows that only spawn agents when needed.
- **`connector-action` handler:** Calls a connector action (e.g., `list_emails`, `list_events`) from within a workflow. Config: `{ connectorKind, action, inputs? }`. Fetches credentials from DB automatically.
- **`for-each` handler:** Iterates over an array from a previous block. Config: `{ items: "{{fetch.messages}}" }`. Returns `{ items, count, processed }`.
- **`create-inbox-item` handler:** Stores data in inbox. Single item: `{ source, subject, body, from, assigneeUserId? }`. Batch: `{ source, assigneeUserId?, items: [...] }`. Per-item `assigneeUserId` overrides block-level. Used in sync workflows to persist fetched data before agent processing (Pattern A). After creating items, emits `inbox.item_created` event with `{ itemId, source }` in data — any `app.onEvent("inbox.item_created", handler)` subscriber is notified.
- **`emit-event` handler:** Emits connector events from workflow. Config: `{ connectorKind, eventType, data? }` or batch `{ items: [...] }`. Enables `routeToInbox()` to catch workflow-generated events.
- **Branching:** condition blocks return `selectedHandle` (e.g., `condition-true`/`condition-false`) that determines which downstream edges activate
- **Trigger types:** `cron`, `webhook`, `event`

### `@boringos/pipeline`

Pluggable job queue for agent execution.

- **`QueueAdapter<T>`** interface: `enqueue(job)`, `process(handler)`, `close()`
- **`createInProcessQueue(options?)`** — default, zero-config, no Redis. Default is serial (`concurrency: 1`); pass `{ concurrency: N }` to run up to N agents in parallel. Each slot spawns its own subprocess, so raise with care (RAM, Anthropic rate limits, DB pool). No persistence or retries. Bump via `BoringOS({ queue: { concurrency: N } })` config — no need to construct a queue yourself just to pick a number.
- **`createBullMQQueue({ redis, queueName?, concurrency? })`** — opt-in production queue backed by Redis. Persistent jobs, automatic retries, configurable concurrency.
- Default: in-process (no Redis required). Opt-in BullMQ via `.queue()` on `BoringOS` builder.

```typescript
// Default — no Redis needed
const app = new BoringOS({});

// Production — BullMQ with Redis
import { createBullMQQueue } from "@boringos/pipeline";
app.queue(createBullMQQueue({ redis: "redis://localhost:6379" }));
```

### `@boringos/workflow-ui` — React canvas + editor

React components for visualizing, editing, and observing workflows. Drop-in companion to `@boringos/workflow` — the engine ships the DAG runtime; this ships the UI. Used by the CRM's Workflows page and any BoringOS app that wants a visual workflow editor.

- **`WorkflowCanvas`** — `@xyflow/react` DAG renderer with auto-layout via dagre. `mode="view"` (live run status) or `mode="edit"` (drag/connect/delete with `onGraphChange`).
- **`BlockPalette`** — categorized list of all 14 block types with one-click add.
- **`BlockConfigForm`** — per-block-type config editor; dispatches to specialized forms (Trigger, Condition, ForEach, WakeAgent, …) with a JSON fallback for unknown types.
- **`RunDiffView`** — side-by-side replay of a historical workflow run (config + input + output per block).
- **Hooks:** `useWorkflows`, `useWorkflow`, `useCreateWorkflow`, `useUpdateWorkflow`, `useWorkflowRuns`, `useWorkflowRun` (subscribes to `/workflow-runs/:id/events` SSE for live block status).
- **Peer deps:** `react@>=18`, `@tanstack/react-query@>=5`. Bundles `@xyflow/react` + `@dagrejs/dagre`. Styling assumes Tailwind utility classes.

### `@boringos/connector` — SDK

The connector framework — implement this interface to integrate any external service.

- **`ConnectorDefinition`** — the one interface connector authors implement: `kind`, `name`, `oauth`, `events`, `actions`, `createClient()`, `handleWebhook()`, `skillMarkdown()`
- **`createConnectorRegistry()`** — register/lookup/list connectors
- **`createOAuthManager(config, clientId, clientSecret)`** — handles authorization URL, code exchange, token refresh
- **`createEventBus()`** — typed event bus, connectors emit events, framework routes them
- **`createActionRunner(registry)`** — agents invoke connector actions via callback API
- **`createConnectorTestHarness(connector)`** — test utility: mock OAuth, simulate webhooks, inspect events

### `@boringos/connector-slack`

Slack reference implementation. Usage: `app.connector(slack({ signingSecret: "..." }))`

- **Events:** `message_received`, `mention`, `reaction_added`
- **Actions:** `send_message`, `reply_in_thread`, `add_reaction`
- **Webhook handler** with signature verification
- **Skill file** teaches agents about channels, threads, formatting

### `@boringos/connector-google`

Google Workspace reference implementation. Usage: `app.connector(google({ clientId: "...", clientSecret: "..." }))`

- **Gmail actions:** `list_emails` (auto-enriched: returns subject, from, snippet, date — not just IDs), `read_email`, `send_email`, `search_emails`
- **Calendar actions:** `list_events`, `create_event`, `update_event`, `find_free_slots`
- **Events:** `email_received`, `calendar_event_created`, `calendar_event_updated`
- **Skill files** covering Gmail query syntax and Calendar scheduling guidelines

### `create-boringos` — CLI Generator

Scaffolds a new BoringOS project.

```bash
npx create-boringos my-app              # minimal template
npx create-boringos my-app --full       # full template with all integrations
```

- **`minimal` template** — `@boringos/core` only, 20-line `index.ts`, boots with zero config
- **`full` template** — includes memory, Slack, Google, BullMQ, custom context provider example
- Generates: `package.json`, `tsconfig.json`, `src/index.ts`, `.env.example`, `.gitignore`, `README.md`
- Template variables (`{{name}}`) replaced with project name
- Detects package manager (pnpm/yarn/npm) and runs install

### `@boringos/ui` — Headless React Hooks

Typed API client + React hooks for building dashboards on top of BoringOS. No markup, no styles — just data and mutations.

**API Client** (framework-agnostic, no React):
- `createBoringOSClient({ url, token? })` — typed fetch wrapper for all REST endpoints
- Methods: `health()`, `getAgents()`, `createAgent()`, `getTasks()`, `getTask()`, `createTask()`, `updateTask()`, `postComment()`, `addWorkProduct()`, `getRuns()`, `reportCost()`, `getConnectors()`, `invokeAction()`

**React Provider:**
- `<BoringOSProvider client={client}>` — wraps app with client context + TanStack Query

**React Hooks:**
| Hook | Returns | Mutations |
|---|---|---|
| `useAgents()` | agents list, loading | `createAgent`, `wakeAgent` |
| `useTasks(filters?)` | tasks list, loading | `createTask` |
| `useTask(taskId)` | task + comments | `updateTask`, `postComment`, `assignTask`, `addWorkProduct` |
| `useRuns(filters?)` | runs list (polls every 5s) | `cancelRun` |
| `useRuntimes()` | runtimes list | `createRuntime`, `setDefault` |
| `useApprovals(status?)` | approvals list | `approve`, `reject` |
| `useConnectors()` | connector list | `invokeAction` |
| `useHealth()` | server status (polls every 30s) | — |

**Usage:**
```tsx
import { BoringOSProvider, createBoringOSClient, useAgents } from "@boringos/ui";

const client = createBoringOSClient({ url: "http://localhost:3000", apiKey: "your-admin-key", tenantId: "your-tenant-id" });

function App() {
  return (
    <BoringOSProvider client={client}>
      <AgentList />
    </BoringOSProvider>
  );
}

function AgentList() {
  const { agents, isLoading, createAgent } = useAgents();
  // render with your own components...
}
```

### `@boringos/core`

Application host — the entry point.

- **`BoringOS`** class with builder pattern:
  - `.memory(provider)` — set memory provider
  - `.runtime(module)` — register additional runtime
  - `.contextProvider(provider)` — add custom context provider
  - `.persona(role, bundle)` — register custom persona
  - `.queue(adapter)` — set job queue adapter (default: in-process, opt-in: BullMQ)
  - `.blockHandler(handler)` — register custom workflow block handler
  - `.onEvent(type, handler)` — subscribe to EventBus events (e.g., `"inbox.item_created"`). Handler receives `ConnectorEvent`: `{ connectorKind, type, tenantId, data, timestamp }`.
  - `.plugin(manifest)` — register plugin
  - `.onTenantCreated(fn)` — hook called after a new tenant is provisioned (runtimes + copilot already created). Signature: `async (db, tenantId) => { ... }`. Use for app-specific tenant setup.
  - `.beforeStart(fn)` / `.afterStart(fn)` / `.beforeShutdown(fn)` — lifecycle hooks
  - `.route(path, app)` — mount custom Hono routes
  - `.listen(port?)` — boot everything and start HTTP server
- **Exportable auth middleware:** `createAuthMiddleware(db)` — resolves session → sets `X-Tenant-Id`, `X-User-Id`, `X-User-Role` headers. Apps mount on their own routes.
- **Agent callback API** (Hono routes at `/api/agent/*`, JWT authenticated):
  - `GET /tasks/:taskId` — read task + comments
  - `PATCH /tasks/:taskId` — update task status/title/description
  - `POST /tasks` — create task (subtasks via `parentId`)
  - `POST /tasks/:taskId/comments` — post comment
  - `POST /tasks/:taskId/work-products` — record deliverable
  - `POST /runs/:runId/cost` — report token usage
  - `POST /agents` — create agent
- **`GET /health`** — health check endpoint (unauthenticated)
- **Admin API** (Hono routes at `/api/admin/*`, API key authenticated via `X-API-Key` header):
  - Requires `X-Tenant-Id` header for tenant scoping
  - **Agents:** `GET/POST /agents`, `GET/PATCH /agents/:id`, `POST /agents/:id/wake`, `GET /agents/:id/runs`
  - **Tasks:** `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/comments`, `POST /tasks/:id/assign`
  - **Runs:** `GET /runs`, `GET /runs/:id`, `POST /runs/:id/cancel`
  - **Runtimes:** `GET/POST /runtimes`, `PATCH/DELETE /runtimes/:id`, `POST /runtimes/:id/default`
  - **Approvals:** `GET /approvals`, `GET /approvals/:id`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject`
  - **Tenants:** `GET /tenants/current`, `POST /tenants`
  - **Costs:** `GET /costs`
  - **Settings:** `GET /settings`, `PATCH /settings` (upsert key-value tenant settings, e.g. `{"agents_paused": "true"}`)
  - **Agent pause/resume:**
    - **Global pause:** `PATCH /settings` with `{ agents_paused: "true" }` — pauses ALL agents for the tenant. Set to `"false"` to resume.
    - **Per-agent pause:** `PATCH /agents/:id` with `{ status: "paused" }` — pauses individual agent. Set to `"idle"` to resume.
    - Already-running agents finish their current run (not killed). New runs get `status: "skipped"` with `errorCode: "agents_paused"` or `"agent_paused"`.
    - Events still fire, tasks still get created — only CLI spawning is blocked. Budget is not consumed during pause.
    - **Auto-re-wake on resume:** when `agents_paused` is set to `"false"`, the framework auto-re-wakes all agents with pending `todo` tasks.
    - **Auto-re-wake after run:** after any agent run completes, the engine checks for remaining `todo` tasks and auto-re-wakes if needed (prevents tasks from getting stuck when multiple events coalesce).
  - Configure admin key: `new BoringOS({ auth: { adminKey: "..." } })`
- **SSE / Realtime** (`GET /api/events`, API key + tenant ID authenticated):
  - Streams events as Server-Sent Events: `run:started`, `run:completed`, `run:failed`, `task:created`, `task:updated`, `task:comment_added`, `agent:created`, `approval:decided`
  - Subscribe via query params: `/api/events?apiKey=...&tenantId=...`
  - Engine publishes run lifecycle events automatically
  - Admin API publishes mutation events (create agent, create task, add comment, approve/reject)
  - `@boringos/ui` client: `client.subscribe(onEvent)` returns unsubscribe function
  - 30-second heartbeat keeps connection alive
  - In-memory EventEmitter (upgradeable to Redis pub/sub)
- **Auth API** (`/api/auth/*`):
  - `POST /signup` — create user. Accepts `tenantName` (creates new tenant, auto-seeds 6 runtimes + copilot agent, runs `onTenantCreated` hook), `inviteCode` (joins existing tenant from invitation), or `tenantId` (joins existing tenant directly). Returns `{ userId, token }`.
  - `POST /login` — authenticate, returns `{ userId, token, name, email, tenants: [{ id, name, role }] }` (all tenants user belongs to)
  - `GET /me` — get current user from session (Bearer token). Returns `{ id, name, email, tenants: [...] }`. Accepts `X-Tenant-Id` header to select active tenant (returns `tenantId` + `role` for that tenant).
  - `POST /logout` — invalidate session
  - **Invitations:**
    - `POST /invite` — create invite (admin only). Body: `{ email, role? }`. Returns `{ id, inviteCode, expiresAt }` (7-day expiry).
    - `GET /invitations` — list pending invitations for current tenant
    - `DELETE /invitations/:id` — revoke invitation
  - **Team management:**
    - `GET /team` — list users in current tenant
    - `PATCH /team/:userId/role` — change user role (admin only). Body: `{ role }`.
    - `DELETE /team/:userId` — remove user from tenant (admin only)
  - Admin API accepts both API key (`X-API-Key`) and session token (`Authorization: Bearer`)
  - Session auth sets `userId`, `tenantId`, and `role` on request context — apps use these for authorization
  - User-tenant linking via `user_tenants` table (role: admin/member)
  - **Exportable middleware:** `createAuthMiddleware(db)` exported from `@boringos/core` — resolves session token, sets `X-Tenant-Id`, `X-User-Id`, `X-User-Role` headers. Apps mount on their own routes instead of reimplementing.
- **Activity Log** — audit trail for all admin mutations:
  - Logged: agent.created, task.created, comment.created, approval.approved, approval.rejected
  - `GET /api/admin/activity` — paginated activity log
- **Budget enforcement:**
  - Budget policies: scope (tenant/agent), period (daily/weekly/monthly), limit in cents, warn threshold
  - Engine checks budget before each run — hard-stop if exceeded, warning at threshold
  - Admin API: `GET/POST/DELETE /api/admin/budgets`, `GET /api/admin/budgets/incidents`
  - Budget incidents logged with type (hard_stop/warning), spent vs limit
- **Routine scheduler:**
  - Cron-based recurring with 5-field cron expressions + timezone
  - **Dual target:** routines can target an agent (`assigneeAgentId`) OR a workflow (`workflowId`)
  - Agent-targeted: wakes the agent directly on schedule
  - Workflow-targeted: executes the workflow, which may conditionally wake agents via `wake-agent` blocks — enables "smart routines" that check before spawning expensive agent runs
  - Concurrency policies: `skip_if_active`, `coalesce_if_active`, `allow_concurrent`
  - Admin API: `GET/POST/PATCH/DELETE /api/admin/routines`, `POST /api/admin/routines/:id/trigger`
  - Scheduler starts on boot, checks every 60 seconds
- **Notifications:**
  - Email via Resend API (silently disabled if no `RESEND_API_KEY`)
  - Pre-built templates: task completed, run failed, approval needed, budget warning
  - `createNotificationService({ resendApiKey?, fromEmail? })`
- **Execution workspaces:**
  - `provisionWorkspace({ gitRoot, branchTemplate?, baseRef? }, task)` — creates git worktree
  - Branch template: `bos/{{identifier}}-{{slug}}` with token replacement
  - `cleanupWorkspace(gitRoot, worktreePath)` — removes worktree on task completion
- **Skill system:**
  - Sync skills from `local_path`, `github` (API), or `url` sources
  - Trust levels: `markdown_only`, `assets`, `scripts_executables` — controls allowed file types
  - `injectSkills(db, agentId, workDir, config)` — symlinks cached skills into agent working directory
  - Admin API: `GET/POST /api/admin/skills`, `POST/DELETE /api/admin/skills/:id/attach/:agentId`
- **Plugin system** (see [PLUGINS.md](PLUGINS.md) for full guide):
  - `PluginDefinition` interface: name, version, jobs (cron-scheduled), webhooks (inbound HTTP), state store
  - `createPluginRegistry()` — register/list/lookup plugins
  - Plugin job runner with persistent state per tenant+plugin
  - Webhook router: `POST /webhooks/plugins/:name/:event`
  - Admin API: `GET /api/admin/plugins`, `GET /api/admin/plugins/:name/jobs`, `POST /api/admin/plugins/:name/jobs/:job/trigger`
  - **Built-in GitHub plugin** — sync-repos job (every 15min), issue-created + pr-opened webhooks
  - `.plugin(definition)` on builder registers plugins
- **Projects:**
  - Organize tasks into projects with repo config (URL, default branch, branch template)
  - Per-project task prefix + auto-increment counter (`ALPHA-001`, `ALPHA-002`)
  - Admin API: `GET/POST /api/admin/projects`, `GET/PATCH /api/admin/projects/:id`
- **Goals:**
  - High-level objectives (planned/active/done/dropped)
  - Admin API: `GET/POST /api/admin/goals`, `PATCH /api/admin/goals/:id`
- **Task features:**
  - **Auto-identifiers** — `BOS-001` (tenant-level) or `ALPHA-001` (project-level), auto-incrementing
  - **Labels** — tag tasks with labels (name + color). Admin API: `GET/POST /api/admin/labels`, `POST/DELETE /api/admin/tasks/:id/labels/:labelId`
  - **Read states** — track which users have read each task. `POST /api/admin/tasks/:id/read`
  - **Attachments** — file attachments per task (`task_attachments` table)
  - **Checkout locks** — `checkout_run_id` column prevents concurrent agent work on same task
- **Drive features:**
  - **DriveManager** — wraps StorageBackend + DB. Writes file → indexes in `drive_files` → syncs text to memory
  - **File indexing** — `drive_files` table tracks path, filename, format, size, hash, memory sync status
  - **Memory sync** — text files (md, txt, json, yaml) auto-synced to memory provider on write
  - **Drive skill revisions** — `drive_skill_revisions` table, version history with rollback
  - Admin API: `GET /api/admin/drive/list`, `GET/PATCH /api/admin/drive/skill`, `GET /api/admin/drive/skill/revisions`
  - `createDriveManager({ storage, db, memory?, tenantId })` from `@boringos/drive`
- **Onboarding:**
  - 5-step wizard tracked in `onboarding_state` table (per tenant)
  - Admin API: `GET /api/admin/onboarding` (auto-creates state), `POST /api/admin/onboarding/complete-step`
  - Step metadata stored as JSON, completion tracked, `completedAt` set when all 5 steps done
  - `useOnboarding()` hook in `@boringos/ui`
- **Device auth (CLI login):**
  - GitHub-style device login flow for CLI tools
  - `POST /api/auth/device/code` — generate device code + user code (8-char hex)
  - `POST /api/auth/device/verify` — browser approves with user code
  - `POST /api/auth/device/poll` — CLI polls until approved, gets session token
  - 15-minute expiry on challenges
- **Evaluations:**
  - A/B test agent quality with structured test cases
  - Admin API: `GET/POST /api/admin/evals`, `POST /api/admin/evals/:id/run`, `GET /api/admin/evals/:id/runs`
  - `evals` table (name, test cases as JSON), `eval_runs` table (pass/fail counts, results)
  - `useEvals()` hook in `@boringos/ui`
- **Inbox:**
  - Receive and triage external messages/events, with optional `assigneeUserId` for user-level routing
  - Admin API: `GET /api/admin/inbox` (filter by `?assigneeUserId=me`), `GET /api/admin/inbox/:id` (marks read), `PATCH /api/admin/inbox/:id` (update metadata, status, assigneeUserId — agents write analysis results back), `POST /api/admin/inbox/:id/archive`, `POST /api/admin/inbox/:id/create-task` (defaults `assigneeUserId` to current user)
  - Items can be converted to tasks directly
  - `useInbox()` hook in `@boringos/ui`
- **Agent templates & teams:**
  - `createAgentFromTemplate(db, role, config)` — creates agent with built-in persona (resolves aliases: "sre" → "devops")
  - `createTeam(db, templateName, config)` — creates multiple agents with hierarchy already wired
  - **5 built-in team templates:** engineering (CTO + 2 engineers + QA), executive (CEO + CTO + PM + PA), content (lead + researcher), sales (director + researcher + engineer + coordinator), support (manager + tier 1 + tier 2)
  - Admin API: `POST /api/admin/agents/from-template`, `POST /api/admin/teams/from-template`, `GET /api/admin/teams/templates`
- **Agent hierarchy:**
  - `reportsTo` field — agents have a boss
  - `buildOrgTree(db, tenantId)` — recursive tree from flat agent list
  - **Hierarchy context provider** — injects org context into agent instructions ("You report to: CTO. Your reports: Engineer 1, Engineer 2. Delegate to reports, escalate to boss.")
  - `findDelegateForTask(db, agentId, taskTitle)` — role-based heuristic matching (code task → engineer, research task → researcher)
  - `escalateToManager(db, agentId, taskId, reason?)` — auto-creates escalation task for agent's boss when blocked
  - Admin API: `GET /api/admin/agents/org-tree`, `GET /api/admin/agents/:id/reports`
- **Custom schema integration:**
  - `.schema(ddl)` builder method — pass raw DDL strings, framework executes them after its own migrations
  - User tables can reference framework tables (FK to `tenants.id`, etc.)
  - User tables created automatically on boot
- **Entity linking:**
  - `entity_references` table links domain entities (contacts, deals) to framework entities (tasks, runs, inbox)
  - Admin API: `POST /api/admin/entities/link`, `GET /api/admin/entities/:type/:id/refs`, `DELETE /api/admin/entities/link/:id`
  - `useEntityRefs(type, id)` hook
- **Event-driven architecture:**
  - `app.onEvent(type, handler)` — subscribe to EventBus events. Handler receives `ConnectorEvent`: `{ connectorKind, type, tenantId, data, timestamp }`.
  - `AppContext.eventBus` — available in lifecycle hooks and routes. Call `ctx.eventBus.emit({ connectorKind, type, tenantId, data, timestamp })` to emit custom events.
  - Built-in event: `inbox.item_created` — emitted by `create-inbox-item` workflow handler with `{ itemId, source }` in data. Subscribe to wake agents, trigger enrichment, etc.
  - Pattern: ingest workflow -> create-inbox-item -> emits `inbox.item_created` -> `app.onEvent("inbox.item_created", handler)` -> wake triage/enrichment agent
  - Events make the system reactive — connectors emit events, workflow handlers emit events, app routes can emit events. Agents wake on events instead of polling.
- **Event-to-inbox routing:**
  - `.routeToInbox({ filter, transform })` — declaratively route connector events to inbox
  - Filter decides which events become inbox items, transform maps event data to inbox fields (`source`, `subject`, `body?`, `from?`, `assigneeUserId?`)
- **Cross-entity search:**
  - `GET /api/admin/search?q=query` — searches across tasks (title + description), agents (name), inbox items (subject + body)
  - Returns grouped results: `{ tasks, agents, inboxItems }`
  - `useSearch(query)` hook
- **Copilot (multi-tenant):**
  - Built-in system agent (role: `copilot`) — auto-created per tenant (on signup when using `tenantName`, or at boot for the first tenant)
  - Conversational AI assistant that can both **operate** (manage entities via admin API) and **build** (read/edit code)
  - Sessions are tasks with `originKind: "copilot"`, messages are comments — reuses the existing agent execution pipeline
  - User posts a message → auto-wakes copilot agent → agent reads codebase + admin API → replies as comment
  - Persona: knows BUILD_GUIDELINE.md, CLAUDE.md, admin API schema, how to read/edit source files
  - API: `POST /api/copilot/sessions` (create), `GET /api/copilot/sessions` (list), `GET /api/copilot/sessions/:id` (messages), `POST /api/copilot/sessions/:id/message` (send + auto-wake)
  - **Multi-tenant:** `/api/copilot/*` resolves tenant from session token — no longer hardcoded to first tenant. Works for all dynamically created tenants.
  - Agent result auto-posted as comment after each run — replies appear in chat UI
  - Zero configuration — every BoringOS app gets a copilot automatically
- **Agent permissions:**
  - All agents run with `--dangerously-skip-permissions` — full file read/write access for autonomous operation
  - No interactive approval needed — agents edit code, create files, run commands in background
- **Auto-post agent results:**
  - After every agent run on a task, the framework extracts the result text and posts it as a comment with `authorAgentId`
  - Enables conversational workflows: user comments → agent wakes → agent replies as comment → user sees reply

---

## Agent Execution Pipeline

```
1. Wake request    →  createWakeup() with coalescing
2. Enqueue         →  in-process job queue
3. Fetch agent     →  DB lookup
4. Create run      →  agent_runs row (status: running)
5. Build context   →  ContextPipeline runs all providers
   ├── System instructions: header → persona → guidelines → skills → protocol
   └── Context markdown: session → task → comments → memory → approval
6. Resolve runtime →  DB lookup → registry.get(type)
7. Execute         →  runtime.execute() spawns CLI subprocess
8. Stream output   →  callbacks: onOutputLine, onStderrLine, onCostEvent
9. Complete        →  update run status, persist session state
```

---

## Callback API Authentication

The callback API uses **HMAC-SHA256 signed JWTs** (4-hour expiry, no external dependency).

- **Token generation:** The engine signs a JWT when spawning an agent run, containing `{ sub: runId, agent_id, tenant_id, exp }`
- **Token delivery:** Injected as `BORINGOS_CALLBACK_TOKEN` env var into the agent subprocess
- **Token verification:** Middleware on all `/api/agent/*` routes verifies signature + expiry
- **Claims extraction:** Routes read `agentId`/`tenantId` from JWT claims, not from request body — agents cannot impersonate others
- **`/health` is unauthenticated** — no token needed
- **Secret:** Configured via `auth.secret` in `BoringOSConfig` (defaults to random per boot)
- **JWT utilities:** `signCallbackToken()` and `verifyCallbackToken()` exported from `@boringos/agent`

---

## Key Patterns

### Adding a custom context provider

```typescript
const myProvider: ContextProvider = {
  name: "my-context",
  phase: "context",  // "system" or "context"
  priority: 25,      // lower = earlier
  async provide(event) {
    return `## My Section\n\nCustom context for ${event.agent.name}`;
  },
};

const app = new BoringOS({});
app.contextProvider(myProvider);
```

### Adding a custom runtime

```typescript
const myRuntime: RuntimeModule = {
  type: "my-tool",
  async execute(ctx, callbacks) { /* spawn subprocess */ },
  async testEnvironment(config) { /* check availability */ },
  skillMarkdown() { return "Instructions for agents using this runtime"; },
};

const app = new BoringOS({});
app.runtime(myRuntime);
```

### Adding a custom workflow block handler

```typescript
const myHandler: BlockHandler = {
  types: ["send-email"],
  async execute(ctx) {
    const { to, subject, body } = ctx.config;
    // ... send the email
    return { output: { sent: true, to } };
  },
};

const app = new BoringOS({});
app.blockHandler(myHandler);
```

### Workflow-triggered routine (smart scheduling)

Instead of waking an agent on every cron tick, use a workflow that checks first:

```typescript
// Create a workflow that fetches emails, checks if any are new, and only then wakes the agent
const workflow = await admin.createWorkflow({
  name: "Email sync check",
  type: "system",
  blocks: [
    { id: "trigger", name: "trigger", type: "trigger", config: {} },
    { id: "fetch", name: "fetch", type: "connector-action", config: {
      connectorKind: "google", action: "list_emails", inputs: { query: "newer_than:15m" }
    }},
    { id: "check", name: "check", type: "condition", config: {
      field: "{{fetch.success}}", operator: "equals", value: "true"
    }},
    { id: "wake", name: "wake", type: "wake-agent", config: { agentId: "email-triage-id" }},
  ],
  edges: [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "fetch", targetBlockId: "check", sourceHandle: null, sortOrder: 0 },
    { id: "e3", sourceBlockId: "check", targetBlockId: "wake", sourceHandle: "condition-true", sortOrder: 0 },
  ],
});

// Create routine targeting the workflow instead of an agent
await admin.createRoutine({
  title: "Email sync",
  workflowId: workflow.id,  // ← workflow, not agent
  cronExpression: "*/15 * * * *",
});
```

### Using memory

```typescript
import { BoringOS, createHebbsMemory } from "@boringos/core";

const app = new BoringOS({});
app.memory(createHebbsMemory({
  endpoint: "https://api.hebbs.ai",
  apiKey: "...",
}));
```

---

## Database

Uses `tenantId` throughout (not `companyId`). Multi-tenant by default.

Schema lives in `packages/@boringos/db/src/schema/`. ORM is Drizzle.

**To use external Postgres:**
```typescript
new BoringOS({ database: { url: "postgres://..." } });
```

**Embedded Postgres (default):** boots automatically, data stored in `.data/postgres`.

---

## Testing

Tests live in `tests/` at the repo root. Uses Vitest. Tests accumulate per phase.

```bash
pnpm test:run    # single pass (126 tests)
pnpm test        # watch mode
```

| File | Phase | Tests |
|---|---|---|
| `phase1-smoke.test.ts` | Package implementations | 21 |
| `phase2-smoke.test.ts` | Context providers + personas | 18 |
| `phase3-golden.test.ts` | Full agent execution e2e | 1 |
| `phase4-workflow.test.ts` | Workflow engine + DAG + handlers | 13 |
| `phase5-auth.test.ts` | JWT auth + callback API protection | 6 |
| `phase6-connectors.test.ts` | Connector SDK, Slack, Google, integration | 15 |
| `phase7-cli.test.ts` | CLI generator scaffolding | 4 |
| `phase8-ui.test.ts` | API client + list endpoints | 2 |
| `phase9-admin-api.test.ts` | Admin API CRUD + auth + approvals | 4 |
| `phase10-sse.test.ts` | Realtime bus + SSE endpoint auth | 5 |
| `phase11-auth-activity.test.ts` | User auth + activity logging | 4 |
| `phase12-tier2.test.ts` | Budget, routines, notifications, skills | 4 |
| `phase13-plugins.test.ts` | Plugin system + GitHub plugin | 3 |
| `phase14-projects-tasks.test.ts` | Projects, goals, labels, auto-identifiers | 2 |
| `phase15-drive.test.ts` | DriveManager, file indexing, skill revisions | 2 |
| `phase16-final-tier3.test.ts` | Onboarding, device auth, evals, inbox | 4 |
| `phase17-improvements.test.ts` | Custom schema, entity linking, search | 3 |
| `phase18-workflow-routines.test.ts` | wake-agent handler, connector-action handler, workflow-triggered routines | 7 |
| `phase19-hierarchy.test.ts` | Agent templates, team templates, org tree, delegation | 4 |
| `phase20-sync-handlers.test.ts` | for-each, create-inbox-item, emit-event handlers | 4 |

---

## Code Style

- TypeScript ESM (`"type": "module"`, `.js` imports for local files)
- `tenantId` everywhere (framework-agnostic multi-tenancy)
- Every component implements `SkillProvider` — ships `skillMarkdown()` alongside TypeScript API
- Convention over configuration — sensible defaults, minimal required config
- In-process by default, external services (Redis, Postgres) opt-in

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | HTTP listen port |
| `DATABASE_URL` | (none) | External Postgres. If absent, embedded PG is used |

Memory (optional):
| `HEBBS_ENDPOINT` | (none) | Hebbs memory service URL |
| `HEBBS_API_KEY` | (none) | Hebbs API key |
| `HEBBS_WORKSPACE` | (none) | Hebbs workspace scoping |
