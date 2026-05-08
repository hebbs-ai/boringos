# Blocker — task_13: v2 documentation rewrite + build-a-Module guide

> **Depends on:** task_12 (rebuild). This task ships at cutover —
> v2 cannot ship without docs that explain it. The build-a-Module
> guide is the centerpiece; it doubles as the test of whether the
> v2 abstractions are teachable.

This is the doc-layer companion to the rebuild. Every file we
ship to GitHub or npm needs to reflect v2's mental model: Skills
+ Tools + Modules. Anything that still describes the v1 shape is
a bug.

---

## 1. Goals

1. **Every doc in the repo describes v2.** No mixed-model
   pages, no "v1 will be deprecated" hedge text, no leftover
   references to `BlockHandler` / `ConnectorDefinition.actions` /
   `/api/agent/*`.
2. **A new contributor can ship a Module in under one hour** by
   reading the build guide. Test: a teammate (or a fresh model
   in a clean session) reads the guide and produces a working
   Module that registers, renders skills, exposes tools, and
   passes one integration test.
3. **The CRM is the canonical worked example.** It appears in
   the build guide, in `examples/`, and in the architecture
   diagrams. Any reader who follows the CRM through the docs
   sees every Module dimension exercised: schema, tools, skills,
   admin routes, UI, default workflows, default agents, routines,
   lifecycle.
4. **`docs/` becomes navigable.** A clear top-level
   `docs/INDEX.md` points to everything. Today's mix of blockers
   + tests + scratch is reorganized.
5. **Per-package READMEs are accurate.** Every package's
   `README.md` describes its v2 role in 2-3 paragraphs.

---

## 2. What docs exist today

A full audit before writing replacements. Three buckets:

### Root-level docs
- `README.md` — entry point. Today: workflow engine + connectors
  + plugins narrative. Needs full rewrite.
- `CLAUDE.md` — agent orientation guide, ~700 lines. Today:
  describes v1 in detail. Needs full rewrite.
- `LICENSE` — keep as-is (MIT).
- `CHANGELOG.md` (if present) — keep, add v2.0.0 entry at
  cutover.

### Per-package READMEs
Existing files (`find packages -name "README.md"`):
- `@boringos/connector-google/README.md`
- `@boringos/ui/README.md`
- `@boringos/create-boringos/README.md`
- `@boringos/pipeline/README.md`
- `@boringos/app-sdk/README.md`
- `@boringos/connector-slack/README.md`
- `@boringos/core/README.md`
- `@boringos/memory/README.md`
- `@boringos/connector-sdk/README.md`
- `@boringos/shell/README.md`

Missing READMEs (need adding): `@boringos/agent`, `@boringos/db`,
`@boringos/runtime`, `@boringos/drive`, `@boringos/workflow`,
`@boringos/workflow-ui`, `@boringos/connector`, `@boringos/shared`.

After v2: every package has a README; some packages get folded
into modules (e.g. `@boringos/connector-sdk` becomes
`@boringos/module-sdk` — see §6 below).

### docs/ tree
- `docs/blockers/` — task plans (we're at task_13). Keep; archive
  v1-era ones to `docs/blockers/done/v1/`.
- `docs/tests/` — phase test results. Keep; add a v2-cutover
  result.
- `docs/build/` — phase task plans. Archive v1; add v2 phases.
- `docs/INDEX.md` — does not exist; add it.

---

## 3. What docs will exist in v2 (target list)

### Root-level
| File | Role | Audience |
|---|---|---|
| `README.md` | The repo's front door — what BoringOS is, why Skills + Tools + Modules, install + first Module in 60 seconds | Everyone (first-time visitor, npm consumer, skim reader) |
| `CLAUDE.md` | Agent orientation — primitives, file layout, how-tos for assistants and contributors making changes | Contributors (humans + AI assistants) |
| `MODULES.md` | Full Module manifest spec | Module authors (canonical reference) |
| `TOOLS.md` | Full Tool spec — naming, error model, idempotency, audit | Tool authors |
| `SKILLS.md` | Full Skill spec — file format, priorities, overrides | Skill authors |
| `BUILD-A-MODULE.md` | The canonical build guide using CRM as the running example | First-time Module authors |
| `MIGRATION-V1-TO-V2.md` | What changed and how to port | Anyone with a v1 deployment |
| `CONTRIBUTING.md` | How to contribute Modules + framework PRs | External contributors |
| `LICENSE` | MIT, unchanged | — |
| `CHANGELOG.md` | Versioned changes including v2.0.0 cutover note | Operators upgrading |

### docs/ tree
| Path | Role |
|---|---|
| `docs/INDEX.md` | Hand-curated nav across all docs |
| `docs/architecture/` | Diagrams (system, request flow, registries, prompt assembly) |
| `docs/architecture/v2-overview.svg` | Canonical architecture diagram |
| `docs/blockers/` | Active + done task plans, organized by version |
| `docs/blockers/done/v1/` | Archive of v1-era plans |
| `docs/blockers/done/v2/` | Archive of v2 plans as they complete |
| `docs/tests/` | Phase test results |
| `docs/recipes/` | Short cookbook entries — "wake an agent on email", "run a workflow on a schedule", etc. |

### Per-package READMEs (target)
Each gets a 2-3 paragraph description, an "imported by" list, and
a code-shape example. Files listed in §2 update; missing ones
added. All `@boringos/connector-*` packages link to
`BUILD-A-MODULE.md` instead of duplicating the guide.

### examples/
| Path | Role |
|---|---|
| `examples/quickstart/` | Minimal app: framework + memory + a custom 1-tool Module. ~30 lines of host code. |
| `examples/connector/` | Sample connector Module against a fake 3rd-party API |
| `examples/capability/` | Sample capability Module with `dependsOn` resolution |
| `examples/hybrid/` | Mini-CRM Module — schema + tools + UI screen + default agent |

---

## 4. The README — full structure

### Sections, in order

1. **Hero** (one sentence): "BoringOS is the operating system
   for agents. You ship Modules; the agent reads skills and
   calls tools. Everything else is plumbing."
2. **The two primitives** (one paragraph each):
   - **Skills** — markdown files that teach an agent how to think
     about something
   - **Tools** — Zod-typed callable operations
3. **The one shape** (Module). Brief: connector, capability,
   hybrid; same shape, three roles.
4. **60-second quickstart**: install + scaffold a Module + run
   the agent. Verbatim copy-pasteable.
5. **What's in the box**: built-in modules table (framework,
   memory, drive, inbox, copilot, workflow, routines).
6. **Connectors shipped**: google, slack — with links.
7. **Where to go next**: build guide, modules ref, examples.
8. **Comparison to v1** — three sentences. "If you're coming from
   v1, see MIGRATION-V1-TO-V2.md."
9. **License + contributing**.

Length: under 300 lines. Anything longer goes to a sub-doc.

### What the README does NOT cover

- Full Module spec (→ MODULES.md)
- Tool / Skill specs (→ TOOLS.md / SKILLS.md)
- Step-by-step Module authoring (→ BUILD-A-MODULE.md)
- v1 → v2 migration mechanics (→ MIGRATION-V1-TO-V2.md)
- Architecture deep dive (→ docs/architecture/)
- Per-package details (→ each package's README)

The README is the front door, not the manual.

---

## 5. CLAUDE.md — full structure

The agent orientation guide. Read by humans and AI assistants
making changes to this codebase.

### Sections, in order

1. **What is BoringOS** — one paragraph; same hero as README.
2. **The mental model** — Skills, Tools, Modules; one paragraph
   each. The one place in the repo a contributor can read and
   internalize the abstraction in 5 minutes.
3. **Monorepo layout** — table: package → role → key exports.
4. **Tech stack** — TypeScript, Hono, Drizzle, embedded Postgres,
   pluggable queue, Vitest, pnpm.
5. **Commands** — `pnpm install`, `pnpm -r build`, `pnpm test:run`,
   `pnpm dev`. Same as today.
6. **The agent's prompt, end-to-end** — exact section ordering
   when the engine builds the prompt. Sourced from §16 of
   task_12.
7. **The Module manifest** — one-paragraph summary + link to
   MODULES.md.
8. **Adding a Module** — 6-step recipe + link to
   BUILD-A-MODULE.md.
9. **Adding a Tool to an existing Module** — recipe.
10. **Adding a Skill** — recipe.
11. **Adding a Workflow** — recipe (visual editor + how to
    seed defaults).
12. **The agent execution pipeline** — wake → run → audit. Brief.
13. **Callback API authentication** — JWT shape, how it's verified.
14. **Per-task sessions** — invariant + why.
15. **Default-deny posture** — agents must ask for critical
    actions; how this is taught (framework SKILL.md).
16. **Database** — `tenantId` everywhere, Drizzle, embedded vs
    external Postgres.
17. **Testing** — unit, integration, prompt snapshot, parity
    tests.
18. **Code style** — TypeScript ESM, naming conventions,
    `tenantId` not `companyId`.
19. **Environment variables** — table.

Length: ~600 lines max. Smaller than today's CLAUDE.md (which is
~720) because the abstraction is simpler.

### What CLAUDE.md does NOT include

- Concrete code samples for every API (those go in package
  READMEs and BUILD-A-MODULE.md)
- Phase histories, blocker recaps (those live in `docs/`)

---

## 6. Per-package READMEs

Every package gets a README following this template:

1. **Name + tagline** — one line
2. **What's in this package** — exports list (types, classes,
   functions)
3. **What it's imported by** — names of other packages
4. **Minimal usage** — 10-20 line code shape
5. **Link to deeper docs** — pointer to the manifest spec /
   build guide if relevant

### Package role updates after v2

Some packages get renamed or repurposed during the rebuild. The
README capture happens after the rebuild, at cutover.

| Today's package | v2 status | README focus |
|---|---|---|
| `@boringos/shared` | Unchanged | Foundation types |
| `@boringos/agent` | Slimmed (drops most providers) | Engine + remaining 7 providers + per-task sessions |
| `@boringos/core` | Refactored — adds Module/Tool/Skill registries | Host application + boot sequence |
| `@boringos/db` | Schema reduced (13 tables) | Drizzle schema + migrations |
| `@boringos/runtime` | Unchanged | CLI subprocess execution |
| `@boringos/memory` | Wraps the `memory` Module | MemoryProvider + Hebbs client |
| `@boringos/drive` | Wraps the `drive` Module | StorageBackend + DriveManager |
| `@boringos/pipeline` | Unchanged | QueueAdapter (in-process / BullMQ) |
| `@boringos/connector` | **Renamed** to `@boringos/module-sdk` | Module SDK — manifest types, Tool / Skill helpers, OAuth helper |
| `@boringos/connector-google` | Stays under same name; shape is now a Module | Google Workspace Module |
| `@boringos/connector-slack` | Same | Slack Module |
| `@boringos/connector-sdk` | **Replaced** by `@boringos/module-sdk` | (deprecated) |
| `@boringos/app-sdk` | **Replaced** by `@boringos/module-sdk` | (deprecated) |
| `@boringos/workflow` | Becomes the `workflow` Module's runtime | DAG executor (5 control-flow primitives + tool-block dispatcher) |
| `@boringos/workflow-ui` | Visual editor; palette now sources from tool registry | React canvas + auto-generated config forms |
| `@boringos/ui` | Unchanged interface; updated for new endpoints | Typed API client + React hooks |
| `@boringos/create-boringos` | CLI generator; v2 templates: `module`, `connector`, `capability`, `hybrid` | Project + Module scaffolder |
| `@boringos/shell` | Updated to register Module UIs at build time | Browser shell — registers Module screens via `ui` field |

---

## 7. The build-a-Module guide — outline

This is the centerpiece. **CRM is the running example throughout.**
Every section shows: "Here's the abstraction. Here's how the CRM
uses it."

### Front matter
- **Who this guide is for**: developers building a new Module.
- **What you'll have at the end**: a working CRM Module — schema,
  tools, skills, UI, default workflows, default agents.
- **Time required**: ~1 hour for the basics, ~3-4 hours for the
  full eight-dimensional CRM.
- **Prerequisites**: TypeScript, basic React, basic Postgres.

### Part 1 — Concepts (10 minutes)

1. **What is a Module?** Recap: a bundle of skills + tools + (optional) schema, UI, workflows, agents, routines, oauth, webhooks.
2. **Choose your role** — decision tree:
   - Does it broker a 3rd-party service? → Connector module
   - Does it depend on others to do its work? → Capability module
   - Does it own its own data + logic? → Hybrid module
   - **CRM is hybrid.** Owns deals/contacts data, integrates optionally with Gmail.
3. **What you'll write** — eight files in the simplest CRM:
   - `module.ts` (manifest)
   - `SKILL.md` (one skill)
   - `tools.ts` (a few tools)
   - `schema.ts` (Drizzle migrations)
   - `routes.ts` (admin REST)
   - `ui/DealsScreen.tsx` (one UI screen)
   - `workflows/welcome.json` (one default workflow)
   - `package.json` (npm metadata)

### Part 2 — Set up the package (5 minutes)

- Run the scaffolder: `npx create-boringos module @hebbs/crm`.
- Generated structure: `src/`, `SKILL.md`, `package.json`,
  `tsconfig.json`.
- What the scaffolder writes vs what you fill in.

### Part 3 — Write the manifest (10 minutes)

Walk through each manifest field:

| Field | CRM example |
|---|---|
| `id` | `"hebbs-crm"` |
| `name` | `"Hebbs CRM"` |
| `version` | `"0.1.0"` |
| `description` | `"Customer relationship management — deals, contacts, pipelines."` |
| `dependsOn` | `[{ capability: "email-send", optional: true }]` |
| `provides` | `["crm-source", "crm-actions"]` |
| `skills` | `["./SKILL.md"]` |
| `tools` | `[...]` (filled in part 5) |
| `schema` | `[...]` (filled in part 4) |
| `routines` | `[...]` (filled in part 9) |
| `lifecycle` | `{ onInstall, onUninstall }` (filled in part 10) |

### Part 4 — Schema (10 minutes)

- Naming convention: `<id>__<table-name>` → `hebbs_crm__deals`,
  `hebbs_crm__contacts`, etc.
- Drizzle schema definitions for the CRM's three tables.
- How migrations run: framework calls `Module.schema.up()` on
  install, `down()` on uninstall.
- **Why namespacing matters**: collision prevention,
  clean uninstall, easy ownership audits.

### Part 5 — Tools (15 minutes)

The Tool spec, applied to the CRM:

1. **Anatomy of a Tool** — name, description, Zod inputs, Zod
   output, handler, optional permissions / idempotency / costHint.
2. **Naming** — `crm.create_deal`, `crm.list_deals`,
   `crm.move_stage`. Lowercase, snake-case, verb-led.
3. **The handler signature** — receives validated inputs +
   `ToolContext` (tenantId, agentId, runId, taskId, db).
4. **Error model** — return `{ ok: false, error: { code, message,
   retryable } }` for expected failures; throw for bugs.
5. **Audit** — every call writes a `tool_calls` row; you don't
   have to do anything.
6. **Idempotency** — when the CRM tool should set
   `idempotency: "key"` (writes that may retry).
7. **CRM's six core tools** — full input/output shapes for
   `create_deal`, `update_deal`, `list_deals`, `move_stage`,
   `create_contact`, `link_email_to_deal`.

### Part 6 — Skills (10 minutes)

The Skill spec applied to the CRM:

1. **The SKILL.md format** — frontmatter + body.
2. **What to put in `appliesTo`** — gating by role / origin.
3. **Priority** — when to override the default.
4. **What good skill content looks like** — the three rules:
   teach the model (what stages mean), teach the conventions
   (when to delegate, when to ask), teach the failure modes
   (don't move a deal without a recent activity).
5. **The CRM's main SKILL.md** — annotated full text.
6. **Cross-skill linking** — referencing tools by name; framework
   validates references at Module load.

### Part 7 — Admin routes — browser-facing CRUD (10 minutes)

1. **Why admin routes when you have tools** — tools are
   POST-with-JSON for agents; admin routes serve browsers with
   pagination, filters, GET semantics.
2. **Auto-generation** — for simple CRUD, set
   `Module.adminRoutes: "auto"` and the framework derives REST
   from the tools.
3. **Hand-writing** — when you need pagination, sorts, special
   query params: ship a Hono router under `routes/`.
4. **Auth** — admin routes get session token (browser) or API
   key auth, NOT the agent JWT.
5. **CRM example** — `GET /api/admin/hebbs-crm/deals?stage=...`,
   `POST /api/admin/hebbs-crm/deals`, etc.

### Part 8 — UI integration (15 minutes)

1. **What a Module's UI surface looks like** — `ui` field with
   `screens`, `taskPanels`, `inboxFilters`, `settingsPanels`.
2. **How screens register** — the host app imports the Module's
   React exports at build time; shell renders nav + routing.
3. **What you ship** — components in `src/ui/screens/*.tsx`,
   exported from `src/ui/index.ts`.
4. **What the shell provides** — context (`tenantId`,
   `currentUser`), an admin API client, an SSE event hook,
   shared design system primitives.
5. **CRM screens to build** — Deals list (table), Pipeline
   (kanban), Contacts list, Deal detail.
6. **CRM hooks** — `useCrmDeals`, `useCrmContact`, etc.,
   exported for the shell.
7. **Task panel example** — when a task is linked to a deal,
   render a "Deal context" panel via the Module's
   `taskPanels` registration.

### Part 9 — Default workflows (10 minutes)

1. **Why ship default workflows** — give tenants useful
   automations on day one.
2. **Workflow JSON shape** — `{ name, blocks, edges, trigger }`.
3. **Where they live** — `workflows/<name>.json` in the Module's
   source tree.
4. **How they get installed** — `onInstall` hook inserts rows
   into `workflows`; tenant can edit / disable in the visual
   editor.
5. **CRM example** — "When email arrives mentioning a deal id →
   post a comment on the deal task." Walk through the DAG
   block-by-block.

### Part 10 — Default agents (5 minutes)

1. **Why ship default agents** — pre-configured personalities
   for the Module's domain.
2. **Agent template shape** — `{ name, role, persona,
   instructions, tools[] }`.
3. **CRM example** — a "sales-rep" agent: `persona:
   "personas-default.sales-rep"`, scoped tools to `crm.*` and
   `gmail.send`, instructions covering this tenant's pipeline.
4. **How tenants customize** — agents appear after install;
   tenant can rename, delete, or assign to specific tasks.

### Part 11 — Routines (5 minutes)

1. **Three trigger types** — cron, event, webhook.
2. **CRM examples**:
   - Cron: weekly pipeline summary (Monday 9am).
   - Event: link inbound email to deal on `gmail.email_received`.
   - Webhook: not used here (no 3rd party brokered).
3. **How they get seeded** — same as workflows, via
   `onInstall`.

### Part 12 — Lifecycle hooks (5 minutes)

1. **`onInstall(tenantId)`** — run schema migrations, seed
   pipelines, create default agents, install workflows.
2. **`onUninstall(tenantId)`** — drop schema (with confirmation),
   remove agents, delete workflows. Atomic.
3. **`onTenantCreate(tenantId)`** — only fires if the Module is
   in the framework's default-install list. Most Modules opt
   out; the CRM is opt-in per tenant.

### Part 13 — Capability resolution (5 minutes)

1. **`dependsOn` semantics** — concrete (`{ moduleId: "..." }`)
   vs capability (`{ capability: "..." }`) vs optional.
2. **CRM's deps** — `{ capability: "email-send", optional: true }`.
   At runtime, the CRM checks if any installed Module provides
   `email-send`; uses it if available, falls back if not.
3. **`provides`** — what your Module announces; let other Modules
   depend on you abstractly.
4. **Install-time validation** — framework refuses to install if
   a non-optional dep can't be resolved.

### Part 14 — Testing (10 minutes)

1. **Unit tests for tools** — mock `ToolContext`, assert handler
   behavior.
2. **Schema tests** — install + uninstall round-trip.
3. **Integration tests** — fire up an in-memory framework, install
   the CRM module, exercise tools through HTTP.
4. **Prompt snapshot test** — assert the CRM's SKILL.md and tools
   appear in an agent prompt after install.
5. **Parity check** — for the CRM specifically: rows in v1's
   `crm_*` tables → equivalent operations on `hebbs_crm__*`
   produce the same agent behavior.

### Part 15 — Distribution (5 minutes)

1. **Publish to npm** — `pnpm publish` under the relevant scope.
2. **Versioning** — semver; bump `Module.version` at every
   release; framework records install version per tenant.
3. **README the Module** — what it provides, dependencies, how
   to install, screenshots if it has UI.
4. **CHANGELOG** — what changed each version.

### Part 16 — Walkthrough: a fresh Module from scratch

End-to-end build of a small "customer-health" capability Module
that depends on the CRM. Shows:
- Capability resolution in practice (`dependsOn:
  [{ capability: "crm-source" }]`)
- Calling another Module's tools from inside your handler
- Cross-Module skills (your SKILL.md references CRM's tools)
- A capability Module without its own UI (settings panel only)
- Total time: ~30 minutes.

---

## 8. MODULES.md — outline

Reference doc, not a tutorial. Audience: developers who already
read the build guide and want the spec.

1. Module manifest reference (every field, every type).
2. Module roles (connector / capability / hybrid).
3. Capability resolution semantics.
4. Lifecycle hooks (full contract).
5. Schema migrations + naming rules.
6. UI registration contract.
7. Routine trigger types.
8. Webhook + OAuth manifest blocks.
9. Best practices (when to make something a tool vs a routine vs
   a workflow).
10. Anti-patterns (what NOT to do — e.g. tools with side effects
    that aren't audited, schema without prefixes).

---

## 9. TOOLS.md — outline

1. Tool spec (every field).
2. Naming rules (full + reserved prefixes).
3. Input / output Zod schemas.
4. The `ToolContext` shape.
5. Error model (codes, messages, retryable).
6. Idempotency (when to opt in, the key contract).
7. Permissions and per-tool gating.
8. Audit (`tool_calls` table shape and queries).
9. Rate limiting (how to declare; tenant overrides).
10. Internal vs HTTP dispatch (when each happens).

---

## 10. SKILLS.md — outline

1. SKILL.md file format (frontmatter, body).
2. The `appliesTo` field (role / taskOrigin gating).
3. Priorities (the load order).
4. Source types (module, persona, agent instructions, tenant
   override).
5. Cross-references (linking to tools).
6. Tenant overrides + the `module_skill_overrides` table.
7. Best practices (length, voice, what to teach vs link).
8. Examples (annotated SKILL.md files).

---

## 11. MIGRATION-V1-TO-V2.md — outline

Audience: anyone running v1 in production at cutover.

1. **What's changing** — the conceptual delta (table view).
2. **What's wiped** — DB tables (greenfield), API trees, internal
   abstractions.
3. **What's preserved** — features (parity matrix from task_12 §1b).
4. **Re-onboarding a tenant** — step-by-step.
5. **Porting a v1 connector to a v2 Module** — mechanical steps,
   per concept (skillMarkdown → SKILL.md, actions → tools, etc.).
6. **Porting a v1 plugin to a v2 Module** — mechanical steps.
7. **Porting a v1 app (with custom routes) to a v2 Module** —
   mechanical steps.
8. **API endpoint mapping** (`/api/agent/tasks/:id` →
   `framework.tasks.read`, etc.).
9. **Workflow definition rewrites** (block type → kind + tool
   ref).
10. **Known compatibility gaps** — anything we can't or won't
    preserve.

---

## 12. examples/ — structure

Each example is its own runnable repo-in-a-repo with a `README.md`
+ `pnpm install && pnpm dev` workflow.

| Example | Lines of host code | Highlights |
|---|---|---|
| `quickstart` | ~30 | Bootstrap, register `framework` + `memory` modules, register one custom Module with one tool + one SKILL.md |
| `connector` | ~150 | Sample connector against a fake API: OAuth, tools, webhooks, skill |
| `capability` | ~80 | Sample capability that depends on `quickstart`'s custom module |
| `hybrid` | ~400 | Mini-CRM: schema, tools, skill, one UI screen, default agent. Distilled from BUILD-A-MODULE.md's CRM example. |

`hybrid` and BUILD-A-MODULE.md share code via symlink so the
guide and the working example never drift.

---

## 13. Architecture diagrams

Three SVGs in `docs/architecture/`:

1. **`v2-overview.svg`** — system layers. Tenant → Module
   registry → Tool registry / Skill registry → Agent engine →
   Queue → Runtime → CLI subprocess.
2. **`v2-prompt-assembly.svg`** — how an agent's system prompt is
   built. Skills section sourced from skill registry walk; tool
   catalog sourced from tool registry walk; per-run context
   sourced from DB.
3. **`v2-request-flow.svg`** — a tool call's lifecycle: agent
   subprocess → POST /api/tools/<name> → JWT verify → registry
   lookup → Zod validate → handler → audit row → response.

Drawn in Excalidraw or Whimsical and exported as both SVG (for
docs) and PNG (for README inline).

---

## 14. CONTRIBUTING.md — outline

1. Code style (TypeScript ESM, naming).
2. Branching + PR conventions.
3. Commit message style (one-line imperative, no co-author —
   already in user's memory).
4. Testing requirements before PR (unit + integration + prompt
   snapshot if touching providers).
5. Module contributions — what we accept, what we don't, the
   bar (passes parity matrix tests, has SKILL.md, has at least
   one integration test).
6. How to run the full v2 parity suite locally.

---

## 15. docs/INDEX.md — outline

Hand-curated nav. One page that links to everything in the right
reading order:

1. Start here: README.md
2. Build your first Module: BUILD-A-MODULE.md
3. References: MODULES.md, TOOLS.md, SKILLS.md
4. Migration: MIGRATION-V1-TO-V2.md
5. Architecture: docs/architecture/
6. Recipes: docs/recipes/
7. Active plans: docs/blockers/
8. Done plans: docs/blockers/done/
9. Test results: docs/tests/

---

## 16. The doc-rewrite phases

This task slots into task_12's Phase 11. Expanded sequencing:

### Phase 13.1 — audit + outline (1 day)
- Inventory every existing doc + identify v1-vs-v2 status.
- Lock the section structures of README, CLAUDE.md,
  BUILD-A-MODULE.md, MODULES.md, TOOLS.md, SKILLS.md before
  writing prose.

### Phase 13.2 — reference docs (2-3 days)
- MODULES.md, TOOLS.md, SKILLS.md, MIGRATION-V1-TO-V2.md.
- Reference docs go first because BUILD-A-MODULE.md and CLAUDE.md
  link into them.

### Phase 13.3 — BUILD-A-MODULE.md + the CRM example (3-4 days)
- Write the guide top-to-bottom, with the CRM as the running
  example.
- In parallel: build `examples/hybrid/` so the guide's code
  blocks come from a working build.
- This is the most important deliverable; it doubles as the
  abstraction's teachability test.

### Phase 13.4 — README + CLAUDE.md (1-2 days)
- Now that the references and the guide exist, write the front
  doors. They link forward to the deeper docs and don't repeat
  content.

### Phase 13.5 — per-package READMEs (1-2 days)
- 18 packages. Most get small updates; some get rewrites where
  the package's role changed (workflow, connector-sdk →
  module-sdk, etc.).

### Phase 13.6 — examples (2 days)
- `quickstart`, `connector`, `capability`, `hybrid`. Each is a
  working app with its own README and `pnpm dev` flow.

### Phase 13.7 — diagrams (1 day)
- Draft the three architecture SVGs; review with the team;
  finalize.

### Phase 13.8 — INDEX.md + CONTRIBUTING.md + housekeeping (0.5 day)
- Nav doc, contribution guide, archive v1 blocker docs to
  `docs/blockers/done/v1/`.

### Phase 13.9 — review pass (1 day)
- Read every doc end-to-end. Find dead links, stale references,
  v1-isms that snuck through. Fix.
- Run the "new contributor reads BUILD-A-MODULE.md and ships a
  working Module in <1 hour" test with at least one teammate.

**Total: ~12-15 working days.** This is non-trivial; doc work
is real engineering. Plan accordingly in cutover scheduling.

---

## 17. Definition of done

The doc rewrite is done when:

1. Every file in §3's target list exists and is current.
2. No file in the repo references v1-only concepts
   (`BlockHandler`, `ConnectorDefinition.actions`,
   `/api/agent/*`, `skillMarkdown()` as a TS function, etc.)
   except inside `MIGRATION-V1-TO-V2.md` where the comparison
   is the point.
3. `BUILD-A-MODULE.md` produces a working CRM Module when
   followed step-by-step. Verified by at least one new reader.
4. `examples/quickstart/` boots with `pnpm install && pnpm dev`
   and an agent run completes successfully against it.
5. Every package's README links into MODULES.md or
   BUILD-A-MODULE.md instead of duplicating content.
6. The architecture diagrams are accurate to the v2 code shape
   (no stale boxes, no missing layers).
7. `docs/INDEX.md` lists every doc; no orphans.
8. The rebuild parity matrix (task_12 §1b) is referenced from
   MIGRATION-V1-TO-V2.md.
9. CHANGELOG.md has a v2.0.0 entry summarizing the architectural
   shift.
10. The repo's GitHub landing page (rendered README + sidebar)
    reads coherently to a first-time visitor.

---

## 18. Risks

- **Drift mid-rewrite.** Reference docs ship before the guide;
  the guide ships before READMEs. If the implementation changes
  during the rewrite, references go stale. Mitigate by writing
  docs in this order *only after* the relevant code is on the
  v2 branch.
- **CRM example becomes too elaborate.** The guide is supposed to
  teach Module authoring, not be a full CRM tutorial. Cap the
  CRM in `examples/hybrid/` at ~400 lines of code; if it grows,
  factor pieces into separate examples.
- **Doc maintenance burden.** Eight reference docs + per-package
  READMEs + examples is a lot to keep in sync. Mitigate with:
  doc-as-test (the prompt snapshot test verifies SKILL.md
  examples; the build-guide-as-example symlink prevents drift in
  the CRM walk-through).
- **Architecture diagrams age fast.** Tie diagram SVGs to
  CHANGELOG entries — every major architectural change updates
  both.

---

## 19. What this task does NOT include

- Writing a full v2 user manual (operations, deployment, scaling).
  That's a separate effort; the rebuild ships with build / dev
  docs only.
- Marketing copy, landing pages, blog posts. Those live outside
  this repo.
- Translating docs. English only in v2.
- A docs site framework (Docusaurus, Mintlify, etc.). Markdown
  on GitHub is enough for v2; a hosted docs site is a future
  effort.

---

## TL;DR

Eight reference docs (README, CLAUDE.md, MODULES.md, TOOLS.md,
SKILLS.md, MIGRATION-V1-TO-V2.md, BUILD-A-MODULE.md,
CONTRIBUTING.md), 18 per-package READMEs, four runnable examples,
three architecture diagrams. The build-a-Module guide uses CRM as
the canonical example throughout, exercising every Module
dimension. ~12-15 days of writing, slotted into task_12's Phase 11.

The guide is the test: if a new contributor can't ship a CRM in
under an hour by reading it, the abstraction isn't teachable, and
the rebuild isn't done.
