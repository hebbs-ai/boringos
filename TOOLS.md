# TOOLS.md — the Tool spec

Reference for v2's universal callable shape. Every operation an
agent can invoke — read a task, send an email, move a deal — is
a Tool, registered by a Module, dispatched at one URL.

The TypeScript types live in
[`packages/@boringos/module-sdk/src/types.ts`](packages/@boringos/module-sdk/src/types.ts).
The dispatcher lives in
[`packages/@boringos/agent/src/v2/dispatcher.ts`](packages/@boringos/agent/src/v2/dispatcher.ts).

---

## What is a Tool?

```ts
interface Tool<TInput, TOutput> {
  name: string;
  description: string;
  inputs: SchemaLike<TInput>;        // typically a Zod schema
  output?: SchemaLike<TOutput>;
  handler(inputs: TInput, ctx: ToolContext): Promise<ToolResult<TOutput>>;
  permissions?: string[];
  idempotency?: "none" | "key";
  costHint?: "cheap" | "moderate" | "expensive";
  examples?: ToolExample[];
}
```

Tools are registered by Modules. Once registered, a Tool is
callable two ways:

1. **HTTP** — `POST /api/tools/<module-id>.<tool-name>` from any
   agent run with a valid bearer JWT.
2. **In-process** — `dispatch(deps, fullName, inputs, ctx)` from
   workflow nodes, routines, lifecycle hooks, admin endpoints.

Both paths go through the same dispatcher: same Zod validation,
same audit, same error model.

---

## Naming

| Rule | Example |
|---|---|
| Module ids are lowercase, hyphen-separated | `hebbs-crm`, `connector-google` |
| Tool names are lowercase, snake_case, verb-led | `send_email`, `list_deals`, `move_stage` |
| Full name uses dot separator | `hebbs-crm.create_deal` |
| Reserved prefix `framework.*` — only the framework module | `framework.tasks.patch`, `framework.comments.post` |

The full name is the URL path component:
`POST /api/tools/hebbs-crm.create_deal`.

### Reserved framework tools

| Tool | Purpose |
|---|---|
| `framework.tasks.read` | Get a task by id with comments |
| `framework.tasks.create` | Create a new task |
| `framework.tasks.patch` | Update status / assignee / metadata |
| `framework.comments.post` | Post a comment to a task |
| `framework.work_products.record` | Record a deliverable on a task |
| `framework.runs.report_cost` | Report token + USD cost for the run |
| `framework.agents.create` | Create an agent |
| `framework.agents.list` | List tenant agents |
| `framework.agents.wake` | Wake an agent on a task |
| `framework.inbox.read` | Read an inbox item |
| `framework.inbox.update` | Update an inbox item's status / metadata |

---

## Inputs and outputs

Inputs are validated against a Zod schema before the handler runs.
Unknown fields are rejected with `code: "invalid_input"` —
silent field drops impossible.

```ts
import { z } from "@boringos/module-sdk";

const createDeal: Tool = {
  name: "create_deal",
  description: "Create a new deal in the active pipeline",
  inputs: z.object({
    title: z.string().min(1).max(200),
    amountCents: z.number().int().positive().optional(),
    contactId: z.string().uuid().optional(),
    stage: z.string().default("lead"),
  }),
  output: z.object({
    dealId: z.string().uuid(),
    url: z.string(),
  }),
  async handler(input, ctx) {
    const dealId = generateId();
    await ctx.db.insert(deals).values({
      id: dealId,
      tenantId: ctx.tenantId,
      title: input.title,
      amountCents: input.amountCents,
      stage: input.stage,
    });
    return { ok: true, result: { dealId, url: `/apps/crm/deals/${dealId}` } };
  },
};
```

Output schemas are optional but recommended — they let the
workflow editor type-check downstream `{{node.field}}` references
and let the agent's tool catalog show what to expect.

---

## ToolContext

Every handler receives a `ToolContext` alongside its inputs.

```ts
interface ToolContext {
  tenantId: string;          // always present
  agentId?: string;          // calling agent, when known
  runId?: string;            // calling run, when known
  taskId?: string;           // active task, when known
  invokedBy: ToolInvocationSource;
}

type ToolInvocationSource =
  | "agent"       // HTTP from agent JWT
  | "routine"     // cron tick
  | "workflow"    // DAG node
  | "admin"       // admin UI / API
  | "internal";   // engine-internal (e.g. lifecycle hook)
```

**Always read `tenantId` from `ctx`, never from inputs.** Agents
could otherwise spoof another tenant by lying in the request body.
The dispatcher derives `tenantId` from the JWT claim, not the
request payload.

---

## Result shape

Every handler returns `ToolResult<T>`:

```ts
type ToolResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: ToolError };

interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
}

type ToolErrorCode =
  | "invalid_input"        // schema rejected
  | "not_found"            // referenced resource missing
  | "permission_denied"    // caller lacks permission
  | "upstream_unavailable" // 3rd party down
  | "rate_limited"         // upstream or local rate limit
  | "conflict"             // version conflict / concurrent edit
  | "internal";            // bug — only set by dispatcher on uncaught throw
```

### When to throw vs return error

- **Throw** for bugs the caller can't fix (database down, unhandled
  case, unexpected null). The dispatcher catches and converts to
  `code: "internal"`, returns 500.
- **Return `{ ok: false, error }`** for expected failures the
  agent should reason about (deal not found, upstream rate limited,
  permission denied).

Agents are taught (in the framework `tool-protocol` SKILL.md):
on `retryable: true`, retry with backoff. On `retryable: false`,
post a comment explaining what failed and either ask for help or
mark the task blocked.

---

## HTTP transport

```
POST /api/tools/<module-id>.<tool-name>
Authorization: Bearer $BORINGOS_CALLBACK_TOKEN
Content-Type: application/json

{ ...inputs matching the tool's schema }
```

### Response shapes

| Status | Body | When |
|---|---|---|
| 200 | `{ ok: true, result }` | Handler succeeded |
| 200 | `{ ok: false, error }` | Handler returned a business error |
| 400 | `{ ok: false, error: { code: "invalid_input" } }` | Input failed Zod validation |
| 401 | `{ ok: false, error: ... }` | JWT missing / invalid / expired |
| 403 | `{ ok: false, error: { code: "permission_denied" } }` | Module not installed for tenant, or tool not allowed for agent |
| 404 | `{ ok: false, error: { code: "not_found" } }` | Unknown tool name |
| 429 | `{ ok: false, error: { code: "rate_limited" } }` | Per-tenant or per-tool rate limit hit |
| 500 | `{ ok: false, error: { code: "internal" } }` | Handler threw uncaught |

200 covers both success and business errors — the agent reads
`ok` to decide. Validation, transport, and tool-not-found get
HTTP-level codes so middleware / proxies can react.

### JWT shape

```json
{
  "sub": "<runId>",
  "agent_id": "<agentId>",
  "tenant_id": "<tenantId>",
  "exp": <unix-seconds>
}
```

Signed HMAC-SHA256, 4-hour expiry. Issued by the engine when it
spawns an agent run; injected as `BORINGOS_CALLBACK_TOKEN`. The
dispatcher verifies the signature and reads identity from claims
— never from the request body.

---

## Audit

Every dispatch writes a `tool_calls` row, regardless of outcome.

| Column | Notes |
|---|---|
| `id`, `tenant_id` | UUIDs |
| `tool_name` | Fully qualified `<module>.<tool>` |
| `module_id` | Denormalized for query speed |
| `invoked_by` | One of `agent` / `routine` / `workflow` / `admin` / `internal` |
| `agent_id`, `run_id`, `task_id` | When known |
| `inputs` | Validated inputs (post-Zod) as jsonb |
| `result` | Successful result body |
| `error` | Structured error body |
| `status` | `ok` / `error` / `validation_failed` / `permission_denied` / `not_found` / `internal` |
| `duration_ms` | Wall-clock |
| `idempotency_key` | When supplied |
| `started_at`, `ended_at` | Timestamps |

Audit failures don't block the call — they're logged to stderr.

### Useful queries

```sql
-- Every send_email this tenant did in the last 7 days
SELECT started_at, agent_id, inputs->>'to' AS to, status
  FROM tool_calls
 WHERE tenant_id = $1
   AND tool_name = 'gmail.send_email'
   AND started_at > now() - interval '7 days'
 ORDER BY started_at DESC;

-- Hottest tools by duration this hour
SELECT tool_name, count(*), avg(duration_ms)::int AS avg_ms
  FROM tool_calls
 WHERE tenant_id = $1
   AND started_at > now() - interval '1 hour'
 GROUP BY tool_name
 ORDER BY avg_ms DESC;

-- Why was agent X woken at 3:14am
SELECT * FROM tool_calls
 WHERE tool_name = 'framework.agents.wake'
   AND inputs->>'agentId' = $1
   AND started_at >= '2026-05-09 03:14';
```

---

## Idempotency

> **Status:** Field declared in the Tool spec; the dispatcher
> persists `idempotencyKey` to the audit row. Dedupe behavior is
> **not yet shipped** — see
> `packages/@boringos/agent/src/v2/dispatcher.ts` ("Idempotency,
> rate-limits, permissions: deferred to later phases"). Tools can
> declare the field today; behavior follows.

Planned semantics: callers supply an `Idempotency-Key` header;
the dispatcher dedupes within a 24-hour window so retries return
the original result body without re-running the handler.

```ts
const sendEmail: Tool = {
  name: "send_email",
  description: "Send an email through the connected Gmail account",
  inputs: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  idempotency: "key",
  async handler(input, ctx) { /* ... */ },
};
```

---

## Permissions

> **Status:** `permissions` field declared in the Tool spec;
> dispatcher does **not** yet enforce it. Set it for forward
> compatibility — enforcement lands with the same phase as
> idempotency.

Default is open within tenant. Planned semantics: the dispatcher
checks the agent's role against `permissions` before running the
handler; mismatch returns `code: "permission_denied"`, status 403.

```ts
const deleteAllDeals: Tool = {
  name: "delete_all_deals",
  description: "Wipe every deal — admin-only",
  inputs: z.object({ confirm: z.literal("YES") }),
  permissions: ["admin"],
  async handler(input, ctx) { /* ... */ },
};
```

Planned per-tenant override via `tenant_settings`:

```
tool.<full-name>.requires = ["admin"]
```

---

## Cost hints

```ts
costHint: "cheap" | "moderate" | "expensive"
```

Hint to the budget enforcer and the routine scheduler. `expensive`
tools may be rate-limited harder, scheduled less frequently, or
blocked by tighter budget caps.

Examples:
- `cheap` — read-only DB query
- `moderate` — single 3rd-party API call
- `expensive` — LLM-backed tool, multi-step workflow, batch upload

---

## Examples

Optional sample input/output pairs shown to the agent in its tool
catalog when the schema isn't self-explanatory.

```ts
examples: [
  {
    description: "Move a deal to the won stage",
    input: { dealId: "...", stage: "won", reason: "Contract signed" },
    output: { dealId: "...", previousStage: "qualified", newStage: "won" },
  },
]
```

The catalog provider surfaces these to the agent verbatim.

---

## Internal vs HTTP dispatch

```ts
import { dispatch } from "@boringos/agent";

const result = await dispatch(
  { registry: toolRegistry, db },
  "hebbs-crm.create_deal",
  { title: "Acme renewal", amountCents: 5_000_000 },
  { tenantId, invokedBy: "internal" },
);
```

Same handler, same Zod validation, same audit. No JWT round-trip.

Use this from:
- Workflow DAG nodes (`workflow.run` invokes child tools internally)
- Routine scheduler (cron fires → dispatch the routine's tool)
- Lifecycle hooks (`onInstall` may seed data via tools)
- Admin endpoints (admin UI buttons that mirror tool calls)

The `invokedBy` field on `ctx` distinguishes call sites in the
audit log — `internal` invocations are filterable separately from
`agent` HTTP traffic.

---

## Anti-patterns

| Don't | Why |
|---|---|
| Read `tenantId` from inputs | Spoofable; always use `ctx.tenantId` |
| Skip the result shape | The wrapper is the contract — agents and workflows depend on it |
| Throw for expected errors | Throwing routes through `code: "internal"`; agents can't reason about it |
| Mix idempotent + non-idempotent operations in one tool | Split them; `idempotency: "key"` covers the whole tool |
| Long-running handlers (>30s) | Tools should be quick; long work belongs in a workflow with a checkpoint tool that polls |
| Side effects in `validate` (Zod refines) | Refines should be pure; side effects belong in the handler |
| Hand-rolled HTTP error responses | Return structured errors; let the dispatcher set the status code |

---

## See also

- [`MODULES.md`](MODULES.md) — Module manifest spec
- [`SKILLS.md`](SKILLS.md) — Skill spec
- [`BUILD-A-MODULE.md`](BUILD-A-MODULE.md) — step-by-step build guide
- `packages/@boringos/agent/src/v2/dispatcher.ts` — dispatcher source
- `packages/@boringos/agent/src/v2/tool-registry.ts` — registry source
- `packages/@boringos/db/src/schema/tool-calls.ts` — audit table
