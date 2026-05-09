# Blocker — Admin settings UI for routines, workflows, and operational controls

> **Status (2026-05-09): mostly delivered.** This doc was the v1 plan
> for surfacing every operational lever in the shell. Most of it
> shipped. Use this header table to find where each section lives now;
> the residual is tracked in [`task_16_shell_information_architecture.md`](task_16_shell_information_architecture.md)
> and [`task_17_tenant_settings_manifest.md`](task_17_tenant_settings_manifest.md).
>
> | Section | Status | Lives in |
> |---|---|---|
> | 1. Routines | ✅ Done | `packages/@boringos/shell/src/screens/Settings/RoutinesPanel.tsx` (CRUD + cron + run-now) — slated to move out of Settings into top-level under the new EXTEND group, see task_16 |
> | 2. Workflows | ✅ Done | `packages/@boringos/shell/src/screens/Workflows/` — full Canvas/Editor/Palette/Inspector/RunDrawer/SSE built locally |
> | 3. Budgets | ✅ Done | `packages/@boringos/shell/src/screens/Settings/BudgetsPanel.tsx` (policies + incidents) — also moves out of Settings |
> | 4. Agents (operational) | ✅ Done | Global pause: `Settings/AgentsPanel.tsx`. Per-agent surface (instructions, skills, runs, hierarchy, pause/wake) shipped via [`task_15_agents_screen_polish.md`](task_15_agents_screen_polish.md) |
> | 5. Connectors (extended) | ✅ Done | `screens/Connectors/` — Reconnect, lastSync, scope display, disconnect |
> | 6. Tenant settings manifest (`app.setting()`) | ⏳ Open | Tracked in [`task_17_tenant_settings_manifest.md`](task_17_tenant_settings_manifest.md) — SDK + schema-driven inputs |
> | 7. Team | ✅ Done | `screens/Team/` (built under task_16 phase 2) |
> | Architecture: admin-route gate | ✅ Done | `<RequireAdmin>` component in `auth/RequireAdmin.tsx`, wraps admin routes in `App.tsx` (task_16 phase 1) |
> | Architecture: Realtime SSE on routines/workflows | ⏳ Partial | Workflows screen has it; routines list still polls. Tracked in `task_15_agents_screen_polish.md` §8 |
>
> **The original plan below is preserved unchanged for historical
> context** — useful to read alongside the implementations to see
> which design choices held up.

---

## Why now

Every operational lever in BoringOS today is reachable only via API
or direct DB:

- Cron routines (Gmail sync, future Calendar sync, custom syncs) —
  `POST /api/admin/routines`, no UI.
- Workflows — there's a `@boringos/workflow-ui` package with a DAG
  canvas, but it's not mounted anywhere in the shell.
- Budgets — admin API exists; no UI.
- Agent global pause — toggleable via `PATCH /api/admin/settings`
  with `{ agents_paused: "true" }`; no UI.
- Per-agent pause / runtime model selection — admin API only.
- Tenant-level key/value settings (replier slot-proposal opt-in,
  etc.) — admin API only.
- Connectors — partial UI in place (Connect / Disconnect), no
  scope inspection or reconnect path.
- Team management (invite, list, change role, remove) — admin API
  only.

Hebbs targets non-technical users. Anyone who can't `curl` is
locked out of operating the system. This is a blocker on real
adoption — even one paid pilot user will hit "how do I pause an
agent / change the sync interval / kick off a one-off run" within
the first hour.

## Scope

A new `/settings` route in the shell with a left-rail navigation
across these sections. Each section is independently shippable.

### 1. Routines (cron)

`/settings/routines`

- **List view:** every active routine for the tenant. Columns:
  title, target (agent name or workflow name), cron expression
  (humanized: "Every 15 minutes"), last triggered (relative time),
  next fire (computed locally), status (active / paused / failing).
- **Row actions:** Run now, Pause, Edit, Delete (with confirm).
- **Create form:** title, target picker (agent or workflow),
  cron-expression input with a humanized preview ("This will run
  every Monday at 9 AM"), timezone dropdown, concurrency policy
  (skip-if-active / coalesce / allow-concurrent).
- **History:** last 20 fires with timestamp, outcome, and link to
  the resulting agent run / workflow run.

### 2. Workflows

`/settings/workflows`

- **List view:** all workflow definitions for the tenant. Columns:
  name, type (system / user-defined), trigger (event / cron /
  manual), block count, last-run status.
- **Detail view:** mount `@boringos/workflow-ui`'s `WorkflowCanvas`
  in `mode="view"` for live runs and `mode="edit"` for definition
  editing. Use `BlockPalette` + `BlockConfigForm` from the same
  package — they exist, just unmounted.
- **Run history:** list of `workflow_runs` for the workflow with
  status + duration. Click → `RunDiffView` (already in the package).
- **Replay:** trigger a re-run with the same input payload.

### 3. Budgets

`/settings/budgets`

- **Spend overview:** current month total, broken down per agent.
  Pull from `cost_events` aggregated by `agent_runs.agent_id`.
- **Policies list:** scope (tenant / agent), period
  (daily / weekly / monthly), limit, warn threshold, current spend.
- **Create policy:** form mapping to `POST /api/admin/budgets`.
- **Incidents log:** last 50 hard-stops + warnings from
  `budget_incidents`.

### 4. Agents (operational)

`/settings/agents`

- **Global pause toggle:** big switch at the top. Maps to
  `PATCH /api/admin/settings` with `agents_paused`.
- **Per-agent table:** name, status (idle / running / paused),
  current model, monthly spend, last run, runtime fallback.
- **Row actions:** Pause / Resume, Change model (dropdown of the
  agent's runtime's model catalog), View runs, Edit instructions.

### 5. Connectors (extended)

`/settings/connectors` — extends the existing Connectors screen.

- Show OAuth scopes in use, last sync timestamp, last error.
- Reconnect button (re-runs OAuth without disconnecting first —
  preserves history / IDs).
- Per-connector config (sync frequency override, label preferences
  e.g. snooze label name, etc.).

### 6. Tenant settings (key-value)

`/settings/tenant`

- Tenant name, default runtime, default model.
- App-specific opt-ins like `inbox.replier.proposeSlots` (see
  [`task_03`](task_03_calendar_schedule_from_inbox.md)).
- Schema-driven: read keys from `tenant_settings`, render generic
  string / boolean / select inputs based on a registered settings
  manifest. Apps register their own settings via a new
  `app.setting()` builder method.

### 7. Team

`/settings/team`

- Member list (existing admin API: `GET /api/auth/team`).
- Invite form → POST /api/auth/invite, copy invite link.
- Pending invitations list with revoke action.
- Per-member role change + remove.

## Architecture notes

- **Permissions:** every settings screen requires `role: admin`. The
  shell already has the role from `/api/auth/me` — gate the routes.
- **Realtime:** wire SSE so the routines list updates live when a
  routine fires, and the workflows list updates as block runs progress.
  The `@boringos/ui` SSE subscription already exists.
- **Cron-expression UX:** humanize via a small helper
  (`cronstrue` is the standard lib for this). Show next-fire-time
  client-side.
- **Settings manifest:** apps that register `tenant_settings` keys
  should declare them, so the UI knows the type, label, default, and
  visibility (per-tenant vs per-user). Add a `SettingDefinition`
  shape to `@boringos/app-sdk` and a `app.setting(...)` builder.

## Files in scope (not exhaustive)

- `packages/@boringos/shell/src/screens/Settings/` (new) — index
  page + per-section pages.
- `packages/@boringos/shell/src/lib/router.tsx` — `/settings/*`
  routes.
- `packages/@boringos/ui/src/client.ts` — wrapper methods for any
  admin endpoints not yet exposed (most exist; verify each).
- `packages/@boringos/workflow-ui/` — already done; just mount.
- `packages/@boringos/app-sdk/src/define-app.ts` — add
  `SettingDefinition` interface + `setting?: SettingDefinition[]`
  on `AppDefinition`.
- `packages/@boringos/core/src/admin-routes.ts` — verify each admin
  endpoint returns the data the UI needs (some may need richer
  joins, e.g., routines + last triggered run).

## Build order

1. **Routines** — biggest UX win, smallest new design surface.
2. **Agents (operational pause + runtime selection)** — also small,
   helps when something goes wrong.
3. **Tenant settings (with settings manifest)** — unlocks
   `task_03`'s replier opt-in and any future app config.
4. **Workflows** — bigger lift but the workflow-ui package is
   already built; mostly a mounting / styling pass.
5. **Budgets** — lower urgency; matters once spend is real.
6. **Connectors extended + Team** — nice-to-have polish around
   existing surfaces.

## Open questions

- **Where does this live in nav?** Top-level "Settings" sidebar
  entry, gated to admins. Non-admins see nothing under it.
- **Multi-tenant org switcher:** the user's tenant list is in
  `/api/auth/me`. If a user is admin in one tenant and member in
  another, settings must clearly indicate "you are managing
  $TENANT_NAME". Don't ship the org switcher and settings
  separately or roles will get confused.
- **Onboarding overlap:** there's an `onboardingState` table for a
  5-step wizard; the steps overlap with what /settings exposes.
  Decide: does onboarding deep-link into /settings sections, or
  duplicate the forms? Lean toward deep-linking with a small
  "review your setup" page.

## Why this is a blocker

Non-technical users can't use a system whose only operational
controls are HTTP endpoints. Every demo, every paid pilot, every
support call hits "where do I change X?" within minutes. Pausing
agents alone — when something goes wrong with a runaway loop —
needs to be a one-click action available without engineering
intervention.

Routines specifically are the most concrete pain: the Gmail sync
fires every 15 minutes whether you want it or not, and there's no
in-product way to dial it down or pause it during a sensitive
period (e.g., user is going on holiday and doesn't want a week of
auto-drafted replies sitting in their drafts when they return).
