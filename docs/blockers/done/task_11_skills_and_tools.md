# Blocker — Skills and Tools as the only two agent-prompt primitives

## The problem

Look at what's in an agent's system prompt today and count the
shapes:

- `header` provider — hand-written framework boilerplate
- `persona` provider — markdown bundles loaded from disk
- `tenant-guidelines` — DB-stored markdown
- `drive-skill` — TypeScript function returning markdown
- `memory-skill` — TypeScript function returning markdown
- `agent-instructions` — DB column
- `protocol` — hand-written curl examples
- `approvals-skill` — TypeScript function returning markdown
- `chief-of-staff` — TypeScript function returning markdown
- `hierarchy` — generated from DB org tree
- `api-catalog` — markdown strings registered via `agentDocs`
- `connector-actions-catalog` — generated from `ConnectorRegistry`
- `task` / `comments` / `session` / `memory-context` / `approval` —
  per-run context

That's ~15 providers, six different shapes, three places where
"how to call a tool" lives, and zero unifying concept. Every new
capability we ship adds another provider written in another shape.

Two consequences:

1. **Drift.** The framework callback API drifted from its handler
   (A.1). Connector docs drift from connector schemas. App-route
   docs drift from the routes themselves. We close one drift gap
   per blocker; the underlying pattern keeps regenerating new ones.
2. **No story for installed apps.** When a user installs a CRM
   app, what should it contribute to the agent prompt? Today: a
   markdown blob in `agentDocs`, plus actions discoverable via
   nothing in particular, plus conventions documented in the app
   author's README that the agent never sees. There's no shape an
   app author plugs into. So apps don't ship one.

The framework needs two abstractions, no more. This task proposes
those two and migrates everything onto them.

## The decision

Two primitives, both first-class, both pluralized in the prompt:

### 1. **Skill** — markdown, hand-written, behavioral

A `SKILL.md` ships next to the code of every component that wants
to teach an agent something. The framework discovers it, loads it,
and concatenates the lot into the agent's system prompt under
"## Skills."

Sources:
- Built-in components: `@boringos/memory`, `@boringos/drive`,
  framework itself (the "tool protocol" skill)
- Connectors: each connector package ships a `SKILL.md`
- Apps: each app definition references one (or more) `SKILL.md`
- Tenant overrides: existing admin skill system (github-synced /
  url-synced) — *unchanged* — keeps working for tenant-curated
  style guides and runbooks

A `Skill` is just:

```ts
type Skill = {
  id: string;            // "memory", "google.gmail", "tool-protocol"
  source: "framework" | "connector" | "app" | "tenant";
  body: string;          // markdown content
  appliesTo?: (agent) => boolean;  // optional gating
};
```

### 2. **Tool** — generated, inventory of callable operations

A `Tool` is the unified replacement for connector-action,
app-mounted route, and framework callback endpoint:

```ts
type Tool = {
  name: string;          // "google.send_email", "tasks.patch"
  description: string;
  inputs: ZodSchema;
  handler: (inputs, ctx) => Promise<Result>;
  ownedBySkill?: string; // back-reference for cross-linking
};
```

One registry. One mounting strategy: every tool is served at
`POST /api/tools/<name>`. One validation pipeline: input schema
gates the handler. One catalog: walk the registry, emit a name +
description + inputs entry per tool.

The agent prompt's tool section becomes pure inventory — no curl
examples per tool, no auth headers repeated. The framework's
"tool-protocol" SKILL teaches the calling convention once.

### What the agent sees

```md
## Skills

### tool-protocol
Every tool is callable at `POST $BORINGOS_CALLBACK_URL/api/tools/<name>`
with `Authorization: Bearer $BORINGOS_CALLBACK_TOKEN`. Body: JSON
matching the tool's `inputs` schema. Response: `{ok, result}` or
`{ok: false, error}`. ...

### memory
Use the memory tools when ...

### google.gmail
Gmail's search syntax: ... Threading conventions: ...

### crm
Hebbs CRM tracks deals through these stages: ... Always link a
contact before creating a deal. ...

## Available tools

### tasks.patch
Update a task's status, assignee, or metadata.
Inputs: status?, title?, description?, priority?,
assigneeAgentId?, assigneeUserId?, parentId?

### google.send_email
Send an email through the connected Gmail account.
Inputs: to (req), subject (req), body (req)

### crm.create_deal
Create a deal in the Hebbs CRM linked to a contact.
Inputs: contactId (req), amount (req), stage?
```

That's the whole prompt-time agent surface. Skills (behavior) +
Tools (inventory).

## What gets replaced

| Today | Tomorrow |
|---|---|
| `connector.skillMarkdown()` returning a string | `SKILL.md` next to connector code |
| `connector.actions[]` | Tools registered via `connector.tool()` |
| `app.route(..., { agentDocs })` | App's `SKILL.md` + tools |
| `protocol.ts` curl block | "tool-protocol" `SKILL.md` |
| `memory-skill` provider | `SKILL.md` in `@boringos/memory` |
| `drive-skill` provider | `SKILL.md` in `@boringos/drive` |
| `approvals-skill` provider | `SKILL.md` in `@boringos/agent` |
| `chief-of-staff` provider | `SKILL.md` plus persona attachment |
| `connector-actions-catalog` provider | Single `tool-catalog` provider |
| `api-catalog` provider | Single `tool-catalog` provider |

What stays as a per-run context provider (not a skill):
- `task`, `comments`, `session`, `memory-context`, `approval`,
  `hierarchy` — these inject the *current run's data*, not a
  reusable instruction. They remain code-driven providers.

Everything else collapses into the Skills + Tools model.

## Implementation

### Phase 1 — `Tool` type + registry + mount

`packages/@boringos/agent/src/tools/registry.ts`:

```ts
export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputs: ZodType<I>;
  handler: (inputs: I, ctx: ToolContext) => Promise<O>;
  ownedBySkill?: string;
}

export interface ToolContext {
  tenantId: string;
  agentId: string;
  runId: string;
  taskId?: string;
  db: Db;
}

export function createToolRegistry() { /* register, list, get */ }
```

`packages/@boringos/core/src/routes.ts` mounts the registry:

```ts
app.post("/tools/:name", async (c) => {
  const tool = registry.get(c.req.param("name"));
  if (!tool) return c.json({ ok: false, error: "unknown tool" }, 404);
  const body = await c.req.json();
  const parsed = tool.inputs.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error }, 400);
  const claims = c.get("claims");
  const result = await tool.handler(parsed.data, {
    tenantId: claims.tenant_id,
    agentId: claims.agent_id,
    runId: claims.sub,
    db,
  });
  return c.json({ ok: true, result });
});
```

That's the whole transport. Every existing call site
(`/api/agent/*`, `/api/connectors/actions/*`) gets replaced by
tool registrations during the migration phase.

### Phase 2 — `Skill` registry + provider

`packages/@boringos/agent/src/skills/registry.ts`:

```ts
export interface Skill {
  id: string;
  source: "framework" | "connector" | "app" | "tenant";
  body: string;
  appliesTo?: (event: ContextBuildEvent) => boolean;
}
export function createSkillRegistry() { /* register, list */ }
```

`packages/@boringos/agent/src/providers/skills.ts`:

```ts
export function createSkillsProvider(deps: { registry: SkillRegistry }): ContextProvider {
  return {
    name: "skills",
    phase: "system",
    priority: 80,
    async provide(event) {
      const applicable = deps.registry.list().filter(s => !s.appliesTo || s.appliesTo(event));
      if (applicable.length === 0) return "";
      return "## Skills\n\n" + applicable.map(s => `### ${s.id}\n${s.body}`).join("\n\n");
    },
  };
}
```

### Phase 3 — `tool-catalog` provider

`packages/@boringos/agent/src/providers/tool-catalog.ts`:

```ts
export function createToolCatalogProvider(deps: { registry: ToolRegistry }): ContextProvider {
  return {
    name: "tool-catalog",
    phase: "system",
    priority: 75,
    async provide() {
      const tools = deps.registry.list();
      if (tools.length === 0) return "";
      return "## Available tools\n\n" + tools.map(t =>
        `### ${t.name}\n${t.description}\nInputs: ${zodToInputs(t.inputs)}`
      ).join("\n\n");
    },
  };
}
```

`zodToInputs` introspects the Zod schema and emits a one-line
inputs summary. Plenty of off-the-shelf Zod-introspection helpers
exist; pick the smallest.

### Phase 4 — Per-component SKILL.md

For each existing skill provider:

1. Move the markdown out of the TypeScript provider into a sibling
   `SKILL.md` (or per-component file in `@boringos/memory/SKILL.md`,
   etc.).
2. Replace the provider's `provide()` with `readFile()` (or bundle
   it via Vite's `?raw` import).
3. Register the loaded skill into the skill registry at boot.

For connectors and apps: their existing `skillMarkdown()` method
becomes `skillFile()` (or stays as the function; either works).
The framework reads it once at registration time and pushes a
`Skill` into the registry.

The "tool-protocol" SKILL.md is new — written by hand, lives in
`packages/@boringos/agent/skills/tool-protocol.md`. It teaches the
calling convention that today is fragmented across `protocol.ts`,
`connector-actions-catalog.ts`, and `api-catalog.ts`.

### Phase 5 — Migrate existing call sites onto Tools

The big one. Every existing endpoint gets a Tool registration:

- `/api/agent/tasks/*` → `tasks.read`, `tasks.patch`, `tasks.create`
- `/api/agent/tasks/:id/comments` → `comments.create`
- `/api/agent/tasks/:id/work-products` → `work-products.create`
- `/api/agent/runs/:id/cost` → `runs.report-cost`
- `/api/agent/agents` → `agents.create`
- `/api/agent/inbox/:id` → `inbox.read`, `inbox.update`
- `/api/connectors/actions/google/*` → `google.send_email`,
  `google.list_emails`, etc.
- App routes → `<app>.<verb>` per route

The legacy URLs can stay as thin shims for one release that proxy
to the tool registry, or get cut immediately if there are no
external callers (verify first — the shell uses some of these).

## Files in scope

**New:**
- `packages/@boringos/agent/src/tools/registry.ts` — Tool type + registry
- `packages/@boringos/agent/src/skills/registry.ts` — Skill type + registry
- `packages/@boringos/agent/src/providers/skills.ts` — skill catalog provider
- `packages/@boringos/agent/src/providers/tool-catalog.ts` — tool catalog provider
- `packages/@boringos/agent/skills/tool-protocol.md` — the calling-convention skill
- `SKILL.md` in: `@boringos/memory`, `@boringos/drive`,
  `@boringos/connector-google`, `@boringos/connector-slack`

**Modified:**
- `packages/@boringos/core/src/routes.ts` — `POST /tools/:name` shim, register all framework tools
- `packages/@boringos/core/src/boringos.ts` — wire registries, register built-in skills + tools
- `packages/@boringos/connector/src/types.ts` — add `tools[]` to `ConnectorDefinition`, mark `actions[]` deprecated
- `packages/@boringos/connector-google/src/index.ts` — register tools instead of actions
- `packages/@boringos/connector-slack/src/index.ts` — same

**Deleted (migration complete):**
- `packages/@boringos/agent/src/providers/api-catalog.ts`
- `packages/@boringos/agent/src/providers/connector-actions-catalog.ts`
- `packages/@boringos/agent/src/providers/memory-skill.ts`
- `packages/@boringos/agent/src/providers/drive-skill.ts`
- `packages/@boringos/agent/src/providers/approvals-skill.ts`
- `packages/@boringos/agent/src/providers/chief-of-staff.ts`
- The hand-curated curl block in `protocol.ts` (keep env-vars +
  required-steps + when-you're-stuck narrative)

## Test plan

1. **Skills appear in prompt.** Spawn an agent run; stdout
   excerpt contains `## Skills` followed by `### memory`, `###
   tool-protocol`, and one block per connected connector.

2. **Tools appear in prompt.** Same run's stdout contains `##
   Available tools` followed by `tasks.patch`, `tasks.read`,
   `comments.create`, plus connector tools.

3. **End-to-end call works.** Agent reads the tool-protocol skill,
   issues a real `POST /api/tools/google.send_email` with valid
   inputs. Server validates, dispatches, response shape is
   `{ok: true, result: {...}}`.

4. **Schema rejection.** Issue a tool call with an unknown field.
   Server returns 400 with the Zod error. Agent sees structured
   error in response.

5. **No prompt regression.** Diff old vs new system prompt: the
   sum of skills should cover everything the old providers said;
   tool inventory should cover every previously-callable
   endpoint. Spot-check with a prompt-snapshot smoke test.

6. **App SKILL.md auto-loads.** Install an app whose definition
   ships a `SKILL.md`. Next agent wake's prompt contains it under
   the `## Skills` section without any framework code change.

## What's NOT in this task

- **Tenant skill overrides via the admin skill system.** That
  system already exists (`/api/admin/skills`, github-sync,
  attach-to-agent). It keeps working unchanged. Component-shipped
  skills are a *new* layer, additive, loaded automatically. The
  two converge later — same file shape, different sources.
- **Dynamic tool-set per agent.** All tools are visible to all
  agents in v1. Per-agent / per-role gating is a `task_04` policy
  concern, not here.
- **OpenAPI spec emission.** The Tool registry could generate one;
  defer until an external consumer needs it.
- **Tool versioning.** No version field in v1. If a tool's input
  shape breaks, register a new tool name.
- **Removing the existing skill admin system.** It coexists.

## Open questions

- **Framework tools vs admin API.** `/api/admin/*` (tenant ops,
  used by the shell UI) is *not* tool-shaped — it's a REST
  surface for human interfaces, with a different auth model
  (X-API-Key + X-Tenant-Id, not bearer JWT). Keep it separate.
  Tools are the agent surface specifically.
- **Where does the SKILL.md live in the file tree?** Top of the
  package (`packages/@boringos/memory/SKILL.md`) is most
  discoverable; alternative is alongside the source
  (`src/SKILL.md`). Lean top-of-package — the file is part of the
  package's public contract, like `README.md`.
- **Bundling.** SKILL.md content needs to ship in the published
  npm package. Vite/tsup config: include `SKILL.md` in `files`.
  At runtime, load via `readFileSync(__dirname + "/../SKILL.md")`
  or the bundler's `?raw` import.
- **Token cost.** Skill markdown for 5 connectors + memory + drive
  + tool-protocol + approvals ≈ 3000 tokens. Tool inventory for
  ~40 tools ≈ 1500. Total system-prompt overhead ≈ 4500 tokens
  before per-run context. Acceptable for current models; revisit
  with per-agent gating if it grows.
- **What about runtimes (claude/codex/gemini)?** They have
  `skillMarkdown()` today. Move them to SKILL.md — but they're
  per-runtime instructions ("how this CLI behaves"), so they only
  apply to the agent using that runtime. Use `appliesTo` to gate.

## Why this matters

You'll know the abstraction is right when the next thing the
framework adds — say, a Notion connector — requires zero new
context providers, zero edits to `protocol.ts`, zero hand-written
curl examples. It ships a `SKILL.md` and registers some Tools.
That's it. The agent prompt grows automatically. The catalog
generates automatically. The validation runs automatically.

Today, adding a Notion connector means: write `skillMarkdown()`,
write `actions[]`, hope the connector-actions-catalog provider
renders it right, document any non-obvious behavior in a place
the agent will read, accept that the framework callback API still
lives in a hand-curated curl block above your work. That's not
modularity; it's a checklist of places to remember to update.

Skills + Tools is the framework's deal with developers, made
honest: write your component once, declare what it teaches, declare
what it does, and the framework wires it to every agent that needs
it. No prompt edits, no provider authorship, no drift surface.

Two concepts. Everything else is plumbing.

## Build order

1. **Tool registry + `POST /tools/:name` mount.** Smallest unit.
   Register one trivial tool (`echo`); call it; verify response
   shape. ~80 lines.
2. **Skill registry + `skills` provider.** Same pattern. Register
   one trivial skill; verify it appears in the prompt. ~50 lines.
3. **Migrate framework callback API to tools.** Every endpoint in
   `routes.ts` becomes a `Tool` registration. Old URLs stay as
   thin shims initially.
4. **Migrate connector actions to tools.** `ConnectorDefinition`
   gains a `tools` array; existing `actions[]` becomes a
   compile-time error to add new entries to (deprecation noise).
   `connector-google` and `connector-slack` get rewritten.
5. **Move `skillMarkdown()` strings to `SKILL.md` files.** One
   per package: memory, drive, agent (approvals + tool-protocol),
   connector-google, connector-slack.
6. **Delete the providers that are now redundant.** Big delete
   diff: api-catalog, connector-actions-catalog, memory-skill,
   drive-skill, approvals-skill, chief-of-staff. Trim
   `protocol.ts` to env-vars + required-steps + when-you're-stuck.
7. **Smoke + snapshot tests.** Before/after prompt diffs; one
   end-to-end tool call.

Approx 600 lines new + ~800 lines deleted. Net: less code, fewer
concepts, no drift surface.
