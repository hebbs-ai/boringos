# v2 rebuild — autonomous session(s) progress

> Branch: `branch_modules_skills`
> Date: 2026-05-08
> Cumulative commits: 24
> Tests: 117 passing across 19 files (59 v2 + 58 v1 sanity)
> **Status: all 12 phases of `task_12` shipped. v2-only cutover via config flag.**

## Phases delivered

### Phase 0 — branching ✅
Both repos cut to `branch_modules_skills`.

### Phase 1 — core types and registries ✅
- `@boringos/module-sdk` (types + Zod re-export)
- `createToolRegistry` / `createSkillRegistry` / `createModuleRegistry`
- `tool_calls` audit table

### Phase 2 — Zod-validated dispatcher + HTTP route ✅
- `dispatch()` / `invoke()` with full error model
- `POST /api/tools/:fullName` — JWT-authed, single agent surface
- Audit row per dispatch

### Phase 3 — prompt providers ✅
- `createSkillsProvider` / `createToolCatalogProvider`
- Wired into pipeline alongside v1 (additive) until v2-only mode flips

### Phase 4 — framework Module ✅
- 9 tools: `tasks.{read, create, patch}`, `comments.post`,
  `work_products.record`, `runs.report_cost`, `agents.create`,
  `inbox.{read, update}`
- 3 SKILL.md skills: `tool-protocol`, `approvals`, `when-stuck`
- `agents.create` defaults `reportsTo` to caller (respects "one root per
  tenant" constraint)

### Phase 5 — built-in modules + lifecycle runtime ✅
- `memory`, `drive`, `workflow`, `inbox`
- Lifecycle hooks (`onInstall` / `onUninstall` / `onTenantCreate`)
  invoked at the right times
- Per-tenant install state (`module_installs` table)
- Lazy install of default-install modules for backward compat

### Phase 6 — copilot Module ✅
- `copilot.start_session(title?, initialMessage?)` tool
- Wraps the per-tenant copilot agent
- v1 `/api/copilot/*` continues to work in parallel

### Phase 7 — connector modules + workflow.run ✅
- `slack` connector module — 3 tools, looks up tenant creds
- `google` connector module — 8 tools (Gmail + Calendar)
- `workflow.run` tool — walks DAG, dispatches per-block tools
- 5 control-flow primitives: `condition`, `for_each`, `delay`,
  `transform`, `branch` (passthrough)
- Template substitution `{{nodeId.field}}` resolves against
  upstream outputs
- Records `workflow_runs` row (running → completed | failed)
- Audit rows tagged `invokedBy: "workflow"`

### Phase 8 — CRM hybrid Module ✅
- `hebbs-crm` module with own schema (`hebbs_crm__*` prefix)
- 6 tools: `create_deal`, `list_deals`, `move_stage`,
  `create_contact`, `list_contacts`, `list_pipelines`
- Activity rows logged on creates / stage changes
- `provides: ["crm-source", "crm-actions"]`,
  `dependsOn: [{ capability: "email-send", optional: true }]`

### Phase 9 — capability resolution + triage ✅
- Module registry validates `dependsOn` at registration time
- Concrete deps + capability deps + optional deps all working
- `triage` capability module with `dependsOn: [{ capability: "inbox" }]`
- Tools: `triage.next_pending`, `triage.classify`
- SKILL.md teaching urgent / important / fyi / noise rubric

### Phase 10 — admin endpoints + UI ✅
- `/api/admin/v2/modules` — list registered + per-tenant install state
- `/api/admin/v2/tools` — flat tool catalog
- `/api/admin/v2/tool-calls` — audit log per tenant (filterable)
- `/api/admin/v2/installs` — per-tenant install state
- `POST /api/admin/v2/modules/:id/install` + `/uninstall` — lifecycle
- Four Settings panels in the shell: **Modules**, **Tool catalog**,
  **Tool calls**, **Workflow blocks**

### Phase 11 — docs ✅
- [`CLAUDE.md`](CLAUDE.md) — full v2 architecture section
- [`BUILD-A-MODULE.md`](BUILD-A-MODULE.md) — author starter
- [`MIGRATION-V1-TO-V2.md`](MIGRATION-V1-TO-V2.md) — cutover guide
- [`docs/blockers/task_12_greenfield_rebuild.md`](docs/blockers/task_12_greenfield_rebuild.md)
  — full architectural plan
- [`docs/blockers/task_13_v2_docs_rewrite.md`](docs/blockers/task_13_v2_docs_rewrite.md)
  — full docs-rewrite plan with CRM as canonical example
- [`docs/v2/session-1-progress.md`](docs/v2/session-1-progress.md)
  — this file

### Phase 12 — cutover ✅
- `config.v2Only: true` flag flips the framework into v2-pure mode:
  - v1 routes (`/api/agent/*`, `/api/copilot/*`) return 404
  - v1 providers (memory-skill, drive-skill, approvals-skill,
    chief-of-staff, protocol curl block, api-catalog,
    connector-actions-catalog) NOT registered
  - Per-run providers stay (header, persona, hierarchy,
    tenant-guidelines, agent-instructions, session, task,
    comments, memory-context)
- Default `v2Only: false` keeps full parity
- Rollback is one config flip
- Final v1 code deletion is mechanical cleanup (deferred to a
  separate maintenance pass — code unreachable in v2-only mode)

## Plus extras shipped

- **Module.schema migration runtime** — `up()` runs on install,
  `down()` rolls back on uninstall. Idempotent via
  `module_migrations` table. Re-install after uninstall reapplies.
- **SKILL.md disk loading** — string skill refs in the manifest
  resolve to files relative to `__moduleDir`, with YAML
  frontmatter parsing (`id`, `priority`, `roles`, `requires`).
  Inline form still works.
- **Workflow visual editor palette** — Settings panel surfaces
  every available block (5 control-flow primitives + tool
  registry). Foundation for the future `@boringos/workflow-ui`
  upgrade.
- **`/health` v2 surface** — module / tool / skill counts.
- **`POST /api/admin/v2/modules/:id/install` and `/uninstall`** —
  admin can flip per-tenant install state. Hooks fire, schema
  migrations apply / roll back.
- **v2 parity test suite** (`tests/v2-parity.test.ts`) — single
  integration test exercising every v1 capability through its v2
  equivalent in v2-only mode.

## Modules registered

| Module id | Tools | Skills | Role | Provides |
|---|---|---|---|---|
| `framework` | 9 | 3 | built-in | `task-management`, `audit` |
| `memory` | 3 | 1 | built-in | `memory` |
| `drive` | 6 | 1 | built-in | `file-storage` |
| `workflow` | 4 | 1 | built-in | `workflow-runtime` |
| `inbox` | 3 | 1 | built-in | `inbox` |
| `copilot` | 1 | 1 | built-in | `copilot` |
| `slack` | 3 | 1 | connector | `chat` |
| `google` | 8 | 2 | connector | `email-send`, `email-search`, `calendar` |
| `hebbs-crm` | 6 | 1 | hybrid | `crm-source`, `crm-actions` |
| `triage` | 2 | 1 | capability | `triage` |
| **Total** | **45 tools** | **13 skills** | — | **10 modules** |

## Tests (all green)

| File | Tests | Covers |
|---|---|---|
| `tests/v2-registries.test.ts` | 19 | tool/skill/module registry, capability resolution |
| `tests/v2-dispatcher.test.ts` | 7 | validation, error model, thrown handler recovery |
| `tests/v2-http.test.ts` | 2 | HTTP dispatch with auth |
| `tests/v2-providers.test.ts` | 6 | skills + tool-catalog providers |
| `tests/v2-framework-module.test.ts` | 2 | framework module end-to-end + audit |
| `tests/v2-builtin-modules.test.ts` | 1 | seven modules wired together |
| `tests/v2-hebbs-crm-module.test.ts` | 1 | full CRM lifecycle |
| `tests/v2-triage-module.test.ts` | 3 | triage + capability resolution |
| `tests/v2-workflow-run.test.ts` | 6 | workflow.run + 4 control-flow blocks |
| `tests/v2-lifecycle.test.ts` | 2 | install/uninstall hooks + idempotency |
| `tests/v2-admin.test.ts` | 1 | admin endpoints |
| `tests/v2-skill-loading.test.ts` | 4 | SKILL.md disk loading |
| `tests/v2-module-migrations.test.ts` | 1 | schema migrations runtime |
| `tests/v2-only-mode.test.ts` | 3 | v2-only flag |
| `tests/v2-parity.test.ts` | 1 | full parity sweep |
| **v2 total** | **59** | — |

Plus 58 v1 sanity tests across phase1-smoke, phase2-smoke,
phase4-workflow, phase5-auth.

**Combined: 117 tests passing across 19 files.**

## Known issues (pre-existing, not from this rebuild)

`tests/phase9-admin-api.test.ts > approvals` — broken since
commit `8962c04` (task_06) when the `approvals` table was
removed. Test file imports a no-longer-exported binding. Optional
follow-up: delete the test or rewrite against the `tasks` shape.

## What "complete" means here

- ✅ Every phase of `task_12` shipped
- ✅ Cutover available via single config flag (`v2Only: true`)
- ✅ Parity test passes — every v1 capability has a working v2 equivalent
- ✅ v1 code retained for rollback safety; deletion is mechanical
- ✅ Manual test plan documented in
  [`MIGRATION-V1-TO-V2.md`](../../MIGRATION-V1-TO-V2.md)

## Manual test plan

```bash
cd /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework
git status                                # branch_modules_skills, 24 commits
pnpm install
pnpm -r build                             # 23 packages green
pnpm -r typecheck                         # all green
pnpm vitest run tests/v2-*.test.ts        # 59 v2 tests
pnpm vitest run tests/phase1-smoke.test.ts tests/phase2-smoke.test.ts \
                tests/phase4-workflow.test.ts tests/phase5-auth.test.ts
                                          # 58 v1 sanity tests
```

To exercise v2-only mode in dev:

```typescript
// scripts/dev-server.mjs (or your local entry point)
import { BoringOS, createFrameworkModule, createMemoryModule, createDriveModule,
         createInboxModule, createWorkflowModule, createCopilotModule,
         createHebbsCrmModule, createTriageModule } from "@boringos/core";

const app = new BoringOS({ v2Only: true });
app.module(createFrameworkModule);
app.module(createMemoryModule);
app.module(createDriveModule);
app.module(createInboxModule);
app.module(createWorkflowModule);
app.module(createCopilotModule);
app.module(createHebbsCrmModule);
app.module(createTriageModule);
await app.listen(3030);
```

Then verify:
- `curl -s http://localhost:3030/health | jq .v2` shows all 8 modules
- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/api/agent/tasks/x` returns `404`
- The shell's Settings → Modules / Tool catalog / Tool calls / Workflow blocks panels populate
