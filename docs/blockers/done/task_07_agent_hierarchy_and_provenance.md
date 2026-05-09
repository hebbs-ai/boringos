# Blocker — Agent hierarchy is dormant and agents have no provenance

## Why now

The framework ships with most of the hierarchy machinery already built —
`reportsTo` on agents, `buildOrgTree`, `findDelegateForTask`,
`escalateToManager`, the `hierarchy` system-prompt provider,
`BUILT_IN_TEAMS` templates. Phase 19 tests prove every piece works in
isolation.

But on a real tenant, **none of it fires**:

- Tenant provisioning seeds a single Copilot with `reportsTo` unset.
  `packages/@boringos/core/src/boringos.ts` calls
  `createAgentFromTemplate(db, "copilot", ...)` and never wires a
  parent.
- The `hierarchy` context provider checks the agent: no boss, no peers,
  no reports → returns `null`. The entire `## Hierarchy` section drops
  out of the prompt.
- Apps that hook `onTenantCreated(db, tenantId)` to register their own
  agents have nothing to point `reportsTo` at, so they create more
  orphans. Every tenant ends up as a flat forest of disconnected
  roots.
- The framework universally injects a "Chief of Staff" task-discipline
  prompt block on every agent, but **no actual Chief of Staff agent
  exists** to back it. The mental model in the prompts and the data
  model on disk disagree.

Provenance is the second half of the same blocker. The `agents` table
has no column that says "this agent came from the shell" vs "the user
made this" vs "the CRM app installed this":

- `agents.type` exists (text default `'user'`) but is dead — only ever
  holds `'user'`.
- `agents.role` is functional, not provenance — the CRM's `email-lens`
  role and a hand-rolled `email-lens` agent are indistinguishable.
- `agents.metadata` is jsonb with no contract. Hebbs sets
  `{ ownerUserId }`; CRM sets nothing. Querying it at scale needs
  jsonb predicates and is easy to get wrong.

Consequences that ship today:

- App install/uninstall is unsafe. There's no query that returns
  "agents owned by app X" — uninstall would either nuke the wrong rows
  or leak rows forever.
- The shell has no way to render "your team" vs "system" vs "from CRM".
- Delete-protection on framework primitives (Copilot, future CoS) has
  nothing to gate on except hardcoded role checks.
- `hierarchy.peers` already caps at 10; once the tree is real we have
  no signal about which peers matter, so the cap silently truncates.

This blocks every direction we're trying to take next:
- The plugin / app-install architecture (apps can't be cleanly
  installed or uninstalled without provenance).
- Skill-based delegation (no real tree to route in).
- The Coworker UI in `hebbs-os` (currently prints `"— (direct to
  founder)"` as a fallback string for null parents).
- Standardising CRM as an app on top of the framework rather than a
  parallel host.

## Scope

This is a framework-level change. It lands in `boringos-framework` and
becomes available to every consumer (`hebbs-os`, `boringos-crm`,
`examples/quickstart`, future apps) without those consumers needing to
re-implement anything.

### 1. Provenance columns on `agents`

`packages/@boringos/db/src/schema/agents.ts`

- New column `source TEXT` with `CHECK (source IN ('shell','user','app'))`
  — required after backfill.
- New column `source_app_id TEXT` — required when `source = 'app'`,
  null otherwise. Enforced by
  `CHECK ((source = 'app') = (source_app_id IS NOT NULL))`.
- Drop the dead `type` column in the same migration. It's never read
  anywhere meaningful.
- Indexes: `(tenant_id, source)`, `(tenant_id, source_app_id)`.

`source` taxonomy:
- `shell` — framework primitives (Copilot, CoS) seeded by tenant
  provisioning. Non-deletable, non-reparentable, owned by the
  framework.
- `app` — agents declared by an installed app/plugin manifest.
  Lifecycle tied to the app — uninstall removes them.
- `user` — anything a human user creates through the admin API or a
  shell UI. Default for `POST /api/admin/agents` if no source given.

### 2. Tenant root pointer

`packages/@boringos/db/src/schema/tenants.ts`

- New column `root_agent_id UUID REFERENCES agents(id)` — required
  after backfill.
- Partial unique index on `agents (tenant_id) WHERE reports_to IS NULL`
  — enforces "exactly one agent per tenant has no parent." That agent
  must be the CoS.
- Service-layer assertion: `tenants.root_agent_id` always equals the
  unique null-parent agent for that tenant. (Trigger optional; engine
  guard is sufficient if all writes go through the framework.)

### 3. Chief of Staff persona + tenant seeding

A new `chief-of-staff` persona joins the existing 12 in
`packages/@boringos/agent/src/personas/`. Distinct role, default skills
(`routing`, `escalation`, `status`, `delegation`), persona instructions
framing the agent as the org's coordinator.

The universal "Chief of Staff task discipline" prompt block stays on
**every** agent — it's about task hygiene (commits, critique, follow-
through), not role identity. The CoS persona stacks an additional
"you *are* the Chief of Staff" block on top.

Tenant provisioning in `packages/@boringos/core/src/boringos.ts`
becomes:

1. Create the CoS agent first: `source='shell'`, `reportsTo=null`,
   role=`chief-of-staff`. Call this the **tenant root**.
2. Set `tenants.root_agent_id = cos.id`.
3. Create the Copilot: `source='shell'`, `reportsTo=cos.id`,
   role=`copilot`.
4. Fire `onTenantCreated(db, tenantId, ctx)` where `ctx` exposes
   `rootAgentId`. Apps now have a parent to point to.

The 6 framework runtimes still get auto-seeded as before — runtimes are
unaffected by this work.

### 4. App-install path writes provenance

`packages/@boringos/core/src/admin-routes.ts` — `POST /agents` already
exists. Add:
- Optional `source` + `sourceAppId` in the request body. Default
  `source='user'` if omitted. Reject `source='shell'` from external
  callers (only the engine seeds shell agents).
- Default `reportsTo = tenant.rootAgentId` if not provided.

For the plugin system (`PluginDefinition` in `@boringos/core` — see
PLUGINS.md):
- Plugin manifests gain an `agents?: AgentDeclaration[]` field:
  `{ name, role, persona?, skills?, instructions? }`. No `reportsTo`,
  no `source` — apps don't own structure.
- Plugin loader, on install, creates each declared agent with
  `source='app'`, `sourceAppId=<plugin.name>`, `reportsTo=tenant.root_agent_id`.
- Plugin loader, on uninstall, runs
  `DELETE FROM agents WHERE tenant_id=? AND source_app_id=?`. Tasks
  assigned to those agents get reassigned to CoS or closed per
  uninstall policy (default: reassign).

This is the path `boringos-crm` will use once it's restructured as a
plugin. Until then, its standalone provisioning stays as-is — but new
apps written against the framework get clean lifecycle for free.

### 5. Reparenting + delete invariants

Service-layer guards on `PATCH /api/admin/agents/:id` and
`DELETE /api/admin/agents/:id`:

- `source='shell'` agents cannot be deleted at all.
- `source='shell'` agents cannot be reparented (CoS is structural; the
  Copilot's parent can theoretically change, but the default is to
  lock it to CoS).
- Reparenting rejects: cycles, descendant-as-parent, self-as-parent,
  shell-agents-as-children, the agent's own subtree as the new
  parent.
- The cycle/descendant logic already lives in
  `boringos-crm/packages/web/src/pages/Agents.tsx`. Lift it into a
  shared util in `@boringos/agent` so both the framework admin API
  and any UI consumer can call it.

### 6. Hierarchy provider behaviour with real data

`packages/@boringos/agent/src/providers/hierarchy.ts` — currently
returns `null` when there's nothing to say. Once tenants always have
a tree, it always returns content. Two cleanups:

- The CoS itself sees direct reports (and skip-level if the tree
  grows). Verify the "you are top-level" branch reads naturally for
  the CoS specifically, since it's now the only legitimate top-level
  agent.
- The peers cap (10) and skip-level cap (8) become real once tenants
  scale past trivial. Add role-bucketed summarisation when the cap
  would otherwise truncate ("12 peers: 5 sales agents, 4 research
  agents, 3 ops agents") rather than dropping arbitrary names.

### 7. Wire delegation (mechanism, not policy)

`findDelegateForTask` and `escalateToManager` are implemented and
tested but have no callers. With a real tree, wire them:

- When an agent creates a task it can't handle, give it a
  `escalate-to-boss` callback path. Routes to `agent.reports_to`,
  which now exists.
- When the CoS is woken with an unassigned task, give it a
  `find-delegate` callback that uses `findDelegateForTask` to pick a
  report by skill match.

Routing *policy* (which heuristic, what scoring) is out of scope —
ship the mechanism, default to the existing role-based heuristic, and
revisit policy as its own task once we have real tenants exercising
it.

### 8. Migration

One-shot per environment. Roll-forward only.

1. Add `agents.source`, `agents.source_app_id`, `tenants.root_agent_id`
   nullable. Deploy schema. No behaviour change yet.
2. Backfill script (idempotent, per tenant):
   - If `tenants.root_agent_id` null: create CoS (`source='shell'`,
     `reports_to=null`, role=`chief-of-staff`); set
     `tenants.root_agent_id = cos.id`.
   - For each existing agent without `source`, assign by role
     heuristic:
     - `role IN ('copilot','chief-of-staff')` → `source='shell'`
     - `role IN ('email-lens','enrichment-contact',
       'enrichment-company','deal-analyst','followup-writer',
       'meeting-prep')` → `source='app', source_app_id='crm'`
     - `role IN <built-in team roles>` → `source='shell'` if seeded by
       framework template, else `source='user'`
     - everything else → `source='user'`
   - For each agent with `reports_to=null` that isn't the CoS: set
     `reports_to = tenants.root_agent_id`.
3. Verify invariants (script outputs counts):
   - exactly one root per tenant
   - all `reports_to` resolvable (no dangling FKs)
   - no `source IS NULL`
   - all `source='app'` rows have `source_app_id`
4. Apply constraints: `NOT NULL` on `source`,
   `tenants.root_agent_id`; partial unique index for one-root-per-
   tenant; CHECK for source/sourceAppId consistency.
5. Add the service-layer guards for delete/reparent.

Migration accepts manual cleanup for ambiguous cases — agents whose
heuristic landed `source='user'` but were actually app-created
predating `source_app_id` get a doc note and a manual fix-up SQL
template. Don't try to be clever inferring beyond the role table.

## Architecture notes

- **Layering.** The schema, persona, hierarchy provider, and
  tenant-create lifecycle all live in `boringos-framework`. Consumers
  (`hebbs-os`, `boringos-crm` standalone, future apps via plugin
  manifest) inherit the behaviour without each re-implementing CoS
  seeding. This is the same pattern as runtimes and Copilot — seeded
  once in the framework, available everywhere.
- **`onTenantCreated` contract change.** Today it's
  `(db, tenantId) => Promise<void>`. Add a third arg: a context
  object exposing `rootAgentId` (and reserve room for future fields).
  Existing hooks accepting two args keep working — the third is
  optional.
- **Why not put `source` in `metadata`.** We already have
  `metadata.ownerUserId` precedent, but provenance is a primary query
  key (`WHERE source_app_id = ?` runs on every uninstall, every "your
  team" filter). jsonb indexes are noisier and easier to misuse than
  a typed column. This is foundational data — it deserves a column.
- **Why one CoS per tenant, not per app.** Hierarchy invariants stay
  cheap when there's a single tenant root. Multi-CoS becomes a real
  question only at large org scale, and the partial unique index
  makes that future change explicit and intentional rather than
  accidental.
- **Hidden vs visible CoS.** CoS is addressable via the admin API and
  appears in `buildOrgTree`. Whether it shows up in the chat list or
  Coworker tree is a consumer-side decision — `hebbs-os` and
  `boringos-crm` can each pick. The framework just guarantees the
  agent exists.

## Files in scope (not exhaustive)

- `packages/@boringos/db/src/schema/agents.ts` — add `source`,
  `source_app_id`; drop `type`; new indexes.
- `packages/@boringos/db/src/schema/tenants.ts` — add
  `root_agent_id`.
- `packages/@boringos/db/src/migrations/` — schema migration +
  backfill script.
- `packages/@boringos/agent/src/personas/chief-of-staff/` (new) —
  persona bundle (markdown files, persona resolver entry).
- `packages/@boringos/agent/src/templates.ts` — register
  `chief-of-staff` role; ensure `createAgentFromTemplate(db,
  "chief-of-staff", ...)` works.
- `packages/@boringos/agent/src/providers/hierarchy.ts` — verify CoS
  branch reads naturally; add role-bucketed peer summarisation when
  caps would truncate.
- `packages/@boringos/agent/src/hierarchy/reparent.ts` (new or
  lifted) — shared cycle/descendant validator.
- `packages/@boringos/core/src/boringos.ts` — tenant provisioning:
  CoS first → set `root_agent_id` → Copilot under CoS → fire
  `onTenantCreated(db, tenantId, ctx)`.
- `packages/@boringos/core/src/admin-routes.ts` —
  `POST /agents` accepts `source`, `sourceAppId`, defaults `reportsTo`
  to tenant root; service-layer guards on `PATCH`/`DELETE`.
- `packages/@boringos/core/src/plugins.ts` (or wherever
  PluginDefinition lives) — `agents?: AgentDeclaration[]` on plugin
  manifest; loader writes rows on install, deletes on uninstall.
- `tests/phase19-hierarchy.test.ts` — extend with the new
  invariants, lifecycle tests, prompt-assembly tests.
- `tests/phase21-provenance.test.ts` (new) — provenance + plugin
  install/uninstall + migration idempotency.

## Build order

1. **Schema + persona + tenant seeding** — the foundation. Tenant
   provisioning produces a real tree; hierarchy provider stops
   silently no-op'ing.
2. **Migration script + backfill** — make existing environments
   safe before we lock the constraints.
3. **Constraints + service-layer guards** — enforce the invariants
   we just spent the migration earning.
4. **Admin API provenance + plugin manifest agents** — apps can now
   install/uninstall cleanly.
5. **Wire delegation mechanism** — `escalate-to-boss` and
   `find-delegate` callback paths land. Routing policy stays default
   (role heuristic).
6. **Provider polish** — role-bucketed peer summarisation when caps
   would truncate.

Steps 1–3 are the blocker. Steps 4–6 are the immediate follow-on that
makes the foundation useful.

## Out of scope (deliberately separate work)

- **Skill-based routing policy.** The mechanism (escalate up, route
  down) ships here. The scoring/heuristic for "which report should
  CoS pick for this task" earns its own task with an evaluation
  harness once we have tenants exercising it.
- **Multiple CoS per tenant** for very large orgs. Single root is
  correct for solo-operator and small-team scope. The partial unique
  index makes a future change explicit if it ever lands.
- **Cross-tenant agent borrowing** (shared agent pools). Different
  layer of architecture; do not entangle.
- **A "user" pseudo-node** in the tree. CoS reports to null; the
  human sits outside the graph. Multi-human tenants may eventually
  want a shared root above CoS — handle when it's real demand.
- **Public marketplace** for plugins. This task makes plugin
  install/uninstall safe and clean; the marketplace itself is
  separate.

## Open questions

- **CoS visibility in consumer UIs.** Framework guarantees CoS exists
  and is addressable. `hebbs-os` and `boringos-crm` each decide
  whether it shows in the chat list or only the Coworker tree. Lean:
  hidden from chat in v1, visible in tree, addressable via API.
- **CoS customisation.** Display name editable; role identity
  (`chief-of-staff`) and source (`shell`) locked. Confirm.
- **Default parent for user-created agents.** CoS or the tenant's
  Copilot? Lean: CoS, with Copilot offered as an explicit option in
  the picker. Reporting to Copilot turns it into a manager — a
  design statement worth doing on purpose, not by default.
- **Plugin uninstall task policy.** When an app's agents are deleted,
  what happens to their tasks? Reassign to CoS (default), close as
  cancelled, or escalate via `onUninstall` hook? Lean: reassign to
  CoS, log an activity entry per task; let the plugin override via a
  `tasks` policy on the manifest.
- **Backfill safety on hot environments.** The migration is
  idempotent and roll-forward only, but adding the partial unique
  index can race if a writer creates a second null-parent agent
  mid-backfill. Plan: take a write lock on `agents` for the tenant
  during step 4, or do step 4 as a series of per-tenant
  transactions. Decide before running on prod.
- **Peer cap summarisation rendering.** Where in the prompt does the
  bucket summary go — replacing the truncated list, or in addition
  to a smaller subset of named peers? Specify before implementing.

## Why this is a blocker

The hierarchy machinery exists and the tests pass, but the runtime
behaviour is "every tenant looks like an empty room" — no boss, no
peers, no coordinator. Every prompt that's supposed to give an agent
org context drops the entire section. Every app that wants to install
is a forest of orphans. Every consumer UI that wants to render "your
team" has nothing to query against.

Until this lands:
- The plugin architecture can't safely uninstall — work on
  `task_02_plugin-architecture.md` (consumer side) is gated.
- CRM-as-plugin can't materialise — `boringos-crm` keeps being its
  own host instead of an installable app.
- Skill-based delegation has no tree to route in.
- The shell can't render meaningful org views and falls back to flat
  lists with placeholder strings.
- Future apps would each invent their own "where do my agents go"
  convention and we'd be migrating data forever.

This is foundational. Worth doing properly, once, in the framework —
no shortcuts, no `metadata.source` conventions, no "we'll add the
column later." Schema, persona, lifecycle, migration, invariants —
all together.
