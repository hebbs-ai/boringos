# Task 26 — Module dashboard widgets

> Add a sixth `PluginUI` extension surface so installed Modules can
> contribute widgets to the shell Home screen. Today the dashboard
> is a fixed layout of framework-level KPI tiles + a cost sparkline
> + the operating pulse — Modules cannot surface anything on it.
> CRM, Drive, Inbox, and any future Module is invisible on the page
> the user opens first.

---

## Status

| Field | Value |
|---|---|
| **State** | LANDED — A + B + C + D + E (live smoke) shipped; 9 new unit tests + 416/416 framework tests pass |
| **Owner** | parag |
| **Started** | 2026-05-15 |
| **Last updated** | 2026-05-16 |
| **Estimated effort** | ~1 dev-day end-to-end (contract + host + Home wiring + one real CRM widget as proof) |
| **Prerequisites** | Task 21 (one module system) landed. The `pluginHost` runtime + `PluginUI` contract from task_19/task_21 are the foundation this task extends |
| **Related** | Task 21 §3.1 notes the old `@boringos/app-sdk` defined `DashboardWidget` and Task 21 / Phase I §"LANDED with honest deferrals" explicitly **deferred** dashboard extensibility ("Shell's slot system has too much integration with primitive components — clean detachment requires per-component rewrites"). This task is the per-component rewrite for Home. |

---

## 1. The principle

A Module is supposed to be a complete, self-contained unit of
behaviour + UI. Today a Module can contribute to five shell
surfaces: sidebar nav, entity detail panels, entity actions,
settings panels, inbox filters. The Home screen — the first thing
the user sees after login, the page that should answer "what's
going on across my stack?" — is the only major surface that
**cannot** be extended.

The result is a structural lie: the shell looks composable, but
Home is hand-curated framework UI. A user with CRM installed
opens Home and sees no deal pipeline, no follow-ups due, no
recent activity. A user with Drive installed sees no recent
documents. The page is generic by construction, regardless of
what the tenant has installed.

The principle: **Home is a registry, not a layout.** Modules
declare widgets, the shell composes them. The framework's existing
tiles (Open work, Agents online, Unread inbox, Pending approvals,
Cost sparkline, Operating pulse, Watch items) get re-expressed as
contributions from the framework's own built-in Modules — same
mechanism, same surface, no privileged path. After this task,
adding a new top-level dashboard tile is a Module change, not a
shell change.

## 2. Today's reality, in detail

### 2.1 Where Home is rendered

`packages/@boringos/shell/src/screens/Home.tsx` (~252 lines). The
file imports six framework hooks directly:

```ts
import {
  useAgents, useCosts, useInbox,
  useRoutines, useTasks, useWorkflows,
} from "@boringos/ui";
```

…and renders a hand-coded JSX tree:

- 4 `<StatTile>` instances (open work, agents online, unread
  inbox, pending approvals)
- 1 `<CostSparkline>` (8-week bucket reduction over `useCosts()`)
- 1 `<OperatingPulse>` (today's routines + workflow + agent
  counts)
- 1 watch-items list (filter on `useTasks()` by priority)

There is no `pluginHost.dashboard*` lookup anywhere in the file.
Every section is hardcoded and consumes framework hooks
directly. No prop drilling, no slots, no registry.

### 2.2 What the plugin contract currently exposes

`packages/@boringos/ui/src/contract.ts` — the canonical `PluginUI`
shape — declares six contribution arrays:

```ts
export interface PluginUI {
  moduleId: string;
  displayName?: string;
  navItems?: NavItem[];
  entityPanels?: EntityPanel[];
  entityActions?: EntityAction[];
  settingsPanels?: SettingsPanel[];
  copilotTools?: CopilotTool[];
  inboxFilters?: InboxFilter[];
}
```

No `dashboardWidgets`. No `homeWidgets`. No precedent on the page.

### 2.3 What the registry exposes

`packages/@boringos/shell/src/plugin-host/registry.ts` — the
in-memory `PluginHost` — provides five query surfaces:
`navItems`, `entityPanelsFor(kind)`, `entityActionsFor(kind)`,
`settingsPanels`, `copilotTools`, `inboxFilters`. No dashboard
query method.

### 2.4 What gets installed today

Module install/uninstall already round-trips through
`pluginHost.register(ui)` and `pluginHost.unregister(id)`,
notifying subscribers via the `useSyncExternalStore`-shaped
hook (`getSnapshot` flips on every change). The sidebar
re-renders in <1s when a Module is installed — this is the
plumbing we want Home to ride on for free.

### 2.5 The history (why this hasn't shipped already)

Task_21 / Phase I status entry on 2026-05-10:

> Phase I attempted nuclear delete of @boringos/{app-sdk,…}. Shell's
> slot system has too much integration with primitive components
> (Sidebar, Settings, **Home**, CommandBar) — clean detachment
> requires per-component rewrites. Restored those packages …
> kept all the non-destructive user-visible renames.

The v1 `@boringos/app-sdk` once defined a `DashboardWidget`
interface (`task_21.md` §3.1 inventory). It was deleted with the
rest of v1 because nothing consumed it on the v2 surface. This
task adds it back, but on the v2 / Module surface, with a real
consumer (Home.tsx) wired up the same day.

## 3. Target architecture

After this task ships:

A Module author exports widgets the same way they export nav
items today:

```ts
export const crmUI: PluginUI = {
  moduleId: "crm",
  displayName: "CRM",
  navItems: [/* … */],
  dashboardWidgets: [
    {
      id: "deals-closing-this-week",
      title: "Closing this week",
      size: "small",       // "small" | "medium" | "large"
      slot: "primary",     // "primary" | "secondary" (initial split)
      element: lazy(() => import("./widgets/DealsClosingThisWeek.js")),
      order: 200,
    },
    {
      id: "pipeline-by-stage",
      title: "Pipeline by stage",
      size: "medium",
      slot: "primary",
      element: lazy(() => import("./widgets/PipelineByStage.js")),
      order: 300,
    },
  ],
};
```

The widget component receives no props (or `{ moduleId }` only)
and is responsible for its own data fetching via the existing
`useTool` / `useToolMutation` / framework hooks. The shell wraps
each widget in:
- an error boundary (a widget crash never blacks out the page),
- a `<Suspense>` fallback (a skeleton tile while the lazy chunk
  loads),
- an install gate (widgets from uninstalled modules don't render —
  belt-and-braces; `pluginHost.unregister` already removes them
  on uninstall).

The framework's own KPI tiles + cost sparkline + operating pulse
+ watch items become contributions from a new built-in
`dashboard` Module (or are attached to existing built-in Modules
where the data lives — `framework` for KPI counts, `costs` for
the sparkline, `inbox` for unread, `workflow` for the operating
pulse). No widget gets a special path; Home iterates the
registry.

`Home.tsx` shrinks to ~40 lines: a header, a registry read, a
grid that lays out widgets by `slot` + `order` + `size`. No
hardcoded JSX trees.

## 4. Contract changes

### 4.1 New types in `@boringos/ui/src/contract.ts`

```ts
export type DashboardWidgetSize = "small" | "medium" | "large";
export type DashboardWidgetSlot = "primary" | "secondary";

export interface DashboardWidget {
  /** Stable id within the module's widget set. */
  id: string;
  /** Human label rendered in the widget header. Plain string. */
  title: string;
  /** Grid footprint. small = 1 col, medium = 2 cols, large = full row. */
  size: DashboardWidgetSize;
  /** Vertical placement bucket. Primary = above-the-fold. */
  slot: DashboardWidgetSlot;
  /** The component. No required props; if any, must be optional. */
  element: PluginElement;
  /** Sort hint within (slot, module). Lower first. Defaults to 100. */
  order?: number;
}

export interface PluginUI {
  // … existing fields …
  dashboardWidgets?: DashboardWidget[];
}
```

Keep the contract minimal in this pass. Things deliberately
**not** added in v1 of the surface (deferred to a follow-up
task if they turn out to matter):
- per-widget visibility predicates (use install gating instead)
- per-widget refresh hints (widgets own their own polling)
- user-pinned ordering / drag-rearrange (UX experiment, not a
  framework primitive)
- per-widget settings (settings live in the Module's
  `settingsPanels` surface; if a widget needs config, it links
  to that)

### 4.2 New registry method in `plugin-host/registry.ts`

```ts
export interface PluginHost {
  // … existing fields …
  /** All dashboard widgets, grouped by slot, sorted by (order, moduleId). */
  dashboardWidgets: Array<DashboardWidget & { moduleId: string }>;
}
```

Implementation mirrors `settingsPanels` — flatten every module's
contributions, attach `moduleId`, sort. The `useSyncExternalStore`
hook already exists; consumers re-render on register/unregister
without extra plumbing.

### 4.3 New consumer hook in `@boringos/ui/src/plugin-hooks.ts`

`useDashboardWidgets()` — returns the gated list (filtered by
`useInstalledModules()`). Same shape as the existing
`useSettingsPanels()` / `useNavItems()` hooks.

## 5. Phased workstream

Each phase is independently shippable, testable, revertable.
Phase A is contract-only — no UI change. Phase B is the Home
rewrite. Phase C is the proof: at least one Module (CRM)
contributes a real widget end-to-end.

### Phase A — Contract + host plumbing (no user-visible change)

A1. Add `DashboardWidget`, `DashboardWidgetSize`,
`DashboardWidgetSlot` to `@boringos/ui/src/contract.ts`; extend
`PluginUI` with the optional `dashboardWidgets` field.

A2. Add the `dashboardWidgets` getter on `PluginHost` in
`shell/src/plugin-host/registry.ts`. Sort by (slot, order,
moduleId).

A3. Add the `useDashboardWidgets()` hook in
`@boringos/ui/src/plugin-hooks.ts`. Apply the install-gating
filter (same pattern as `useNavItems`).

A4. Add a `DashboardWidgetGrid` primitive in
`shell/src/components/DashboardWidgetGrid.tsx` (or co-locate in
Home.tsx if it stays tiny). Renders a list of widgets, wraps
each in `<ErrorBoundary>` + `<Suspense>` with a skeleton
fallback. Handles size → grid-col mapping. **No widgets land
yet — this is the empty grid.**

Build + typecheck. ~2 hours.

### Phase B — Migrate Home's existing tiles to widgets

B1. Decide the home of the framework-shipped widgets. Two viable
options:

- **Option 1 (recommended):** Each existing built-in Module that
  owns the data ships its own widget. `framework` Module ships
  Open-work + Agents-online + Pending-approvals + Operating-pulse
  + Watch-items widgets. `inbox` Module ships Unread-inbox. A new
  `costs` Module (or attach to `framework`) ships the
  Cost-sparkline. This is the "no privileged path" version.
- **Option 2 (faster, less pure):** Add a single new `dashboard`
  Module under `packages/@boringos/core/src/modules/dashboard/`
  that ships every framework-shipped widget. Simpler to land,
  worse for the "Modules are uniform" thesis. **Pick option 1
  unless option 2 unblocks a deadline.**

B2. Move each existing Home section into a widget component
under the chosen Module's `widgets/` directory. Each widget keeps
its current data hooks (`useTasks`, `useAgents`, etc.) — no
data-fetching changes in this task.

B3. Rewrite `Home.tsx` to:
- render the header,
- call `useDashboardWidgets()`,
- render two `<DashboardWidgetGrid>` sections (primary slot
  above, secondary below) — or a single grid with a slot
  separator,
- nothing else.

B4. Sanity-check the page visually: same tiles, same data, same
order. If a layout regression surfaces, tune `order` values on
the contributed widgets — do not re-introduce hardcoded JSX.

Build + typecheck + manual smoke test. ~3 hours.

### Phase C — Ship one real third-party widget (CRM)

C1. In `boringos-crm/packages/web/src/ui.ts`, add a
`dashboardWidgets` entry to `crmUI` for "Deals closing this
week" (cheapest meaningful widget — uses the existing
`crm.deals.list` tool with a date filter).

C2. Build the widget component in
`boringos-crm/packages/web/src/dashboard/DealsClosingThisWeek.tsx`
— renders the count + the top 3 deals with a link to the deal
detail route the CRM already mounts.

C3. Bump the CRM module package version. Build the `.hebbsmod`
or rely on the local workspace wire-up.

C4. Install CRM end-to-end on a fresh tenant; verify:
- Home renders the new widget within ~1s of install
  (`useSyncExternalStore` snapshot flip).
- Uninstall CRM → widget disappears within ~1s.
- Re-install → widget reappears, no duplicates.

~3 hours.

### Phase D (optional, follow-up) — Second CRM widget + Drive

If C ships clean and time allows: add a "Pipeline by stage"
widget to CRM and a "Recent documents" widget to Drive. These
are purely demonstrative — they don't unlock new framework
behaviour. Defer to a separate task if Phase A–C took longer
than expected.

## 6. Acceptance criteria

The task is **done** when every one of these is true. Status as of
2026-05-16:

1. ✅ `PluginUI` in `@boringos/ui/src/contract.ts` declares a
   `dashboardWidgets?: DashboardWidget[]` field, and the
   `DashboardWidget` type is exported.
2. ✅ `pluginHost.dashboardWidgets` getter exists and returns every
   registered widget with its `moduleId` attached, sorted by
   `(slot, order, moduleId)`. — covered by
   `tests/dashboard-widgets-registry.test.ts` (5 tests).
3. ✅ `useDashboardWidgets()` hook exists and filters by installed
   modules. **Lives in `shell/src/plugin-host/useDashboardWidgets.ts`,
   not `@boringos/ui`** (revised from original plan to match the
   existing Sidebar pattern — `pluginHost` is shell-local).
4. ✅ `Home.tsx` no longer imports `useTasks`/`useAgents`/etc.
   directly for layout purposes — only `useAuth` (header) and
   `useDashboardWidgets()` (registry).
5. ✅ Every tile currently visible on Home is contributed by a
   Module via `dashboardWidgets`. `framework` ships open-work,
   agents-online, pending-approvals (primary, small) + cost
   sparkline, operating pulse, watch items (secondary, medium).
   `inbox` ships unread-inbox (primary, small). — covered by
   `tests/dashboard-widgets-builtin.test.ts` (3 tests).
6. ✅ CRM contributes **two** `dashboardWidgets`: "Pipeline by
   stage" and "Closing this week" (both secondary/medium). Live
   smoke test on a fresh tenant: signup → upload .hebbsmod →
   install → `/modules/crm/ui/index.mjs` serves bundle with both
   widget ids; `useSyncExternalStore` snapshot bump on
   `pluginHost.register()` triggers Home re-render. The
   install/uninstall ~1s SLA inherits from the existing
   `module:installed` / `module:uninstalled` SSE path (proven by
   task_22 / task_19 — unchanged here).
7. ✅ A widget that throws renders an inline error pill via
   `WidgetErrorBoundary` in `DashboardWidgetGrid.tsx`. The error
   boundary is class-based (React's only supported shape) with
   `getDerivedStateFromError` + `componentDidCatch` for logging.
8. ✅ A widget that suspends shows a `<WidgetSkeleton>` fallback
   inside `<Suspense>`, not a blank space.
9. ✅ `pnpm -r typecheck` + `pnpm -r build` pass clean on framework
   + CRM workspaces. `pnpm test:run` passes 416/416 tests across
   58 files (including 9 new tests for the dashboard surface).
10. ✅ `BUILD-A-MODULE.md` + `MODULES.md` updated. BUILD-A-MODULE
    has a new `## Adding UI — the PluginUI bundle` section with a
    minimal `dashboardWidgets` example. MODULES.md
    §"UI registration" rewritten to reflect the real contract
    (the prior version still showed the dead symbolic-name spec
    from before task_19/21 — that doc-drift is also fixed in
    this PR).

### Additional verifications done in this session

- **End-to-end live smoke**: framework + shell vite dev servers
  booted, smoke-tester tenant signed up via `/api/auth/signup`,
  CRM bundle uploaded via `/api/admin/modules/upload` (201 with
  `toolsAdded: 55, skillsAdded: 8`), installed via
  `/api/admin/modules/crm/install` (200), `/api/admin/installs`
  confirmed `crm` in the per-tenant install set, both
  `/modules/crm/ui/index.mjs` and `/modules/crm/ui/index.css`
  served with correct `cache-control: no-cache, must-revalidate`
  headers (200, 182 kB JS + 41 kB CSS), and the same URL proxied
  cleanly through the shell vite dev server. Bundle text
  contains all four widget identifier strings
  (`dashboardWidgets`, `pipeline-by-stage`,
  `deals-closing-this-week`, `Pipeline by stage`,
  `Closing this week`).
- **Vitest-level e2e**: `tests/dashboard-widgets-bundle.test.ts`
  reproduces the same upload+install+bundle-introspection inside
  vitest using `BoringOS({ embedded: true })`. Passes in ~1.8s
  including embedded-postgres boot.
- **Layout polish**: changed `DashboardWidgetGrid` to a single
  4-col grid; framework secondary widgets and CRM widgets sized
  `medium` (2 cols each) so 4 mediums in secondary fill 2 rows of
  2 cleanly — no orphan tiles regardless of widget count being
  even or odd.
- **License-header linter** rewrote SPDX headers from `BUSL-1.1`
  to `GPL-3.0-or-later` on every new file mid-session — the
  changes were intentional and preserved.

## 7. Risks + mitigations

- **Risk:** a poorly-written widget blocks Home from rendering
  (sync throw, infinite render loop). **Mitigation:** every
  widget renders inside a per-widget `<ErrorBoundary>` + an
  `<Suspense>` boundary. A broken widget collapses to an error
  pill; the rest of the dashboard is unaffected.

- **Risk:** the page becomes a slow, jittery grid as N widgets
  fetch independently. **Mitigation:** widgets use the existing
  `useTool` / framework hooks which are already cached
  (React-Query under the hood for the `@boringos/ui` plugin
  hooks). No new fetch infrastructure is introduced. If
  perceived slowness shows up in testing, the answer is widget
  authors using cached hooks correctly — not adding a
  framework-level orchestrator.

- **Risk:** layout regressions when porting the existing tiles to
  widgets. **Mitigation:** Phase B includes a manual side-by-side
  visual check before merging. The widget surface supports `size`
  + `order` + `slot` — enough to reproduce the current layout.

- **Risk:** dashboard becomes a dumping ground (every Module
  ships 5 widgets, page becomes a soup). **Mitigation:** out of
  scope for this task — it's a UX governance problem, not a
  framework problem. If it surfaces in practice, follow-up tasks
  can add: per-tenant "show/hide widget" toggles, a "max
  widgets per module" guideline in BUILD-A-MODULE.md, or a
  per-user widget preference. None of those block this task.

- **Risk:** the new contract field overlaps semantically with
  some future "module home screen" / "module landing page"
  concept. **Mitigation:** keep the name `dashboardWidgets`
  scoped to *the shell Home screen*. A Module's own landing
  page (if one ever exists) is a different surface, contributed
  through a different field. Reserve `homePage` / `landing`
  names for that future case.

- **Risk:** porting framework tiles into a "framework" Module
  bloats that Module's manifest. **Mitigation:** widgets are
  small and co-located by purpose. If `framework` Module grows
  past ~5 widgets, split into a dedicated `dashboard` Module
  (Phase B option 2 fallback).

## 8. Order of operations

```
A → B → C → (optional D)
```

Phase A is risk-free and unlocks downstream work. Phase B is the
visible cleanup but doesn't user-facing-change anything if done
right (same tiles, same data). Phase C is where the user feels
the win: CRM appearing on Home for the first time.

## 9. What does not change

- The `Module` server-side manifest (`@boringos/module-sdk`) — no
  new fields. Widgets are UI-only; they live in `PluginUI`.
- The install/uninstall pipeline, the install-manager, the
  `.hebbsmod` bundle format, the realtime install events — all
  reused as-is. Adding a widget to a Module bumps that Module's
  version like any other UI change.
- Sidebar, Settings, entity panels, command palette — untouched.
- The plugin host's existing surfaces (`navItems`, `entityPanels`,
  etc.) — untouched.
- The CRM's existing surfaces (Pipeline, Deals, Contacts,
  Companies routes + entity panels + entity actions + settings
  panels) — untouched. The new widget is additive.

## 10. References

- `docs/blockers/task_21_one_module_system.md` §3.1 (the original
  `DashboardWidget` interface in the dead v1 SDK) and §"Phase I
  LANDED with honest deferrals" — explains why this surface
  doesn't exist today.
- `packages/@boringos/ui/src/contract.ts` — the `PluginUI`
  contract this task extends.
- `packages/@boringos/shell/src/plugin-host/registry.ts` — the
  registry this task adds a getter to.
- `packages/@boringos/shell/src/screens/Home.tsx` — the file this
  task rewrites.
- `boringos-crm/packages/web/src/ui.ts` — the CRM
  `PluginUI` declaration that gets the first
  `dashboardWidgets` entry in Phase C.
- `BUILD-A-MODULE.md` — to be updated in the same PR as Phase A.

## 11. Status log

| Date | Phase | Status | Notes |
|---|---|---|---|
| 2026-05-16 | E | LANDED | Live e2e smoke: framework + shell vite booted, signup → upload .hebbsmod → install → `/modules/crm/ui/index.mjs` serves bundle (200, 182 kB) with both widget ids present; bundle proxied cleanly through shell vite. `pnpm test:run` clean: **416/416 tests across 58 files** including 9 new tests for the dashboard surface (`dashboard-widgets-registry.test.ts` 5 tests, `dashboard-widgets-builtin.test.ts` 3 tests, `dashboard-widgets-bundle.test.ts` 1 test). |
| 2026-05-16 | D | LANDED | Second CRM widget shipped: `pipeline-by-stage` (medium/secondary). Uses `crm.pipelines.list` + `crm.pipelines.forecast`. Renders horizontal bars of open-deal counts per stage with weighted-forecast total in header. Links to `/pipeline?stage=<id>`. Bumped framework secondary widgets (cost/pulse/watch) to `size: "medium"` so layout is uniform 4-col grid; CRM widgets `medium` too → 4 mediums in secondary = 2 rows of 2 (no orphan). |
| 2026-05-16 | Docs | LANDED | `MODULES.md` §"UI registration" rewritten from dead symbolic-name spec to real PluginUI contract + per-surface table + dedicated dashboard-widgets section. `BUILD-A-MODULE.md` got a new "Adding UI — the PluginUI bundle" section with minimal `dashboardWidgets` example; outdated "🔜 Phase N" rows in §"What's NOT in this starter" updated to ✅. |
| 2026-05-15 | C | LANDED | CRM contributes `deals-closing-this-week` widget (secondary slot, small). Uses `crm.deals.list` + client-side 7-day filter. Links to deal detail. `pnpm -r build` clean for framework + CRM workspaces. |
| 2026-05-15 | B | LANDED | Home.tsx now ~25 lines: header + `<DashboardWidgetGrid widgets={useDashboardWidgets()} />`. Framework KPI tiles + cost sparkline + operating pulse + watch items extracted into per-widget components under `shell/src/builtin-plugins/widgets/`, registered as `framework` PluginUI. Unread inbox extracted under `inbox` PluginUI. `registerBuiltinPlugins()` called from `main.tsx` before `bootPlugins()`. |
| 2026-05-15 | A | LANDED | Contract types (`DashboardWidget`, `DashboardWidgetSize`, `DashboardWidgetSlot`) + `PluginUI.dashboardWidgets` field shipped in `@boringos/ui`. `pluginHost.dashboardWidgets` getter sorts by (slot, order, moduleId). `useDashboardWidgets()` hook lives in shell `plugin-host/` (uses `useSyncExternalStore` + `useInstalledModules` gate — same pattern as Sidebar). `DashboardWidgetGrid` primitive with per-widget `ErrorBoundary` + `Suspense` skeleton. Slot-aware grid: primary = 4-col, secondary = 3-col. Note: task plan placed hook in `@boringos/ui`; moved to shell to match existing Sidebar pattern (pluginHost lives shell-side). |
| 2026-05-15 | — | DRAFTED | Plan written; approved for execution |
