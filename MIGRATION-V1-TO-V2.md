# Migration: v1 → v2

This file is the practical cutover guide. v2 ships alongside v1
on `branch_modules_skills` and is **opt-in** — your v1 deployment
keeps working until you flip the flag.

## What changed

v2 collapses three concepts (connector, app, plugin) into one
(**Module**) and exposes one tool surface (`POST
/api/tools/<module>.<name>`) instead of three (`/api/agent/*`,
`/api/connectors/actions/*`, `/api/copilot/*`). See
[`docs/blockers/task_12_greenfield_rebuild.md`](docs/blockers/task_12_greenfield_rebuild.md)
for the full architectural shift.

## Three modes you can run in

### Mode A — v1 only (default; pre-cutover)

```typescript
const app = new BoringOS({});
// don't register any v2 modules; don't set v2Only
await app.listen(3000);
```

Behavior identical to v1. v2 code is dormant. **No agent
behavior change.**

### Mode B — v1 + v2 in parallel (safe testing)

```typescript
import { BoringOS, createFrameworkModule, createMemoryModule, /*…*/ } from "@boringos/core";

const app = new BoringOS({});
app.module(createFrameworkModule);
app.module(createMemoryModule);
// register every other module you want
await app.listen(3000);
```

Behavior:
- v1 routes (`/api/agent/*`, `/api/copilot/*`, `/api/connectors/actions/*`)
  remain mounted — old clients keep working
- v2 routes (`/api/tools/*`, `/api/admin/v2/*`) also mounted
- The agent's prompt has BOTH v1 sections (memory-skill,
  drive-skill, etc.) AND v2 sections (`## Skills`, `## Available tools`)
- Per-tenant install state in `module_installs`; lifecycle hooks
  fire on install/uninstall

This is the recommended state for verifying v2 covers your
deployment.

### Mode C — v2 only (the cutover)

```typescript
const app = new BoringOS({ v2Only: true });
app.module(createFrameworkModule);
app.module(createMemoryModule);
app.module(createDriveModule);
app.module(createInboxModule);
app.module(createWorkflowModule);
app.module(createCopilotModule);
app.module(createSlackModule);          // optional
app.module(createGoogleModule);         // optional
app.module(createHebbsCrmModule);       // optional
app.module(createTriageModule);         // optional
await app.listen(3000);
```

Behavior:
- v1 routes return 404 (`/api/agent/*`, `/api/copilot/*`)
- v1 prompt providers (memory-skill, drive-skill, approvals-skill,
  protocol curl block, chief-of-staff, api-catalog,
  connector-actions-catalog) are NOT registered
- The agent's prompt comes entirely from v2 SKILL providers + tool
  catalog
- Per-run providers (header, persona, hierarchy, tenant guidelines,
  agent instructions, session, task, comments, memory-context)
  remain registered in both modes — they're not v1-specific

**Required built-ins:** `createFrameworkModule` is mandatory in
v2-only mode (it ships the `framework.*` tools that replace
`/api/agent/*`). The others are optional but cover capabilities
your agents may rely on.

## Cutover steps

1. **Move to Mode B in dev**: register all v2 modules, leave
   `v2Only` off. Verify your agents still work.
2. **Run the v2 parity test**:
   ```bash
   pnpm vitest run tests/v2-parity.test.ts
   ```
   This exercises every promised v2 surface in v2-only mode. Must
   pass before you switch your prod deployment.
3. **Flip `v2Only: true` in dev**, restart, verify everything
   still works. Check the v2 admin Settings panels (Modules,
   Tool catalog, Tool calls) for live monitoring.
4. **Update agent runtime contracts** if applicable: agents
   spawned by your runtime modules need to know they should call
   `POST /api/tools/<name>` (not `/api/agent/*`). The framework
   SKILL.md "tool-protocol" teaches this — every v2 module
   registered makes this skill available.
5. **Roll out to prod**: ship the host config change with
   `v2Only: true` + module registrations.
6. **(optional) Delete v1 code**: once v2-only is stable in prod,
   the v1 routes / providers / BlockHandler registry / old
   ConnectorDefinition.actions can be deleted. v2-only mode
   already proves they're unreachable; deletion is mechanical
   cleanup.

## Tool naming reference

Every v1 endpoint has a v2 equivalent:

| v1 path | v2 tool |
|---|---|
| `GET /api/agent/tasks/:id` | `framework.tasks.read` |
| `PATCH /api/agent/tasks/:id` | `framework.tasks.patch` |
| `POST /api/agent/tasks` | `framework.tasks.create` |
| `POST /api/agent/tasks/:id/comments` | `framework.comments.post` |
| `POST /api/agent/tasks/:id/work-products` | `framework.work_products.record` |
| `POST /api/agent/runs/:id/cost` | `framework.runs.report_cost` |
| `POST /api/agent/agents` | `framework.agents.create` |
| `GET /api/agent/inbox/:id` | `framework.inbox.read` |
| `PATCH /api/agent/inbox/:id` | `framework.inbox.update` |
| `POST /api/connectors/actions/google/send_email` | `google.gmail.send_email` |
| `POST /api/connectors/actions/google/list_emails` | `google.gmail.list_emails` |
| `POST /api/connectors/actions/slack/send_message` | `slack.send_message` |
| `POST /api/copilot/sessions` (browser) | `/api/admin/tasks` with `originKind: "copilot"` |
| `POST /api/copilot/sessions/:id/message` (browser) | `/api/admin/tasks/:id/comments` |

Auth: same JWT (`Authorization: Bearer $BORINGOS_CALLBACK_TOKEN`)
for every `/api/tools/*` call. Body shape: JSON matching the
tool's Zod input schema. Response shape: `{ ok: true, result }` or
`{ ok: false, error: { code, message, retryable } }`.

## What v2 does that v1 doesn't

- **Audit trail**: every tool call writes a `tool_calls` row
  (queryable via `GET /api/admin/v2/tool-calls`). v1's
  ad-hoc logging is fragmented across packages.
- **Per-tenant module install state**: tenants can install /
  uninstall modules independently. v1 had no such concept.
- **Lifecycle hooks**: `Module.lifecycle.{onInstall, onUninstall,
  onTenantCreate}` fire on the right events. Schema migrations
  (`Module.schema[]`) apply on install, roll back on uninstall.
- **Capability resolution**: `Module.dependsOn: [{ capability:
  "email-send" }]` resolves against any installed module's
  `provides`. Hard deps fail registration; optional deps no-op.
- **Workflows are tools**: `workflow.run` walks any saved DAG and
  dispatches per-block tools (5 control-flow primitives + every
  registered tool). Replaces v1's separate BlockHandler registry.

## Schema additions in v2

These tables are additive; v1 schema is untouched:

- `tool_calls` — audit row per dispatch
- `module_installs` — per-tenant install state
- `module_migrations` — applied schema migrations per (tenant, module)
- `hebbs_crm__deals`, `hebbs_crm__contacts`, `hebbs_crm__pipelines`,
  `hebbs_crm__activities` — Hebbs CRM module's owned tables

## Manual verification

After flipping `v2Only: true`:

```bash
# /health surfaces v2 module count
curl -s http://localhost:3030/health | jq .v2

# Modules screen (in shell) shows registered modules with install state
# /api/admin/v2/modules
# /api/admin/v2/tools
# /api/admin/v2/tool-calls
# /api/admin/v2/installs

# v1 routes return 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/api/agent/tasks/x
# Expected: 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/api/copilot/sessions
# Expected: 404
```

## Rollback

If you flip `v2Only: true` and something breaks, simply remove
the flag and restart. v2 modules stay registered (v2 routes still
work) and v1 routes come back online — no data migration needed.
