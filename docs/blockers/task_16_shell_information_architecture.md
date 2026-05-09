# Blocker — task_16: Shell information architecture cleanup

> **Why now:** the shell shows the v1→v2 migration's seams to every
> user. Apps (sidebar) and Modules (Settings) are conceptually the
> same thing surfaced twice. Activity and Team are placeholder shells
> over fully-built backends. Admin-only screens (Workflows, Modules,
> Routines, Budgets) sit in "Tools" with inconsistent gates, so
> members open them and discover the line at the API 403. The cabinet
> rebuild ([`task_15`](task_15_agents_screen_polish.md)) made the agent
> surface usable, but it sits inside an IA that confuses operators
> before they ever click a card.
>
> This doc supersedes [`task_04`](task_04_admin_settings_cron_workflow.md),
> which planned a centralised /settings hub. The hub got built; this
> doc is the cleanup pass that distributes its surfaces correctly and
> closes the two residuals (Team UI, admin gating).

> **Depends on:** none for the UI moves. Backend already serves
> everything we need (see §0). The Apps↔Modules collapse points at
> [`task_12`](task_12_greenfield_rebuild.md)'s "ONE component shape"
> goal but does not require waiting for v1 cutover.

---

## 0. What's already there (don't rebuild this)

Backend inventory before we discuss UI changes — all wired today:

| Surface | Endpoints | Status |
|---|---|---|
| Team list / role / removal | `GET /api/admin/team`, `PATCH /team/:userId/role`, `DELETE /team/:userId` | Wired (`packages/@boringos/core/src/auth-routes.ts:349-410`) |
| Invitations | `POST/GET/DELETE /api/admin/invitations` | Wired (`auth-routes.ts:270-345`) |
| Activity log | `GET /api/admin/activity` returns `activity_log` rows for tenant | Wired (`admin-routes.ts:1165-1170`) |
| v2 modules + installs | `GET /api/admin/v2/modules`, `/installs`, `POST /v2/modules/:id/{install,uninstall}` | Wired (`v2-admin-routes.ts:46-97`) |
| v1 apps install | `installApi` against `tenant_apps` | Wired (`@boringos/control-plane`) |
| Admin gating | `requireAdmin(c)` covers ~25 routes | Backend rigorous; UI inconsistent |

Settings panels already built locally (per task_04 cleanup):
`Settings/RoutinesPanel.tsx`, `BudgetsPanel.tsx`, `AgentsPanel.tsx`,
`V2ModulesPanel.tsx`, plus the full `screens/Workflows/` editor with
its own Canvas/Editor/Palette/Inspector/RunDrawer/SSE.

**Roles**: `admin / staff / member`. Today the UI mostly checks
`role === "admin"` only and ignores `staff`.

---

## 1. The four problems, named

### 1a. Apps and Modules are the same idea twice

- **Apps** (`/apps` sidebar, `screens/Apps/`): v1 install pipeline.
  `tenant_apps` table, `installApi.ts`, marketplace tabs (Browse /
  Installed / Updates / Install from URL). Apps register slot
  contributions (sidebar pages, settings panels).
- **Modules** (Settings → Modules, `screens/Settings/V2ModulesPanel.tsx`):
  v2 architecture per task_12. The intended single shape: connectors,
  apps, plugins, built-in subsystems are *all* Modules.

task_12 says explicitly: "ONE component shape." Apps will collapse
into Modules at v1 cutover. Until then, both surfaces are visible
to the user with no signposting that they overlap.

### 1b. Sidebar groups don't match permission boundaries

Current sidebar (`shell/src/chrome/Sidebar.tsx:32-49`):

```
WORKSPACE: Home, Copilot, Inbox, Calendar, Tasks
TOOLS:     Agents, Workflows, Drive, Connectors, Apps
ADMIN:     Activity, Team, Settings
```

- TOOLS mixes audiences (Workflows admin-only; Agents read-for-all,
  edit-admin; Drive everyone; Connectors mixed; Apps admin).
- ADMIN contains Activity, which is read-for-most-orgs.
- Routines and Budgets live as Settings tabs but are operational
  controls, not configuration. Operators look for them in TOOLS,
  not Settings.

### 1c. Admin gating is partial in the UI

Backend gating is rigorous. UI gating is per-screen and inconsistent:

| Screen | UI admin gate |
|---|---|
| Workflows | ✅ inline (`user?.role === "admin"`) |
| Settings | ✅ per-tab filter |
| Agents | ❌ none |
| Connectors | ❌ none |
| Apps | ❌ none |

Members can navigate to admin URLs directly, click buttons, and only
learn it's gated when an API call 403s. Promote the Workflows pattern
to the router.

### 1d. Activity and Team are placeholder shells

`shell/src/App.tsx:89-90`:

```tsx
<Route path="activity" element={<PlaceholderScreen title="Activity" />} />
<Route path="team"     element={<PlaceholderScreen title="Team" />} />
```

Both backends are fully built (see §0).

---

## 2. Proposed architecture

### 2a. Reshape the sidebar around audience

```
WORK            everyone — daily driver
  Home, Copilot, Inbox, Calendar, Tasks, Drive

CABINET         everyone (read), admin (edit)
  Agents, Workflows

EXTEND          admin only — hidden for members
  Apps, Connectors, Routines, Budgets

ADMIN           admin only
  Team, Activity, Settings
```

App-contributed nav (`useSlot("pages")`) renders inside its own
INSTALLED group between WORK and CABINET.

### 2b. `<RequireAdmin>` route guard

```tsx
// packages/@boringos/shell/src/auth/RequireAdmin.tsx
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "admin") {
    return <ScreenBody><EmptyState title="Admin only" ... /></ScreenBody>;
  }
  return <>{children}</>;
}
```

Wrap admin-only routes at `App.tsx`. Remove the inline check from
`screens/Workflows/index.tsx:96-97`. Agents stays unwrapped — read
for all, per-action gating via `<AdminOnlyButton>` inside the panel.

### 2c. Collapse Apps and Modules

Add Modules as a tab inside the Apps screen. Drop the Modules tab
from Settings. Long term Apps grows to one tabbed installer:
Browse · Installed · Modules · Updates · Install-from-URL.

### 2d. Build Activity and Team

#### Team
Members table (name/email/role/joined, role dropdown, remove btn).
Invitations panel below (list + revoke + Invite modal). Uses
existing endpoints. ~1 day.

#### Activity
Chronological feed of `activity_log` rows. Filters by actor / kind.
~1 day.

### 2e. Shrink Settings

Move Routines + Budgets from Settings tabs to top-level routes under
EXTEND. Settings collapses to General + Branding + app-contributed
panels. V2 inspection panels (Tools / Tool calls / Workflow palette)
either move into Apps "Capabilities" sub-tab or a separate
`/capabilities` admin screen.

---

## 3. Phased execution

### Phase 1 — gating + sidebar (½ day)
Add `<RequireAdmin>`, reshape sidebar groups, wrap admin routes,
remove inline check from Workflows.

### Phase 2 — Team (1 day)
Add ui-client methods + hooks, build `screens/Team/`, replace
placeholder route.

### Phase 3 — Activity (1 day)
Add ui-client method + hook, build `screens/Activity/`, replace
placeholder route.

### Phase 4 — Apps + Modules collapse (1 day)
Move `V2ModulesPanel` → `screens/Apps/Modules.tsx`. Add Modules tab
to Apps. Drop Modules tab from Settings. Decide where Tools /
ToolCalls / WorkflowPalette panels live.

### Phase 5 — Settings shrink (½ day)
Move Routines and Budgets out of Settings to top-level routes.
Settings → General + Branding + app-contributed panels.

---

## 4. What this doc deliberately doesn't decide

- **Whether `staff` gets a third permission tier in the UI.**
- **App-contributed sidebar entries placement.** Try INSTALLED
  group first.
- **`/capabilities` screen vs Apps sub-tab** for Tools / ToolCalls /
  WorkflowPalette panels.
- **Tenant settings manifest** (the `app.setting()` builder from
  task_04 §6) — separate work, tracked in
  [`task_17_tenant_settings_manifest.md`](task_17_tenant_settings_manifest.md).
- **Renaming `agents.skills` → `agents.routingTags`** — separate
  cleanup, tracked in `task_15` §1.

---

## 5. Pointers to consult while executing

- Sidebar today: `packages/@boringos/shell/src/chrome/Sidebar.tsx`
- Routes table: `packages/@boringos/shell/src/App.tsx`
- Existing admin-gate pattern to copy: `screens/Workflows/index.tsx:96-97`
- Apps screen: `screens/Apps/index.tsx`
- v2 modules panel: `screens/Settings/V2ModulesPanel.tsx`
- Team backend: `packages/@boringos/core/src/auth-routes.ts:347-410`
- Invitations backend: `auth-routes.ts:270-345`
- Activity backend: `admin-routes.ts:1165-1170`
- Auth user shape: `packages/@boringos/shell/src/auth/AuthProvider.tsx`
  (`user.role` is `"admin" | "staff" | "member"`)
- v2 north star: `task_12_greenfield_rebuild.md`
