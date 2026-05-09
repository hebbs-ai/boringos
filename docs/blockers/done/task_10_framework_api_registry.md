# Blocker — Promote the framework callback API to a registry source

## The problem

Three classes of HTTP surface get advertised to agents in their
system prompt: connector actions, app-mounted routes, and the
framework's own callback API (`/api/agent/*`). The first two are
registry-driven and self-update — connectors declare actions in
`ConnectorDefinition.actions`, apps register routes with
`agentDocs`, and the catalog providers walk those registries on
every wake. Add a connector, agents see new tools next run.

The framework's own API doesn't work that way. It's a
**hand-curated markdown blob** in
`packages/@boringos/agent/src/providers/protocol.ts` — a literal
backtick-fenced curl block per endpoint, written by hand and kept
in sync by remembering to. That worked when there were three
endpoints. It's already drifting:

1. **A.1 just landed because of this.** The PATCH `/tasks/:taskId`
   handler in `routes.ts` accepted only `status / title /
   description` for weeks, yet the protocol's "When you're stuck"
   curl example told agents to PATCH `assigneeAgentId` and
   `assigneeUserId`. Agents tried; the server silently dropped the
   fields. The doc-vs-handler drift was invisible until BOS-003
   loop forced an investigation.

2. **Inbox endpoints exist but aren't documented.**
   `GET /inbox/:itemId` and `PATCH /inbox/:itemId` are in
   `routes.ts`; `protocol.ts` doesn't mention them. An agent reading
   its own protocol doesn't know they exist. The triage agent only
   uses them because its app-level skill markdown duplicates the
   knowledge.

3. **Run/cost reporting** is documented but agents almost never
   call it correctly because the env-var-rich curl example is dense
   and not regenerated when the schema changes.

This is the same gap task_07 closed for connectors, scoped to the
last hand-maintained catalog source: the framework itself.

## The decision

Treat the framework callback API like any other tool catalog.
Declare the endpoints next to the handlers in `routes.ts` and have
a context provider walk them, generate curl examples, and inject
the markdown. Drop the hand-curated curl block from `protocol.ts`
entirely.

What stays in `protocol.ts`:
- The "Environment Variables" reference (5 vars).
- "Required Steps" narrative (status → plan → work → summary →
  done).
- The "When you're stuck" procedure (it's behavior, not API
  shape — but the curl example inside it gets generated, see
  below).

What moves to a generated catalog:
- Every `/api/agent/*` endpoint, with method + path + a one-line
  description + the request body shape + a curl example.

The new provider is `createAgentApiCatalogProvider`. It mirrors the
existing `createConnectorActionsCatalogProvider` (priority 75) but
emits a "## Framework API — task, comment, work-product, cost"
section.

### Why now (and not at task_07)

Task_07 deliberately left the framework API untouched — scope was
bounded to "advertise connectors that already exist." But the same
drift bug it diagnosed for connectors now bites the framework API
itself. A single registry pattern across all three surfaces means
**the protocol.ts curl block gets deleted, not edited.** That's the
test of whether the abstraction is right.

## What gets advertised

A unified "## Framework API" section, sourced from a registry that
each route in `routes.ts` populates at boot. Shape mirrors the
connector-action `ActionDefinition`:

```ts
export interface AgentApiEndpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path under the callback mount, e.g. "/tasks/:taskId" */
  path: string;
  /** One-line description shown to agents */
  description: string;
  /** Request body shape (POST/PATCH only). Reuses ActionFieldDef. */
  inputs?: Record<string, ActionFieldDef>;
  /** Optional grouping label, e.g. "Tasks", "Comments", "Inbox" */
  group?: string;
}
```

### Endpoints in scope

Sourced from `routes.ts` today:

| Group | Method | Path | Inputs (PATCH/POST) |
|---|---|---|---|
| Tasks | GET | `/tasks/:taskId` | — |
| Tasks | PATCH | `/tasks/:taskId` | status, title, description, priority, assigneeAgentId, assigneeUserId, parentId |
| Tasks | POST | `/tasks` | title (req), description, status, priority, parentId, assigneeAgentId, assigneeUserId, originKind, proposedParams |
| Comments | POST | `/tasks/:taskId/comments` | body (req) |
| Work products | POST | `/tasks/:taskId/work-products` | kind (req), title (req), url, metadata |
| Runs | POST | `/runs/:runId/cost` | inputTokens, outputTokens, model, costUsd |
| Agents | POST | `/agents` | name (req), role, instructions |
| Inbox | GET | `/inbox/:itemId` | — |
| Inbox | PATCH | `/inbox/:itemId` | status, metadata |

(All authenticated by `Authorization: Bearer
$BORINGOS_CALLBACK_TOKEN`. The provider mentions this once at the
top of the section instead of per-endpoint.)

### What the generated markdown looks like

```markdown
## Framework API

Every endpoint below sits under `$BORINGOS_CALLBACK_URL`. Use your
`$BORINGOS_CALLBACK_TOKEN` as a bearer for all of them.

### Tasks

#### `GET /tasks/:taskId` — Read a task and its comments

Example call:
```bash
curl -sS $BORINGOS_CALLBACK_URL/api/agent/tasks/$BORINGOS_TASK_ID \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN"
```

#### `PATCH /tasks/:taskId` — Update task status, assignee, or metadata

Inputs:
- `status` (string) — todo | in_progress | done | blocked
- `title` (string)
- `description` (string)
- `priority` (string) — low | medium | high
- `assigneeAgentId` (string | null) — null clears the agent
- `assigneeUserId` (string | null) — null clears the user
- `parentId` (string | null)

Example call:
```bash
curl -sS -X PATCH $BORINGOS_CALLBACK_URL/api/agent/tasks/$BORINGOS_TASK_ID \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "<status>"}'
```
```

The provider walks the endpoint registry and emits one section per
group, one block per endpoint, with the same `formatAction` shape
the connector-actions catalog already uses.

## Implementation

### Phase 1 — `AgentApiEndpoint` type + registry

New file: `packages/@boringos/core/src/agent-api-registry.ts`

```ts
import type { ActionFieldDef } from "@boringos/connector";

export interface AgentApiEndpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  description: string;
  inputs?: Record<string, ActionFieldDef>;
  group?: string;
}

export function createAgentApiRegistry() {
  const endpoints: AgentApiEndpoint[] = [];
  return {
    register(e: AgentApiEndpoint) { endpoints.push(e); },
    list(): readonly AgentApiEndpoint[] { return endpoints; },
  };
}

export type AgentApiRegistry = ReturnType<typeof createAgentApiRegistry>;
```

### Phase 2 — `routes.ts` declares its endpoints

`createCallbackRoutes` accepts a registry and registers each
endpoint as it mounts the handler. The declarations live next to
the handlers — drift becomes mechanically harder.

```ts
export function createCallbackRoutes(
  db: Db,
  _engine: AgentEngine,
  jwtSecret: string,
  apiRegistry: AgentApiRegistry,
): Hono<AuthEnv> {
  // ... existing JWT middleware ...

  apiRegistry.register({
    group: "Tasks",
    method: "GET",
    path: "/tasks/:taskId",
    description: "Read a task and its comments",
  });
  app.get("/tasks/:taskId", async (c) => { /* ... */ });

  apiRegistry.register({
    group: "Tasks",
    method: "PATCH",
    path: "/tasks/:taskId",
    description: "Update task status, assignee, or metadata",
    inputs: {
      status: { type: "string", description: "todo | in_progress | done | blocked" },
      title: { type: "string", description: "" },
      description: { type: "string", description: "" },
      priority: { type: "string", description: "low | medium | high" },
      assigneeAgentId: { type: "string", description: "null clears the agent" },
      assigneeUserId: { type: "string", description: "null clears the user" },
      parentId: { type: "string", description: "" },
    },
  });
  app.patch("/tasks/:taskId", async (c) => { /* ... */ });

  // ... rest of the routes, each preceded by a register() call ...
}
```

The shape matches `ActionFieldDef` so the existing
`formatAction` / `sampleInputs` helpers from
`connector-actions-catalog.ts` can be reused or extracted to a
shared helper.

### Phase 3 — `agentApiCatalogProvider`

New file:
`packages/@boringos/agent/src/providers/agent-api-catalog.ts`.

```ts
export function createAgentApiCatalogProvider(deps: {
  registry: AgentApiRegistry;
}): ContextProvider {
  return {
    name: "agent-api-catalog",
    phase: "system",
    priority: 90, // before connector-actions-catalog (75)

    async provide(event: ContextBuildEvent): Promise<string> {
      const endpoints = deps.registry.list();
      if (endpoints.length === 0) return "";

      const grouped = new Map<string, AgentApiEndpoint[]>();
      for (const e of endpoints) {
        const g = e.group ?? "API";
        if (!grouped.has(g)) grouped.set(g, []);
        grouped.get(g)!.push(e);
      }

      const lines: string[] = [];
      lines.push("## Framework API");
      lines.push("");
      lines.push(
        "Every endpoint below is mounted under `$BORINGOS_CALLBACK_URL/api/agent`. " +
        "Use your `$BORINGOS_CALLBACK_TOKEN` as the bearer for all of them.",
      );
      lines.push("");
      for (const [group, eps] of grouped) {
        lines.push(`### ${group}`);
        for (const ep of eps) {
          lines.push(...formatEndpoint(ep, event.callbackUrl));
          lines.push("");
        }
      }
      return lines.join("\n");
    },
  };
}
```

`formatEndpoint` mirrors `formatAction` from
`connector-actions-catalog.ts` — single-place change if either
shape evolves.

### Phase 4 — Wire into `BoringOS`

`packages/@boringos/core/src/boringos.ts`:
1. Construct an `AgentApiRegistry` at the top of the boot sequence.
2. Pass it into `createCallbackRoutes(...)`.
3. Pass it into `createAgentApiCatalogProvider(...)` and register
   that provider in the engine's pipeline.

Lazy is fine — the registry is fully populated synchronously by
the time `createCallbackRoutes` returns, which is before any agent
runs.

### Phase 5 — Strip the hand-curated block from `protocol.ts`

Delete the entire `### Task API` / `### Delegation` / `### Cost
Reporting` sections. Keep:
- "Environment Variables"
- "Required Steps"
- "When you're stuck"

The "When you're stuck" curl example references the PATCH
endpoint. Two options:
- **Keep it inline** — narrative is unchanged, the curl is short
  and load-bearing for a behavior the agent must internalize.
- **Replace with a pointer** — "Use the `PATCH /tasks/:taskId`
  endpoint listed under Framework API to set status=blocked,
  assigneeAgentId=null, assigneeUserId=<creator>."

Lean inline. The procedure is a behavioral instruction; agents
respond better when the exact recipe is visible at the point of
instruction. The catalog teaches the API surface; this section
teaches when to use it.

## Files in scope

- `packages/@boringos/core/src/agent-api-registry.ts` — new (type + registry)
- `packages/@boringos/core/src/routes.ts` — register each endpoint inline; accept registry param
- `packages/@boringos/core/src/boringos.ts` — construct registry, thread it into routes + provider
- `packages/@boringos/agent/src/providers/agent-api-catalog.ts` — new (provider)
- `packages/@boringos/agent/src/providers/index.ts` — export it
- `packages/@boringos/agent/src/providers/connector-actions-catalog.ts` — extract `formatAction`/`sampleInputs` into a shared helper module (optional but reduces duplication)
- `packages/@boringos/agent/src/providers/protocol.ts` — delete `### Task API`, `### Delegation`, `### Cost Reporting` sections; keep env-vars, required-steps, when-you're-stuck

## Test plan

1. **Catalog appears in prompt.** Spawn any agent run. The
   `stdout_excerpt` should contain `## Framework API` followed by
   `### Tasks`, `### Comments`, `### Work products`, `### Runs`,
   `### Inbox`, `### Agents`. Confirms the provider is wired.

2. **Hand-curated block is gone.** `grep "### Task API"
   packages/@boringos/agent/src/providers/protocol.ts` returns
   nothing. The narrative sections are still present.

3. **Drift test.** Add a new endpoint to `routes.ts` — say
   `DELETE /tasks/:taskId/comments/:commentId` — with a
   `register()` call alongside it. The next agent wake includes
   the new endpoint in its prompt without any change to the
   provider or `protocol.ts`. Confirms registry-as-source-of-truth.

4. **Field allowlist drift can't happen silently.** Remove
   `assigneeUserId` from the PATCH allowlist in `routes.ts` (the
   handler) and forget to remove it from the registry declaration.
   Adding a TypeScript-level guard is out of scope for v1, but
   document the convention: handler-allowlist and registry-inputs
   are co-located, reviewers check one against the other in PR.

5. **End-to-end.** Run a real agent task. Verify it:
   - Reads task via `GET /tasks/:taskId`
   - Posts a plan comment via `POST /tasks/:taskId/comments`
   - Updates status via `PATCH /tasks/:taskId`
   All curl examples used are the ones the catalog generated,
   not memorized from training.

## Why this matters

Three reasons, in increasing order of weight:

1. **Drift kills.** A.1 was the second time framework-doc-vs-handler
   drift caused agent misbehavior in production (BOS-003 was the
   first; the agent assumed PATCH would accept the assignee fields
   per the docs and silently failed). Co-locating declaration with
   handler removes the class of bug.

2. **Discoverability.** Inbox endpoints exist; agents don't know.
   That gap is structural — every endpoint we add to `routes.ts`
   is invisible to agents until someone remembers to update
   `protocol.ts`. Registry-driven discovery means new endpoints
   ship visible.

3. **Symmetry.** "Tools are tools" — whether a connector ships
   them, an app ships them, or the framework ships them. Three
   parallel pipelines was tolerable when there were three. The
   framework's API is now the only hand-curated source. Closing
   that asymmetry is what makes the abstraction load-bearing.

## What's NOT in this task

- **OpenAPI / JSON Schema export.** Tempting; a generated catalog
  is one step away from a generated spec. Out of scope here —
  agents read markdown, not JSON Schema, and we don't have an
  external API consumer that needs OpenAPI yet.
- **Per-tenant endpoint whitelisting.** Some tenants may not want
  agents posting work-products. Belongs in
  `task_04_admin_settings_cron_workflow.md`'s policy layer.
- **Generated TypeScript clients from the registry.** Same vein —
  not needed; agents curl directly.
- **Versioning.** No `/v1/` prefix today; not adding one. If we
  ever break the shape, we add a `version` field to
  `AgentApiEndpoint` and emit two sections. Cross that bridge
  when we get to it.

## Open questions

- **Should the catalog include framework non-callback endpoints?**
  `/api/admin/*` is for admin UIs and API-key clients, not agents.
  Skip it. `/api/copilot/*` is browser-facing. Skip it. The
  registry is scoped to `/api/agent/*` only.
- **Where does the hand-curated `protocol.ts` fallback go on
  zero-tenant boots?** Catalog returns `""` when the registry is
  empty (shouldn't happen in practice — `routes.ts` populates it
  unconditionally). Fine.
- **Token cost.** ~9 endpoints × ~80 tokens each = ~720 tokens
  added to every system prompt. Less than the connector-actions
  catalog already contributes. Acceptable.

## Build order

1. `AgentApiEndpoint` + `createAgentApiRegistry()` — type + tiny
   in-memory store, ~30 lines.
2. `routes.ts`: register each endpoint alongside its handler. The
   registration is the documentation now — same PR.
3. `createAgentApiCatalogProvider` — copy-paste-tweak from
   `connector-actions-catalog.ts`. Wire into engine.
4. Delete the hand-curated curl block from `protocol.ts`. Verify
   with `pnpm test:run` (no new tests needed; existing prompt
   smoke tests should accept the new section as long as required
   strings still appear).
5. Smoke an agent run end-to-end.

Approx 200 lines new + ~80 lines deleted.
