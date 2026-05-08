# Blocker — task_12: Greenfield rebuild on Skills + Tools + Modules

> **Status:** Plan only. No code in this doc — specs and decisions
> only. Implementation is sequenced into phases at the bottom.
> Greenfield: every existing tenant's data is wiped at cutover.

This doc is the single source of truth for the rebuild. Read it
top to bottom before writing the first line of v2 code. If a
question is not answered here, answer it in this doc first, not in
code.

---

## 1. Goals

1. **Two primitives the agent reads — Skills and Tools — and
   nothing else.** The agent's prompt becomes data, not code.
2. **One component shape — the Module — covering connectors,
   apps, plugins, and built-in subsystems.** Same registration
   verb, same lifecycle, same install/uninstall semantics.
3. **One tool dispatch path** — `POST /api/tools/<module>.<name>`
   with schema-validated inputs. No more three parallel URL
   patterns, no more silent field drops, no more drift between
   docs and handler.
4. **Copilot is a module, not a special tree.** No
   `/api/copilot/*` API. Copilot is an agent that runs on tasks
   like every other agent.
5. **A new package, dependency, or capability extends the
   framework with zero core edits.** The test of correctness:
   adding Notion is a Module package; the framework doesn't
   change.
6. **Feature parity at cutover.** Every capability that works in
   v1 must work in v2 — possibly relocated (e.g. into a Module),
   possibly re-skinned (e.g. through a different URL), but not
   regressed. Greenfield wipes *data*; it does not drop
   *features*. See §1b for the canonical parity matrix.

---

## 1b. Parity matrix — every v1 feature has a v2 home

This table is the contract behind goal #6. Every row is a v1
feature; every row maps to where it lives in v2. **No row may be
"dropped" without an explicit replacement** — and the only
acceptable replacements are listed here.

| v1 feature | Lives in v2 as | Notes |
|---|---|---|
| Agent execution pipeline (12 providers) | Same engine + 7 providers (5 per-run-context + skills + tool-catalog) | Provider count drops; behavior preserved |
| Per-task sessions | Unchanged | `tasks.session_id` invariant kept |
| JWT-authed agent callbacks | Unchanged (URL changes to `/api/tools/*`) | Same JWT shape and middleware |
| Pluggable runtimes (Claude Code, Codex, Gemini, Ollama, Command, Webhook) | Unchanged | RuntimeModule interface stays |
| Workflow engine + DAG | `workflow` Module — `workflow.run` tool, 5 control-flow primitives, every tool is a block | See §13b |
| Visual workflow editor | Same canvas; palette = control-flow primitives + tool registry | See §13b.4 |
| 9 built-in BlockHandlers | 5 built-in control-flow nodes + tool blocks for the rest | See §13b.8 migration table |
| Connector framework + Slack + Google | `connector-slack`, `connector-google` Modules | OAuth, tools, skills all carried over |
| Plugin system + GitHub plugin | `connector-github` Module (capability + connector hybrid) | Plugin shape collapses into Module |
| Memory provider (Hebbs + null) | `memory` built-in Module | Tools: `memory.{remember, recall, prime, forget}` |
| Drive (StorageBackend + DriveManager) | `drive` built-in Module | Tools: `drive.{read, write, list, delete, stat, move}` |
| Inbox + triage workflow | `inbox` built-in Module + `triage` capability Module | Same DB columns, plus thread-aware (task_09) |
| Approvals (collapsed-into-tasks model from task_06) | Unchanged — `originKind: "agent_action"` tasks | Default-deny posture taught via framework SKILL.md |
| Approval decision endpoint | `framework.tasks.decide` tool (admin-callable) | Same comment-snapshot behavior from task_07 |
| Copilot (per-tenant assistant) | `copilot` built-in Module | See §12; no `/api/copilot/*` |
| Routine scheduler | Same scheduler; routines target `<module>.<tool>` | Workflow targets become `workflow.run` calls |
| Budget enforcement (policies + incidents) | Unchanged | Hooked into the tool dispatcher |
| Notifications (Resend) | `notifications` Module | Tools: `notify.{email, slack}`; templates kept |
| Execution workspaces (git worktrees) | Unchanged | Provisioned by run lifecycle |
| Admin skill system (github sync, attach, working-dir symlinks) | `tenant-skills` Module + `module_skill_overrides` table | Same UX, new shape |
| Agent personas (12 bundles, role aliases) | `personas-default` Module — one SKILL.md per role | Role aliases kept |
| Agent hierarchy (`reportsTo`, org tree, escalation) | Unchanged | `hierarchy` per-run provider stays |
| Agent templates + team templates | Same admin endpoints | Templates may move into a `team-templates` Module |
| Auth API (signup/login/logout/me) | Unchanged | Session-based |
| Invitations + team management | Unchanged | |
| Activity log | Unchanged | Plus new `tool_calls` audit |
| SSE / Realtime (`/api/events`) | Unchanged | New event types added (`tool:invoked`, `module:installed`) |
| Onboarding wizard | Unchanged | |
| Device auth (CLI login) | Unchanged | |
| Evals + eval runs | `evals` Module | Same shape, packaged |
| Projects + auto-IDs | Unchanged | |
| Goals | Unchanged | |
| Labels + read states + attachments | Unchanged | |
| Checkout locks (`checkout_run_id`) | Unchanged | Prevents concurrent agent work on same task |
| Custom schema integration (`.schema(ddl)`) | Replaced by `Module.schema` migrations | Same capability, namespaced naming |
| Entity linking (`entity_references`) | Unchanged | |
| Event-driven architecture (`app.onEvent`) | Modules subscribe via `Module.events` field | One subscription mechanism |
| Event-to-inbox routing (`.routeToInbox`) | The `inbox` Module's webhook + event handlers | Declarative config preserved |
| Cross-entity search | Unchanged | Admin endpoint walks framework + module tables |
| Auto-post agent results | Unchanged | `afterRun` hook posts result as comment |
| Agent pause/resume (global + per-agent) | Unchanged | Same tenant_settings + agent.status fields |
| Auto-rewake-after-run discipline | Unchanged | With A.2's same-task guard preserved |
| Wakeup mechanism (queue, coalescing, recovery) | Same mechanism, single tool path | See §13c; no separate wakeup table |
| `@boringos/ui` React hooks | Updated for new endpoints | Hook names and shape preserved where possible |
| `create-boringos` CLI generator | Updated to scaffold v2 Modules | Templates: `module`, `connector`, `capability` |
| Cost tracking (token + USD) | Unchanged | |
| Multi-tenant isolation | Unchanged | Every table tenant-scoped, every tool ctx tenant-scoped |
| `--dangerously-skip-permissions` for agents | Unchanged | Agents still run with full tool access |
| Embedded Postgres + Drizzle | Unchanged | |
| In-process default queue + BullMQ opt-in | Unchanged | |
| `+ New task` modal (UI feature from BOS-010) | Unchanged | |
| Per-tenant settings (`tenant_settings`) | Unchanged + new keys for tool rate limits | |
| Tasks rich UX (intent tabs, two-pane, decision card) | Unchanged | |
| Inbox rich UX (read/unread/snoozed/archived/superseded) | Unchanged | task_09's `superseded` status preserved |
| Drive skill revisions | Drops as a vestige; tenant-skill-overrides covers the use case | One row in deletion list (§3) |

### Parity verification

Before cutover, the team runs through every row of this matrix
on a staging tenant and verifies the v2 implementation matches v1
behavior. Any row that doesn't pass blocks cutover. The matrix is
also encoded as an integration test suite in
`tests/v2-parity.test.ts` — every feature gets at least one
end-to-end assertion.

---

## 2. Non-goals

- **No backwards compatibility.** Old API trees, old DB rows, old
  context providers, old admin endpoints — all deleted at cutover.
- **No migration of tenant data.** Greenfield. Existing tenants
  re-onboard.
- **No multi-language support.** TypeScript-only modules, same as
  today.
- **No swappable transport.** HTTP + JSON + Bearer JWT, full stop.
  No MCP, no SSE-as-RPC, no protobuf.
- **No new LLM provider abstractions.** Agents still spawn CLI
  subprocesses (Claude Code, Codex, Gemini); v2 doesn't change
  that contract.
- **No new persistence engine.** Postgres + Drizzle, same as
  today. Embedded for dev, external in prod.

---

## 3. What we are explicitly deleting

These are gone at cutover, in code and in DB:

### Code (deleted packages or major modules)
- `BlockHandler` registry and the workflow handlers
  (`condition`, `delay`, `transform`, `wake-agent`,
  `connector-action`, `for-each`, `create-inbox-item`,
  `emit-event`). Workflows return as a tool that *invokes* other
  tools, but the registry-of-handlers shape goes.
- `PluginDefinition` (jobs / webhooks / state). Replaced by
  Module.
- `ConnectorDefinition.actions[]`. Replaced by Module.tools.
- `ConnectorDefinition.skillMarkdown()`. Replaced by SKILL.md
  files.
- The 6 hand-written context providers: `memory-skill`,
  `drive-skill`, `approvals-skill`, `chief-of-staff`,
  `api-catalog`, `connector-actions-catalog`.
- The hand-curated curl block in `protocol.ts`.
- The `extraRoutes` array on the BoringOS builder
  (`app.route(path, hono, { agentDocs })`).
- The `/api/copilot/*` API tree.
- The `/api/connectors/actions/*` API tree.
- The `/api/agent/*` API tree (for agent calls — moved to
  `/api/tools`).
- The `injectSkills` working-dir symlink mechanism. (Tenant skills
  re-enter as a different kind of Module source — see §13.)

### Database tables (deleted at cutover, no migration)
- `approvals` (already a vestige; collapsed into `tasks` in
  task_06).
- `agent_wakeup_requests` (queue state masquerading as a table).
- `tasks_skills` (admin skill ↔ agent attachment table — replaced
  by Module install state).
- `skills` table (admin skill registry — replaced by Module
  registry).
- `drive_skill_revisions` (vestige; drive becomes a Module).
- `plugin_state` (folded into per-Module state).

### Concepts
- "Connector" as a separate concept from "App" or "Plugin." All
  three were trying to be the same thing.
- "skillMarkdown()" as a TypeScript function. Skills are files.
- "agentDocs" as a per-route field. Documentation comes from
  Module-level SKILL.md.

---

## 4. The new mental model

### 4.1 Two prompt primitives

The agent's system prompt has exactly two primitives, both
sourced from registries:

| Primitive | What it is | Where it comes from | How it's rendered |
|---|---|---|---|
| **Skill** | Markdown teaching | `SKILL.md` files in modules + per-agent role/instructions | `## Skills` section, one block per skill, ordered by source priority |
| **Tool** | Callable operation inventory | Module manifests | `## Available tools` section, one block per tool, listing name + description + inputs |

Plus five per-run context providers (unchanged from today,
because they're per-run not per-component): task data,
conversation thread, session continuity hint, memory recall,
approval-pending hint. These five remain because they inject the
*current* state of the world, not reusable instruction.

### 4.2 One component shape

A **Module** is the universal shape. Every component author writes
one:

- A connector (Slack, Gmail, Salesforce) is a Module.
- An app (CRM, support desk, project board) is a Module.
- A plugin (GitHub sync, observability hooks) is a Module.
- A built-in subsystem (memory, drive, approvals) is a Module.
- The framework itself ships a built-in Module (`framework`) with
  the core tools (tasks.\*, comments.\*, runs.\*).

Three roles a Module can play (same shape, different fields
populated; see §11):

- **Connector module** — owns OAuth, brokers a 3rd-party API,
  exposes raw API verbs as tools.
- **Capability module** — owns business logic, declares
  `dependsOn` on connectors, composes their tools.
- **Hybrid module** — owns its own data + logic, optionally
  integrates with 3rd parties.

### 4.3 The agent's contract

> The agent receives a task with a conversation thread. The system
> prompt contains its persona's skill, the skills of every module
> loaded for the tenant (gated by per-agent applicability), and
> the inventory of every tool it can call (also gated). The agent
> reasons. It calls tools. It posts comments. **Side effects
> happen only through tools.** Continuity happens only through the
> per-task session. When stuck, it hands the task back to a user.
> When done, status=done.

There is no other API surface for the agent to learn. No
connector endpoints, no app routes, no copilot endpoints, no
hand-curated curl examples. **One URL pattern, one auth header,
one input format.**

---

## 5. The new data model

13 tables (down from 17). Each table has explicit ownership: which
module manages it. The `framework` module owns most; some are
reserved for capability modules to extend (via `Module.schema`
migrations).

### 5.1 Tables owned by the `framework` module

| Table | Purpose | Notes |
|---|---|---|
| `tenants` | Tenant root | Unchanged |
| `users` | User identities | Unchanged |
| `user_tenants` | User ↔ tenant membership + role | Unchanged |
| `sessions` | Auth session tokens | Unchanged |
| `invitations` | Pending tenant invites | Unchanged |
| `agents` | Agent identities | `instructions` column repurposed as per-agent skill markdown; `role` column drives default persona skill load |
| `tasks` | Work units | Unchanged shape; `originKind` enum extended to include `copilot_message` |
| `task_comments` | Conversation thread per task | Unchanged |
| `task_work_products` | Deliverables per task | Unchanged |
| `agent_runs` | Run lifecycle + log | Unchanged |
| `cost_events` | Token + USD costs per run | Unchanged |
| `activity_log` | Audit trail of admin mutations | Unchanged |

### 5.2 Tables owned by built-in modules

| Table | Owning module | Purpose |
|---|---|---|
| `module_installs` | `framework` | Per-tenant record of which modules are installed + their config |
| `module_credentials` | `framework` | OAuth tokens per (tenant × module). Replaces `connectors` table. |
| `tool_calls` | `framework` | Audit log of every tool invocation (request + response + duration + status) — replaces ad-hoc logging today |
| `inbox_items` | `inbox` | Inbound messages from connector modules |
| `routines` | `framework` | Cron-scheduled tool calls. Targets `<module>.<tool>` directly. |
| `budget_policies` | `framework` | Spend caps |
| `budget_incidents` | `framework` | Cap breaches |
| `tenant_settings` | `framework` | Key-value per-tenant settings |
| `drive_files` | `drive` | File metadata + content addressable hash |

### 5.3 Tables capability modules may add (via `Module.schema`)

Module-owned tables are namespaced: `<module-id>__<table-name>`
(e.g. `crm__deals`, `crm__contacts`). This gives:

- A clear naming rule
- Easy DROP-on-uninstall (drop everything matching the prefix)
- Zero collision risk between independent modules

### 5.4 Tables deleted at cutover

`approvals`, `agent_wakeup_requests`, `tasks_skills`, `skills`,
`drive_skill_revisions`, `plugin_state`, `connectors` (replaced by
`module_credentials`), the per-app schema tables of the legacy
boringos-crm repo (greenfield rebuild as a hybrid module).

---

## 6. The new API surface

Four trees. Three auth models.

| Tree | Purpose | Auth | Consumer |
|---|---|---|---|
| `/api/auth/*` | Signup, login, sessions, invites, team management | None for signup/login; session token thereafter | Browser |
| `/api/admin/*` | REST CRUD for human-facing UIs (agents, tasks, modules, routines, budgets, etc.) | Session token (browser) or API key (CLI) + `X-Tenant-Id` | Browser, CLI tooling |
| `/api/tools/*` | The single agent-callable tool dispatch endpoint | Bearer JWT (issued per agent run) | Agent subprocesses |
| `/api/webhooks/<module-id>/<event>` | Inbound 3rd-party events, dispatched to the owning module | Module-defined (HMAC sig, query secret, etc.) | 3rd parties |

Plus one always-on read channel:

| `/api/events` | SSE stream of task / run / approval events | API key + tenant id (query string for browsers) | Shell, dashboards |

**Trees that are gone:**
- `/api/agent/*` — collapsed into `/api/tools/*`
- `/api/connectors/actions/*` — collapsed into `/api/tools/*`
- `/api/copilot/*` — copilot is a module; its messages are task
  comments via `/api/admin/tasks/<id>/comments`
- `/webhooks/plugins/*` — moved to `/api/webhooks/<module-id>`

### 6.1 The single tool URL

Every tool is reachable at exactly one URL:

```
POST /api/tools/<module-id>.<tool-name>
```

The tool name is dotted: module id on the left, tool name on the
right. E.g. `gmail.send_email`, `crm.create_deal`,
`framework.tasks.patch`. The `framework` module's tools include
all the operations that today live under `/api/agent/*` (read
task, update task, post comment, record work product, report
cost, etc.).

**Headers:** `Authorization: Bearer $BORINGOS_CALLBACK_TOKEN` (the
agent's per-run JWT), `Content-Type: application/json`.

**Body:** JSON matching the tool's input schema.

**Response:** Always JSON. Two shapes:
- Success: `{ "ok": true, "result": <handler return value> }`
- Failure: `{ "ok": false, "error": { "code": "...", "message":
  "...", "details": <optional> } }`

**Status codes:**
- `200` — handler ran (regardless of business outcome — even a
  validation failure inside the handler returns 200 with
  `ok: false`)
- `400` — input failed schema validation (Zod error in
  `error.details`)
- `401` — token invalid or expired
- `403` — module not installed for this tenant, or tool not
  available for this agent's permissions
- `404` — unknown tool
- `429` — rate limited (per-tenant or per-tool budget)
- `5xx` — framework bug

---

## 7. Auth model

### 7.1 Three auth flows

1. **Browser session** — user logs in, gets a session token
   (already implemented; keep). Session resolves to userId +
   tenantId + role. Used for `/api/auth/*`, `/api/admin/*`,
   `/api/events` (with tenantId).
2. **CLI / programmatic API key** — admins issue an API key per
   tenant. Used for `/api/admin/*` and `/api/events`. Same
   auth-shape as today.
3. **Agent run JWT** — generated by the framework when spawning
   an agent run, embedded as `BORINGOS_CALLBACK_TOKEN` env var.
   Used for `/api/tools/*`. Claims: `{ sub: runId, agent_id,
   tenant_id, exp }`. Already implemented; keep.

### 7.2 Tool authorization rules

A tool call is allowed if all of:
1. The JWT is valid + unexpired.
2. The tool's owning module is installed for the JWT's tenant.
3. The agent's role is permitted to call this tool (per-tool
   permission, optional; default: any agent of this tenant).

Admin override: `tenant_settings` may set `tool.<name>.requires`
to a role list, gating specific tools to specific roles. Default
is open within tenant.

### 7.3 Webhook auth

Each Module declares its own webhook auth strategy in the
manifest (HMAC SHA-256 with a per-Module secret; query string
secret; mTLS). The framework dispatches based on the URL prefix
`/api/webhooks/<module-id>/...`; the Module verifies the rest.

---

## 8. The Tool spec

Every Tool has exactly these fields:

| Field | Type | Required | Purpose |
|---|---|---|---|
| `name` | string | yes | Local name within the Module. URL becomes `<module-id>.<name>`. |
| `description` | string | yes | One sentence shown to the agent in the catalog |
| `inputs` | Zod schema | yes | Input contract; framework validates before dispatch |
| `output` | Zod schema | optional | Output contract; framework validates before returning to caller |
| `handler` | function | yes | `(inputs, ctx) => Promise<output>` |
| `permissions` | string[] | optional | Roles that can call this tool; default open |
| `idempotency` | "none" \| "key" | optional | If "key", framework requires `Idempotency-Key` header and dedupes |
| `costHint` | "cheap" \| "moderate" \| "expensive" | optional | Hint for budget enforcement and routine scheduling |
| `examples` | object[] | optional | Sample input/output pairs shown to the agent for non-obvious schemas |

### 8.1 Tool naming rules

- Module ids are lowercase, hyphen-separated: `prevent-churn`,
  `hebbs-crm`, `connector-google`.
- Tool names are lowercase, snake-case, verb-led:
  `send_email`, `list_deals`, `mark_blocked`.
- Full name: `<module-id>.<tool-name>`. The dotted full name is
  the URL path component.
- Reserved prefix: `framework.*` — only the framework Module may
  register these. They are: `framework.tasks.read`,
  `framework.tasks.create`, `framework.tasks.patch`,
  `framework.comments.post`, `framework.work_products.record`,
  `framework.runs.report_cost`, `framework.agents.create`,
  `framework.inbox.read`, `framework.inbox.update`.

### 8.2 Tool error model

Every tool handler returns either a success result or a
structured error. Errors have:

- `code` — machine-readable enum (`invalid_input`,
  `not_found`, `permission_denied`, `upstream_unavailable`,
  `rate_limited`, `internal`)
- `message` — human-readable string the agent can show
- `retryable` — boolean; true if the agent should retry
- `details` — optional structured data (Zod errors, upstream
  response body, etc.)

Agents are taught (in the framework SKILL.md): on `retryable:
true` errors, retry with backoff; on `retryable: false`, post a
comment explaining what failed and either ask for help or mark
blocked.

### 8.3 Tool audit

Every tool call writes a `tool_calls` row:

- `id`, `tenantId`, `runId`, `agentId`, `taskId`
- `toolName`, `inputs` (jsonb), `result` (jsonb), `error` (jsonb)
- `startedAt`, `endedAt`, `durationMs`
- `status` (`ok`, `error`, `validation_failed`)

This replaces today's ad-hoc logging and gives every tool a
uniform audit trail, queryable from the admin UI ("show me every
send_email this tenant has done in the last 7 days").

---

## 9. The Skill spec

A Skill is a markdown file. The framework loads it as-is; no
templating, no preprocessing. (Variables the agent needs come
from per-run context providers, not the skill body.)

### 9.1 File format

`SKILL.md` — plain markdown with optional YAML frontmatter:

- `id` (string) — defaults to the module id; override only for
  multi-skill modules
- `appliesTo` (object) — optional: gate on agent role, task
  origin, etc. Keys: `roles: [...]`, `taskOrigins: [...]`. Default:
  always applies.
- `priority` (number) — ordering hint within the prompt. Default
  100; framework SKILL.md is 50; persona skill is 200; per-agent
  instruction skill is 300.
- `requires` (string[]) — list of tools this skill teaches the
  agent to use; framework cross-references against the actual
  tool registry to flag drift (a skill that mentions a non-
  existent tool fails Module load with a clear error).

The body is plain markdown. Convention: lead with what the skill
teaches in one sentence, then sections, then optional examples.

### 9.2 Skill sources, in order

A Module may ship one or more SKILL.md. They load in this order
into the prompt's `## Skills` section:

1. Framework's built-in skills (priority 50): `tool-protocol`,
   `approvals`, `when-stuck`.
2. Module-shipped skills, in the order modules were registered,
   sorted by `priority` within each module.
3. Per-agent persona skill (priority 200) — sourced from
   `agents.persona_skill_id`, which references a built-in persona
   pack like `cto`, `engineer`, `pa`.
4. Per-agent instruction skill (priority 300) — sourced from the
   `agents.instructions` text column. Per-agent custom text.
5. Tenant override skill (priority 400) — sourced from a
   per-tenant `module_skill_overrides` table that lets a tenant
   replace any module's SKILL.md with a curated version.

Higher-priority skills appear later in the prompt (closer to the
task) so they have more influence on agent behavior.

### 9.3 Personas as skills

Today: persona bundles are markdown files in
`packages/@boringos/agent/src/personas/<role>/*.md`.

Tomorrow: each role is a Module with one or more SKILL.md files.
Roles are themselves modules (e.g. `persona-cto`, `persona-pa`).
Selecting a persona for an agent = setting
`agents.persona_module_id`. Removes the special-case persona
loader.

### 9.4 Tenant skill overrides

The legacy admin skill system (github sync, working-dir symlinks)
is gone. Tenant-curated content re-enters via:

- `module_skill_overrides` table: `(tenantId, moduleId, body
  text)`. Replaces a module's bundled SKILL.md with a tenant
  version. Edited via the admin UI.
- Working-dir extras (style guides, runbooks): keep, but redo as
  a `tenant-skills` Module. Sync from git/url, attach to roles,
  ship into the prompt as additional skill blocks. Same Module
  shape — no separate registry.

---

## 10. The Module manifest

### 10.1 Required fields

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Stable identifier; lowercase, hyphen-separated |
| `name` | string | Human-friendly display name |
| `version` | string | Semver |
| `description` | string | One sentence |

### 10.2 Optional fields

| Field | Type | Purpose |
|---|---|---|
| `dependsOn` | object[] | `{ moduleId?, capability? }`. Either a hard module dep or a capability dep. |
| `provides` | string[] | Capabilities this module announces (e.g. `crm-source`, `email-sender`) |
| `skills` | SkillFile[] | Paths to SKILL.md files in the package |
| `tools` | Tool[] | Tools (see §8) |
| `routines` | Routine[] | Default cron-scheduled tool calls; tenant can disable |
| `events` | EventSpec[] | Events the module can emit |
| `webhooks` | Webhook[] | Inbound HTTP handlers |
| `oauth` | OAuthConfig | Required if the module brokers a 3rd-party service |
| `schema` | Migration[] | DDL for module-owned tables (prefix `<id>__`) |
| `lifecycle` | object | Optional hooks: `onInstall`, `onUninstall`, `onTenantCreate` |
| `permissions` | object | Default tool-level permissions; per-tool overrides allowed |

### 10.3 Capability resolution

Capability modules declare deps either way:

- **By module id**: hard dep on a specific module. Use only when
  the capability is unique (e.g. our internal `framework` module).
- **By capability**: declares "I need any module that provides
  `crm-source`." The framework resolves at install time; if zero
  modules provide it, install fails with a clear error. If
  multiple, the tenant picks at install time.

This makes a `prevent-churn` module work across Salesforce / HubSpot /
Hebbs CRM as long as each provides `crm-source`.

### 10.4 Lifecycle

| Hook | When called | Purpose |
|---|---|---|
| `onInstall(tenantId)` | When a tenant installs the module | Run schema migrations, seed default config |
| `onUninstall(tenantId)` | Before removing module install | Clean up rows, revoke OAuth |
| `onTenantCreate(tenantId)` | When a new tenant signs up AND this module is in the global default install list | Auto-install + setup |

### 10.5 Install state

Stored in `module_installs`:
- `(tenantId, moduleId, version, installedAt, configJson)`

The framework reads this on every agent wake to decide which
modules' skills + tools to expose.

---

## 11. Module roles, expanded

Three roles, same shape, different fields populated:

### 11.1 Connector module

- `oauth` — present
- `tools` — raw API verbs (`gmail.send_email`,
  `slack.post_message`)
- `skills` — one SKILL.md teaching how the 3rd-party service's
  API works (Gmail query syntax, Slack thread conventions, etc.)
- `webhooks` — inbound from the 3rd party
- `events` — events emitted as 3rd-party things happen
- `provides` — typically a generic capability label, e.g.
  Slack provides `chat`, Gmail provides `email-send` and
  `email-search`
- `schema` — usually none (state lives in the 3rd party)
- `dependsOn` — usually none

### 11.2 Capability module

- `oauth` — none
- `tools` — business logic ops, often delegating to other
  modules' tools internally
- `skills` — one SKILL.md per "domain idea" the module teaches
- `dependsOn` — usually one or more capability deps
- `provides` — one or more high-level capabilities
- `schema` — optional (capability state, audit, etc.)

### 11.3 Hybrid module

- Owns its own data (schema present)
- May also expose `oauth` if it integrates with a 3rd party
- Tools cover both internal CRUD and 3rd-party-mediated ops
- Examples: `hebbs-crm` (own data + optional Gmail integration
  for follow-ups), `inbox` (own data + connector-fed events)

---

## 12. The Copilot redesign

### 12.1 Today

- Hardcoded special agent (`role: "copilot"`) auto-created per
  tenant.
- Special API tree: `/api/copilot/sessions/*` and
  `/api/copilot/sessions/:id/message`.
- Browser auth via session token; copilot's underlying agent
  runs via the same agent engine.
- Multi-tenant scoped by the session's tenantId (recently fixed,
  was hardcoded to first tenant).

### 12.2 Issues

1. **Special API tree.** No other agent has its own URL prefix;
   copilot does. Removes uniformity.
2. **Hardcoded role.** `role: "copilot"` is special-cased in the
   engine. Other roles are just data; this one is plumbing.
3. **Two paths to talk to an agent.** A user can either chat with
   copilot via `/api/copilot/sessions/:id/message` or comment on
   any task via `/api/admin/tasks/:id/comments`. Two doors,
   different auth, different code paths, different events.
4. **Code-vs-operate permissions.** Copilot has implicit
   permission to read/edit code; other agents don't. The line
   between "operate" tools and "build" tools is implicit.
5. **No first-class config.** Copilot's persona / tools / scope
   are baked in. A tenant can't say "give my copilot only the
   CRM tools, not the framework tools."

### 12.3 Tomorrow — copilot is a module

- A built-in Module `copilot` ships:
  - One SKILL.md explaining the copilot's role and how it
    composes operate + build modes
  - Tools: `copilot.start_session(title?)` to create a copilot
    task, plus pulls in `framework.*` and any other tools the
    tenant has installed
  - Lifecycle: `onTenantCreate` provisions a copilot agent for
    the new tenant (same as today, but driven by the module
    install hook, not framework code)
  - No schema (copilot tasks live in the existing `tasks` table,
    with `originKind = "copilot"`)
- Copilot conversations are tasks. Messages are comments. Same
  shape as every other agent + task.
- Browser talks to `/api/admin/tasks/<copilot-task-id>/comments`
  to send messages — the same endpoint any task uses.
- Tenant chooses which Modules' tools the copilot can use via the
  module's per-agent permissions config.
- Permission to read/edit code: a separate built-in module
  `code-access` (with a `code.read`, `code.edit`, `code.run`
  toolset) that the tenant can attach to their copilot agent if
  they want. Other agents can have it too. No special-casing.

### 12.4 Migration

- Drop `/api/copilot/*` entirely.
- Browser shell uses `/api/admin/tasks/*` and the SSE event
  channel for live updates.
- Existing copilot agents in tenants → re-created at v2 cutover
  via the `copilot` module's `onTenantCreate` (every tenant gets
  a fresh copilot agent on first v2 launch).

---

## 13. Tool registry — fixing what's broken today

### 13.1 Issues today

1. **Three URL patterns**, each with its own validation (or lack
   thereof).
2. **No central inventory.** Three catalog providers must each be
   walked to know what's callable.
3. **Silent field drops.** `routes.ts`'s PATCH handler silently
   ignored fields not in its hand-written allowlist. The agent's
   docs said the fields were accepted; the handler ignored them.
   Not noticed for weeks.
4. **No tool call audit.** Connector calls log somewhere;
   framework calls log elsewhere; app calls don't log at all.
   Can't answer "what did this agent actually do."
5. **No idempotency story.** Agents retrying after timeout can
   double-send emails; nothing in the framework prevents this.
6. **No rate limiting per-tool.** A loop calling
   `gmail.send_email` 100 times costs real money and reputation;
   nothing prevents it except the approval skill.
7. **No discovery for capability modules.** A `prevent-churn`
   module needs to know what `crm-source` modules are installed;
   today it can't.
8. **Drift between docs and handler.** A.1 was the canonical
   incident; the doc said one thing, the handler did another.

### 13.2 How v2 fixes each

1. **One URL pattern**: `POST /api/tools/<module>.<name>`. Always.
2. **One registry**: `toolRegistry`, walked by both the catalog
   provider (for prompt rendering) and the dispatch handler (for
   call routing). Single source of truth.
3. **Schema-validated dispatch**: every call passes through the
   tool's Zod schema before reaching the handler. Unknown fields
   reject with `400 invalid_input`. Silent drops impossible.
4. **`tool_calls` audit table**: every dispatch writes a row.
   Inputs, outputs, duration, status. Queryable from admin UI.
5. **Idempotency**: tools opt in via `idempotency: "key"`; the
   framework dedupes on `Idempotency-Key` header within a
   24h window.
6. **Per-tool rate limits** in `tenant_settings`:
   `tool.<name>.rateLimit`. Default unlimited; tenants can cap.
7. **Capability discovery**: the registry exposes
   `byCapability(capName)` lookup; modules query it at runtime to
   find peer modules.
8. **No drift surface**: the tool's schema generates the prompt
   doc *and* validates the handler input. One declaration. Adding
   a field updates both at once.

### 13.3 Internal vs agent-facing tools

Some tools are framework-internal (workflow blocks calling other
tools). They use the same registry but a different auth path —
the engine calls `toolRegistry.invoke(name, inputs, ctx)`
directly without going through HTTP. Same handler, same
validation, no JWT round trip. Audited the same way.

This means workflows are just compositions of tools — the
"workflow engine" reduces to a tool (`workflow.run`) whose
handler walks a DAG and invokes other tools internally.

---

## 13b. Workflows — the visual DAG editor stays

Killing `BlockHandler` does **not** kill DAGs. Visual workflows are
load-bearing UX; the editor, the canvas, the drag-and-drop, the
branches, the for-each — all stay. What changes is what a "block"
*is*, not what a workflow looks like.

### 13b.1 What stays

- The React Flow canvas + dagre auto-layout
- The `workflows` table (`{ blocks, edges }` JSONB)
- The `workflow_runs` table and live run-status streaming
- Drag-and-drop block composition
- Condition blocks with true/false branches
- For-each iteration over upstream arrays
- `{{upstream.field}}` template variable substitution
- Run history, replay (`RunDiffView`), step-by-step debugging
- Triggers: cron, webhook, event
- Export / import workflow as JSON

### 13b.2 What changes — two kinds of blocks

In v1, blocks are TypeScript handlers registered in
`BlockHandlerRegistry`. There are 9 of them and they are the
entire universe of "what a block can do."

In v2, every block is one of two things:

| Block kind | What it does | Count |
|---|---|---|
| **Control flow** | Built into the `workflow` Module's runtime: `condition`, `for_each`, `delay`, `transform`, `branch` | 5 fixed primitives |
| **Tool block** | Invokes any registered Tool by name | One per tool in the registry — **grows automatically with installed Modules** |

Tool blocks are **not** hand-coded. The palette walks the tool
registry and renders one entry per tool. Install a Module → its
tools become blocks instantly.

### 13b.3 Block schema in `workflows.definition`

Each node in the DAG carries:

| Field | Purpose |
|---|---|
| `id` | Local node id |
| `kind` | `"trigger"` \| `"tool"` \| `"condition"` \| `"for_each"` \| `"delay"` \| `"transform"` \| `"branch"` |
| `tool` | (only when `kind: "tool"`) Full tool name, e.g. `"slack.post_message"` |
| `inputs` | (only when `kind: "tool"`) Object matching the tool's input schema; values may contain `{{nodeId.field}}` template references |
| `config` | (control-flow only) Per-kind config: `field` + `operator` + `value` for condition, `items` for for-each, `ms` for delay, `mapping` for transform |

Edges keep the v1 shape: `{ id, sourceBlockId, targetBlockId,
sourceHandle? }`.

### 13b.4 The visual editor

Today's editor (`@boringos/workflow-ui`) ships hand-written
config forms per block type: `TriggerForm`, `ConditionForm`,
`ForEachForm`, `WakeAgentForm`, etc. Each new block type means new
form code.

Tomorrow's editor:

1. **Palette = control-flow primitives + tool registry.** Always
   in sync with what's installed. Tenant installs Slack → Slack's
   tools appear as draggable blocks the next time the editor
   opens.
2. **Block config forms auto-generate from the tool's Zod
   schema.** Every required input becomes a form field; the
   field type (string / number / select / textarea) is inferred
   from the schema. No hand-written forms per tool.
3. **Type-safe wiring.** When a downstream node references
   `{{upstream.field}}`, the editor knows the upstream tool's
   output schema and validates the reference. Bad refs flag in
   the canvas, not at runtime.
4. **Output schema preview.** Hovering a node shows what fields
   are available downstream — sourced from the tool's `output`
   Zod schema (already a Tool spec field, see §8).
5. **Tool docs inline.** The tool's `description` and (optional)
   `examples` render in a panel next to the config form, sourced
   from the tool registry.

### 13b.5 Workflows are themselves a tool

The workflow runtime is the `workflow` Module's
`workflow.run(workflowId, inputs)` tool. Its handler:

1. Loads the workflow definition from `workflows`.
2. Builds the in-memory DAG.
3. Walks topologically. For each node:
   - If `kind: "tool"`: looks up the tool, validates inputs
     (with template substitution from upstream node outputs),
     dispatches via the tool registry. Same dispatcher as direct
     HTTP tool calls — same audit, same idempotency, same
     error model.
   - If control flow: handled inline by the runtime (no registry
     lookup).
4. Records each node's input + output + duration in
   `workflow_runs.steps` (jsonb) AND writes a `tool_calls` row
   per tool invocation.
5. Returns the final node's output.

Because `workflow.run` is itself a tool:
- A workflow can call another workflow (compose workflows).
- An agent can invoke a workflow as a tool from a system prompt.
- A routine can target a workflow the same way it targets any
  other tool.
- The admin UI's "run workflow now" button is the same code path
  as any tool invocation.

### 13b.6 Triggers

Triggers stay as a workflow concept (not tools — they're entry
points, not callable):

- **Cron trigger** — a routine row pointing at the workflow's
  `workflow.run` tool with the workflow id pre-filled. Routines
  already do scheduled tool calls; cron-triggered workflows are
  just routines targeting `workflow.run`. **No separate cron
  loop for workflows.**
- **Webhook trigger** — a Module's webhook handler invokes
  `workflow.run` for matching events.
- **Event trigger** — the framework's event bus invokes
  `workflow.run` when a registered event type fires.

This collapses three trigger code paths into one (all roads lead
to `workflow.run`).

### 13b.7 What this enables

- A tenant builds a custom workflow without writing code.
  Available blocks = installed Modules' tools. UX is "click +
  drag + connect."
- A Module ships a default workflow as part of its `routines`
  field — the tenant gets it pre-configured on install, and can
  edit it in the visual editor.
- Adding a new block to the palette = adding a tool to a Module.
  No framework PR needed for end users.
- Workflow + tool + routine all converge on one runtime,
  one audit trail, one error model.

### 13b.8 Migration of existing v1 BlockHandlers

| v1 BlockHandler | v2 replacement |
|---|---|
| `condition` | Control-flow primitive (built-in) |
| `delay` | Control-flow primitive (built-in) |
| `transform` | Control-flow primitive (built-in) |
| `for-each` | Control-flow primitive (built-in) |
| `wake-agent` | Tool: `framework.agents.wake` |
| `connector-action` | Replaced by direct tool blocks (e.g. `slack.post_message`) |
| `create-inbox-item` | Tool: `inbox.create_item` |
| `emit-event` | Tool: `framework.events.emit` |
| `trigger` | Stays as the entry-point node kind (not a handler — just a marker) |

Existing v1 workflow definitions need a one-time JSON rewrite at
cutover. Greenfield, so this is a script run during v2 launch
that does NOT preserve existing workflows — tenants rebuild them.
(If we want to preserve, the rewrite is mechanical: map block
types via the table above.)

---

## 13c. Wakeups — same mechanism, one code path

Killing `agent_wakeup_requests` does **not** kill wakeups. It
removes a redundant store. Today there are two sources of truth
for pending wakes (the table + the queue); v2 keeps only the
queue.

### 13c.1 What stays

- The job queue (in-process default, BullMQ opt-in)
- Coalescing: don't spawn a second run when one is already in
  flight for this agent
- Auto-rewake-after-run discipline: when a run finishes
  successfully and the agent still has other `todo` tasks, wake
  it on the next one (with A.2's same-task guard to prevent
  loops)
- Run-recovery on restart: sweep `agent_runs` rows stuck in
  `running` after process death and mark them `failed`
- Audit: who woke this agent and why

### 13c.2 What's deleted

- `agent_wakeup_requests` table
- The wake-half of `engine.recoverPending()` (the run-recovery
  half stays)
- The standalone `engine.wake()` API as the *primary* surface
  (it survives as an internal helper called by the wake tool)

### 13c.3 What replaces it

**One tool: `framework.agents.wake(agentId, taskId, reason)`.**

Every wake — no exceptions — flows through this tool. The
handler:

1. Checks if a run for this agent is already in flight
   (`agent_runs` where `status = 'running'`).
2. If a run is in flight, sets
   `agents.pending_wake = true` + `agents.pending_wake_task_id`
   and returns `{ ok: true, result: { coalesced: true } }`.
3. Otherwise, enqueues a job on the queue and returns
   `{ ok: true, result: { runId, coalesced: false } }`.
4. Always writes a `tool_calls` row capturing the call
   (regardless of outcome — that's the audit trail).

When a run completes successfully, the `afterRun` hook checks
`agents.pending_wake`. If set, it calls
`framework.agents.wake` again (preserving A.2's same-task guard:
the new wake skips the just-finished task).

### 13c.4 The eight wake call sites all funnel here

| Wake source | Caller in v2 |
|---|---|
| Comment posted on task with agent assignee | Comment handler invokes the tool in-process |
| Task assigned to agent | Assignment handler invokes the tool |
| Routine fires (cron) | Scheduler invokes the tool (or invokes `workflow.run` if the routine targets a workflow) |
| Webhook matches a trigger | Webhook handler invokes `workflow.run`, which can call the wake tool as one of its DAG blocks |
| Approval decided on `agent_action` child task | Decision handler posts comment → comment handler wakes parent agent |
| Run completed with remaining `todo` tasks | `afterRun` hook invokes the tool (with same-task guard) |
| Tenant resumed from pause | Pause-toggle handler walks agents with `todo` tasks and invokes the tool for each |
| Admin UI "Wake now" | `/api/admin/agents/:id/wake` invokes the tool internally |
| Workflow DAG "wake an agent" block | Tool block in the DAG referencing `framework.agents.wake` |

One tool. One audit trail. One coalescing rule. One same-task
guard.

### 13c.5 Coalescing state

Two new columns on `agents` replace the `agent_wakeup_requests`
table for coalescing purposes:

| Column | Purpose |
|---|---|
| `pending_wake` (boolean) | Set when a wake arrives during an in-flight run |
| `pending_wake_task_id` (uuid) | Which task the pending wake should target |
| `pending_wake_reason` (text) | Free-form reason carried into the next run |

Cleared when the next run starts. Survives process restart (it's
a DB row, unlike the in-process queue). This is the persistent
piece that justified the wakeup table; it shrinks to three
columns.

### 13c.6 Recovery on restart

Two halves:

1. **Run recovery** (kept). `engine.recoverPending()` sweeps
   `agent_runs` rows stuck in `running` (their process died
   mid-run) and marks them `failed`. Then walks `agents` for any
   with `pending_wake = true` and re-issues the wake tool. Same
   spirit as today.
2. **Queue recovery** (changed):
   - In-process queue: nothing to recover. Pending jobs were in
     memory; they're gone. The next external trigger re-wakes.
     This is no different from v1's actual behavior — the
     in-process queue was never persistent.
   - BullMQ: Redis recovers automatically.

### 13c.7 Audit query

"Why was agent X woken at 3:14am?" answers in two queries:

1. `SELECT * FROM tool_calls WHERE tool_name = 'framework.agents.wake' AND inputs->>'agentId' = X AND started_at >= '03:14'` — finds the wake call (caller, reason, source task).
2. `SELECT * FROM agent_runs WHERE agent_id = X AND started_at >= '03:14'` — finds the resulting run (or absence; coalesced wakes have no run).

Both queryable from the admin UI's tool-call audit screen and
the runs screen. No separate "wakeups" UI needed; wakes are just
tool calls.

---

## 14. Built-in modules to ship in v2

The minimum viable v2 has these built-ins. Each is its own
package (or a clear sub-package of `@boringos/core` if small).

| Module id | Role | Provides | Tools (representative) |
|---|---|---|---|
| `framework` | Built-in | `task-management`, `audit` | `framework.tasks.{read, create, patch}`, `framework.comments.post`, `framework.work_products.record`, `framework.runs.report_cost`, `framework.agents.{create, list}` |
| `memory` | Built-in | `memory` | `memory.{remember, recall, prime, forget}` |
| `drive` | Built-in | `file-storage` | `drive.{read, write, list, delete, stat, move}` |
| `inbox` | Built-in (hybrid) | `inbox` | `inbox.{list, read, update, archive, create_task}` |
| `copilot` | Built-in | `copilot` | `copilot.start_session` |
| `code-access` | Built-in (optional) | `code-edit` | `code.{read, edit, run, status}` |
| `workflow` | Built-in | `workflow-runtime` | `workflow.{run, list, get_run}` |
| `routines` | Built-in | `scheduling` | `routines.{create, list, trigger}` |
| `personas-default` | Built-in | persona pack | (no tools — just SKILL.md per role: cto, engineer, pa, etc.) |

**Connector modules in v2 (initial set):**

| Module id | Role | Provides | Tools |
|---|---|---|---|
| `connector-google` | Connector | `email-send`, `email-search`, `calendar` | `gmail.{send, list, search, read}`, `calendar.{list_events, create_event, find_free_slots}` |
| `connector-slack` | Connector | `chat` | `slack.{post_message, react, reply_thread}` |

**Capability + hybrid modules:**

| Module id | Role | Provides | Notes |
|---|---|---|---|
| `hebbs-crm` | Hybrid | `crm-source`, `crm-actions` | Owns `crm__deals`, `crm__contacts`. Optional `dependsOn: { capability: "email-send" }`. Replaces today's separate `boringos-crm` codebase. |
| `triage` | Capability | (none — pure consumer) | Reads from `inbox`, writes to `tasks`. Replaces today's app-specific triage workflow. |

---

## 15. CRM port

The Hebbs CRM today lives in `hebbs-clients/boringos-crm`, a
separate codebase with its own routes, hooks, schema, and React
shell. In v2 it becomes a Module.

### 15.1 What moves

- Schema → `crm__deals`, `crm__contacts`, `crm__pipelines`,
  `crm__activities` tables (prefixed). Migrations live in the
  Module.
- API → `/api/admin/*` for browser CRUD (the CRM ships admin
  routes as part of its Module manifest), and `/api/tools/crm.*`
  for agent calls.
- React shell screens → still live in the main shell repo (UI
  is the host's concern), but they consume `crm.*` admin routes.
- Skills → `crm/SKILL.md` teaches the agent how Hebbs models
  customer relationships, what stages mean, when to delegate to
  a sales-rep agent.
- Tools → `crm.{create_deal, update_deal, list_deals,
  move_stage, create_contact, list_contacts, link_email,
  link_meeting, ...}`.

### 15.2 What's gained

- One install verb. New tenants can opt in/out of CRM.
- Skills for CRM appear in any agent's prompt automatically once
  installed; today the agent has no idea the CRM exists.
- The `crm.*` tools are part of the same audit trail as
  everything else.
- `prevent-churn`, `lead-scoring`, etc. become trivial capability
  modules layered on top.

### 15.3 What's NOT in scope here

- Re-implementing the CRM's React UI from scratch. Visuals stay,
  data flow rewires to `/api/admin/*` routes the Module exposes.
- Multi-CRM support. v2 ships with the Hebbs CRM and a
  `crm-source` capability label; HubSpot/Salesforce as
  alternative providers come later.

---

## 16. The agent's prompt, end-to-end

When an agent wakes on a task, the framework builds the prompt
in this order. All sections are deterministic given (modules
installed for tenant) + (agent role) + (current task).

```
[System instructions]
  ## Header  — runtime ID, tenant ID, agent ID, capability summary
  ## Skills  (priority-ordered concat)
    ### framework.tool-protocol         — how to call tools
    ### framework.approvals             — when to ask permission
    ### framework.when-stuck            — handing off
    ### memory.skill                    — how to use memory tools
    ### drive.skill                     — how to use drive tools
    ### connector-google.gmail-skill    — Gmail conventions
    ### connector-slack.skill           — Slack conventions
    ### hebbs-crm.skill                 — CRM conventions (if installed)
    ### persona-cto.skill               — agent's persona
    ### <agent_instructions>            — agent's per-row instructions
    ### tenant-overrides.<id>           — tenant's override skill (if any)
  ## Available tools  (catalog from registry)
    ### framework.tasks.read
    ### framework.tasks.patch
    ### framework.comments.post
    ### gmail.send
    ### crm.create_deal
    ... etc, one block per registered tool

[Per-run context]
  ## Task                 — current task data
  ## Conversation         — comments thread
  ## Session              — continuity hint (per-task session id)
  ## Memory recall        — relevant past context (if any)
  ## Approval pending     — if the agent has an outstanding agent_action child
```

That is the whole prompt. No hand-curated providers. Everything
is sourced from registries and DB rows.

---

## 17. Phase plan

### Phase 0 — alignment + scaffolding (1-2 days)
- Lock decisions in §3, §4, §6, §7 by review.
- Cut a `v2` branch from `main`. v1 keeps shipping until cutover.
- Stand up the new monorepo skeleton: package boundaries, build
  scripts, test harness.
- Decide: monorepo path renames? Keep `@boringos/*` scope.
- **Deliverable:** signed-off thesis + new branch + skeleton.

### Phase 1 — core types and registries (3-4 days)
- Define types: `Module`, `Tool`, `Skill`, `Routine`, `Webhook`,
  `OAuthConfig`, `ToolContext`, `ModuleContext`.
- Implement `toolRegistry`, `skillRegistry`, `moduleRegistry`.
- Implement the Zod-based input/output validator and the
  audited dispatcher.
- Add `tool_calls` table.
- **Deliverable:** can register a trivial Module with one tool +
  one skill in tests; can dispatch the tool via direct in-process
  call; audit row written.

### Phase 2 — HTTP surface (2-3 days)
- Wire `/api/tools/<module>.<name>` route.
- Wire `/api/webhooks/<module-id>/<event>` route.
- JWT verification middleware for tools, module-defined
  middleware for webhooks.
- Module install/uninstall admin endpoints.
- **Deliverable:** can call any registered tool over HTTP from
  outside; can install/uninstall a module via admin API.

### Phase 3 — agent prompt assembly on the new shape (3-4 days)
- Implement the new `skills` provider (walks skill registry).
- Implement the new `tool-catalog` provider (walks tool
  registry).
- Drop all existing skill / catalog providers and the curl block
  in `protocol.ts`.
- Update header / per-run-context providers to match new section
  layout.
- **Deliverable:** running an agent yields a prompt with
  `## Skills` + `## Available tools` sections; old sections
  are gone. Snapshot test compares prompt structure.

### Phase 4 — framework module (3-4 days)
- Build the `framework` module with all `framework.*` tools
  (tasks CRUD, comments, work products, runs, agents).
- Migrate per-run callbacks the agent does today onto these
  tools.
- Drop `/api/agent/*` routes.
- Build the `framework` SKILL.md files: `tool-protocol`,
  `approvals`, `when-stuck`.
- **Deliverable:** an agent can do everything via tool calls
  that it does today via `/api/agent/*`. Smoke test end-to-end.

### Phase 5 — built-in modules (4-6 days)
- Port memory, drive, inbox, workflow, routines, code-access to
  the Module shape.
- Each gets a SKILL.md and a tools array.
- Drop the legacy `MemoryProvider` / `StorageBackend` / etc.
  abstractions where the Module shape covers them.
- **Deliverable:** all built-in subsystems are Modules, registered
  via the same verb as connectors will be.

### Phase 6 — copilot module (2-3 days)
- Build the `copilot` Module: skill, lifecycle hook
  (onTenantCreate provisions agent + initial copilot task).
- Drop `/api/copilot/*`.
- Update browser shell to talk to `/api/admin/tasks/*` for
  copilot conversations.
- **Deliverable:** copilot works end-to-end via the same code
  paths as any other agent + task. No special-casing in the
  engine.

### Phase 7 — connector modules (4-5 days)
- Port `connector-google` and `connector-slack` to the Module
  shape.
- Each has SKILL.md, tools, OAuth config, webhook handlers.
- Drop `/api/connectors/actions/*`.
- **Deliverable:** a tenant can install Google + Slack via admin
  API; agents see new tools in their prompt.

### Phase 8 — CRM hybrid module (5-7 days)
- Schema migrations for `crm__*` tables.
- Tools for deals / contacts / pipelines / activities.
- Skill teaching the model.
- Optional `dependsOn: { capability: "email-send" }`.
- Update browser shell's CRM screens to consume the Module's
  admin routes.
- **Deliverable:** Hebbs CRM is installable; old
  hebbs-clients/boringos-crm can be archived.

### Phase 9 — capability modules (3-4 days)
- Port the existing triage workflow as a `triage` capability
  module.
- Build a sample `prevent-churn` capability module to validate
  the capability-resolution path (depends on `crm-source` +
  `email-send`).
- **Deliverable:** at least one capability module installed and
  running on top of connector + hybrid modules.

### Phase 10 — admin UI updates (3-5 days)
- Modules screen: list installed, install / uninstall, configure.
- Tool catalog screen: browse all registered tools, audit log.
- Routines screen: existing UI, but routine targets are now
  `<module>.<tool>` references.
- Skills screen: per-tenant skill overrides.
- **Deliverable:** browser shell knows about Modules.

### Phase 11 — docs + examples (2-3 days)
- Rewrite `README.md` around Skills + Tools + Modules.
- Rewrite `CLAUDE.md` to match v2.
- Rewrite `examples/quickstart` as a "build a Module" tutorial.
- Move all completed v1 blocker docs to `docs/done/v1/`.
- Archive the v1 architecture diagram; ship a v2 one.
- **Deliverable:** a new dev can read the README + quickstart and
  ship a Module within an hour.

### Phase 12 — cutover (1 day)
- Drop v1 DB.
- Tag v1 as `v1.0.0-archive`.
- Merge v2 → main.
- Re-onboard tenants.
- **Deliverable:** v2 in production.

**Total estimate:** 35–55 working days. Single-developer pace.
Faster with focused effort on built-ins in parallel.

---

## 18. Testing strategy

- **Unit:** per-module, mock the tool registry, assert tools
  registered + dispatched correctly.
- **Integration:** spin up the framework with a small set of test
  modules, exercise full tool call paths via HTTP.
- **Prompt snapshot:** for a known set of installed modules + a
  known agent, snapshot the rendered prompt. Diff on every PR.
  This is the "drift detector" for the new architecture.
- **End-to-end:** real Postgres (embedded), real Claude Code
  subprocess, one agent + one task + one tool call. Verify
  audit row, comment posted, status transition.
- **Greenfield-specific:** at cutover, run a "fresh tenant
  signup → install modules → wake agent" flow as a single
  integration test. This becomes the v2 smoke test.

---

## 19. Documentation deliverables

- **README.md** — top of repo; what BoringOS is, the Skills + Tools
  + Modules thesis, how to install, how to author a Module.
- **CLAUDE.md** — agent orientation; primitives, file layout,
  concrete how-tos.
- **MODULES.md** — full Module manifest spec.
- **TOOLS.md** — full Tool spec (naming, error model, idempotency).
- **SKILLS.md** — full Skill spec (file format, priorities,
  overrides).
- **MIGRATION.md** — what changed from v1, how to port a v1 connector
  to a v2 Module (mostly mechanical).
- **examples/quickstart** — minimal app importing `framework` +
  `memory` + a custom Module with one tool + one skill.
- **examples/connector** — sample connector Module against a
  fake 3rd party.
- **examples/capability** — sample capability Module depending on
  the connector.

---

## 20. Open decisions to lock before code starts

These need explicit sign-off before phase 1:

1. **Capability resolution semantics** — concrete-only,
   capability-only, or hybrid? Recommend hybrid (concrete by
   default, capability optional).
2. **Module distribution** — npm packages? Built-ins live in this
   repo, third-party live as `@boringos/<id>` packages? Or git
   url installs at admin time? Recommend npm for built-ins, git
   url + signed manifests for third-party.
3. **OAuth credentials storage** — encrypted at rest? Today
   they're plaintext jsonb. Recommend encrypted with a per-tenant
   data key (KMS-style indirection).
4. **Tool versioning** — none in v1; v2 should at least support
   "deprecated" flags. Recommend: tools have a `since` and
   optional `deprecatedSince` semver. No versioned URLs.
5. **Workflow blocks** — all workflows route through tools, but do
   we keep the visual editor? Recommend: yes, as part of the
   `workflow` Module's admin UI; same DAG shape.
6. **Tenant skill override storage** — DB rows or per-tenant git
   sync? Recommend: DB rows in v2; git sync as a future Module.
7. **Permissions granularity** — per-tool roles only, or per-tool
   per-agent? Recommend: per-tool roles with per-agent override
   table for explicit grant/deny.
8. **The `agents.role` column** — string today; should it be a
   reference to a `personas-*` Module id? Recommend: yes, with a
   migration that maps existing roles to module ids.
9. **Multi-tenant module visibility** — global modules (everyone
   can install) vs tenant-private (org's own modules)? Recommend:
   v2 ships global only; tenant-private is a future phase.
10. **CRM rewrite scope** — full rewrite of the React UI, or
    keep visuals and rewire data layer only? Recommend:
    rewire-only in v2; visual rewrite later.

---

## 21. Risks

- **Rebuild fatigue.** The plan is 35–55 days; mid-rebuild,
  pressure to ship features pulls focus. Mitigate by cutting v2
  scope hard — don't rebuild things that aren't broken (auth,
  per-task sessions, queue).
- **Tenant data loss at cutover.** Greenfield is the user's
  call; document explicitly that re-onboarding is required.
- **Module marketplace ecosystem doesn't materialize.** v2
  pays for an ecosystem that may never appear externally. Risk
  is mitigated because internal modules (Hebbs CRM, copilot,
  built-ins) already justify the abstraction.
- **Capability resolution complexity.** Hybrid resolution
  (concrete + capability) can yield ambiguous installs. Mitigate
  with clear admin UI: when capability has multiple providers,
  tenant picks at install.
- **Subprocess stdin/stdout protocol churn.** The agent CLI
  contract is unchanged in spirit but the env vars and JWT shape
  may evolve. Lock the agent contract early.

---

## 22. Success criteria

The rebuild succeeds when:

1. A new connector Module is built + installed + agent-callable
   in under one hour by a single developer, end-to-end.
2. The agent's system prompt is regenerable from `(modules
   installed for tenant) + (agent role) + (current task)` with
   zero hand-written providers.
3. The `tool_calls` audit table has 100% coverage of agent-
   triggered side effects. No "ad-hoc" code paths.
4. Uninstalling a Module deletes its tools from the catalog,
   skills from the prompt, schema rows from the DB, routines
   from the scheduler — atomically and verifiably.
5. The CRM, copilot, memory, drive, and connectors are all the
   same shape. Only their `id`, `tools`, and `skills` differ.
6. **Feature parity.** Every row in §1b's parity matrix has a
   green-passing test in `tests/v2-parity.test.ts`. No v1
   capability is missing in v2 — only relocated or re-skinned.
   This is the contract behind goal #6.

If all six hold, the framework is OS-shaped, v1 features are
preserved, and v2 is right.

---

## 23. After v2 — what becomes possible (out of scope here)

- Public Module marketplace
- Per-tenant Module dev mode (live-reload skills + tools from a
  github branch)
- Cross-Module tool composition UI ("when Gmail receives X, call
  CRM.move_stage")
- Module sandboxing (run third-party Modules in a separate process
  with a constrained tool surface)
- Module pricing / billing per install
- Module auditing for safety review

None of these are in v2. They become tractable because v2
collapses to the right primitives.

---

## TL;DR

v1 has too many concepts. v2 has three: **Skill, Tool, Module.**
Connectors / apps / plugins / built-in subsystems / copilot all
collapse into Module. Agent calls / app routes / framework
callbacks / connector actions / plugin webhooks all collapse into
Tool dispatch at one URL. Hand-curated context providers all
collapse into one Skills section sourced from registry-walked
SKILL.md files.

Greenfield. Wipe v1 data. 35–55 days, sequenced into 12 phases.
The success test: adding Notion is one Module package, zero
framework edits.
