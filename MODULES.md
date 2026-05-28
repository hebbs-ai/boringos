# MODULES.md — the Module manifest spec

Reference for the universal component shape. If you're starting
from scratch, read [`BUILD-A-MODULE.md`](BUILD-A-MODULE.md) first
— this file is the canonical field-by-field spec.

The TypeScript types live in
[`packages/@boringos/module-sdk/src/types.ts`](packages/@boringos/module-sdk/src/types.ts).
This doc is the human-readable companion.

---

## What is a Module?

A bundle of skills + tools, plus optional schema, UI, default
workflows, default agents, routines, OAuth, webhooks. Registered
once via `app.module(myModule)`; the framework wires the rest.

A Module plays one of three roles. Same shape, different fields
populated:

| Role | Owns | Typical fields |
|---|---|---|
| **Connector** | A 3rd-party integration | `oauth`, `tools`, `webhooks`, `events` |
| **Capability** | Business logic over other Modules | `dependsOn`, `tools`, `provides` |
| **Hybrid** | Its own data + logic + 3rd-party | `schema`, `tools`, `oauth`, `ui` |

The framework doesn't care which role a Module thinks it plays —
the role is descriptive, not enforced.

The role is also surfaced as an explicit optional `kind` field on
the manifest (`"connector" | "module" | "hybrid"`). The shell uses
it to group Modules in the UI (Settings → Connectors vs Apps →
Modules), and the packaging step writes it into `module.json` —
the static manifest shipped inside the `.hebbsmod` bundle. When
omitted, the framework infers: `oauth && !schema → "connector"`,
`schema && !oauth → "module"`, both → `"hybrid"`. Dispatch,
install, and uninstall behaviour are identical regardless of
`kind` — it is purely a UI-grouping hint.

---

## Manifest fields

### Required

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | Stable identifier; lowercase, hyphen-separated. Used as the URL prefix for tools (`<id>.<tool-name>`) and the table prefix for schema (`<id>__<table>`). Cannot be changed without breaking installs. |
| `name` | `string` | Human-friendly display name shown in admin UI. |
| `version` | `string` | Semver. Bumped per release; recorded in `module_installs` so the framework can detect upgrades. |
| `description` | `string` | One sentence shown in admin UI and in capability resolution dialogs. |

### Optional

| Field | Type | Purpose |
|---|---|---|
| `kind` | `"connector" \| "module" \| "hybrid"` | UI-grouping hint. Inferred from `oauth` / `schema` presence when omitted. See [What is a Module?](#what-is-a-module). |
| `dependsOn` | `ModuleDependency[]` | Other Modules required for this one to function. See [Dependencies](#dependencies). |
| `provides` | `string[]` | Capability labels this Module announces. Other Modules' `dependsOn` can reference these. |
| `skills` | `SkillFileRef[]` | SKILL.md paths or inline `Skill` objects. See [SKILLS.md](SKILLS.md). |
| `tools` | `Tool[]` | Tools registered with the framework's tool registry. See [TOOLS.md](TOOLS.md). |
| `workflows` | `WorkflowSeed[]` | Default workflow definitions seeded on install. |
| `agents` | `AgentSeed[]` | Default agents seeded on install. |
| `routines` | `Routine[]` | Cron / event / webhook routines seeded on install. |
| `events` | `EventSpec[]` | Events this Module can emit. |
| `webhooks` | `Webhook[]` | Inbound HTTP handlers, mounted at `/api/webhooks/<id>/<event>`. |
| `oauth` | `OAuthConfig` | Required for connector Modules brokering a 3rd-party service. |
| `schema` | `Migration[]` | DDL the Module owns. Tables MUST be prefixed `<id>__`. |
| `ui` | `ModuleUI` | Browser-facing surface registered with the shell. |
| `lifecycle` | `ModuleLifecycle` | `onInstall` / `onUninstall` / `onTenantCreate` hooks. |
| `permissions` | `ModulePermissions` | Default tool-level permissions. |
| `defaultInstall` | `boolean` | Auto-install for every tenant at boot. Default `true`. |
| `__moduleDir` | `string` | Filesystem directory used to resolve relative `skills: ["./SKILL.md"]` paths. Set with `dirname(fileURLToPath(import.meta.url))`. |

---

## Manifest vs factory

A Module can be a static object or a factory function.

**Static manifest** — when the Module is pure data (no DB handle,
no engine reference):

```ts
export const helloModule: Module = {
  id: "hello",
  name: "Hello",
  version: "0.1.0",
  description: "Demo module",
  tools: [/* ... */],
};

app.module(helloModule);
```

**Factory** — when the Module needs framework services:

```ts
export const createCrmModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;
  return {
    id: "hebbs-crm",
    name: "Hebbs CRM",
    version: "0.1.0",
    description: "Deals, contacts, pipelines",
    tools: [makeCreateDealTool(db), makeListDealsTool(db)],
    schema: [/* migrations */],
  };
};

app.module(createCrmModule);
```

The framework calls factories after services are wired, so
`deps.db`, `deps.toolRegistry`, `deps.eventBus`, etc. are
available. See `ModuleFactoryDeps` for the full set.

---

## Static manifest (`module.json`) — versioning and compatibility

Every packaged `.hebbsmod` bundle carries a `module.json` file at
its root — the static counterpart to the runtime `Module` returned
by your factory. Three version fields appear there, each with a
distinct meaning:

| Field | What it tracks | Who enforces it |
|---|---|---|
| `version` | **Your module's** semver (e.g. `0.3.0`). Bumped whenever you ship a new release of the module itself. The host treats `<id>@<version>` as the bundle's identity for install / uninstall and uniqueness. | `pack-hebbsmod` rejects non-semver values; the host's upload route rejects re-uploads of an existing `<id>@<version>` unless `?force=true`. |
| `minFrameworkVersion` | The **lowest** Hebbs framework version your module can run on. Examples: `0.1.0`, `0.2.0`. Set this when you start using a feature that requires a recent framework — e.g. `requiredScopes` on `ConnectorDefinition` (framework `0.1.10+`), or the typed `ConnectorTokenHandle` (`0.2.0+`). | Host upload route. A bundle with `minFrameworkVersion: 99.0.0` against a host running `0.1.10` is rejected with `400 incompatible_framework — module requires framework >= 99.0.0, host is 0.1.10` **before** the bundle is moved into the module store. |
| `sdkVersion` | The `@boringos/module-sdk` version the module was built against. Informational — not currently used to gate installs. Useful for `hebbs doctor`-style tooling that wants to suggest upgrades. | Tooling only; the host doesn't enforce. |

### When to bump each

- **`version`** — every release. Semver applies: a new tool name or
  a breaking input change is a **major** bump; an additive field is
  **minor**; a bugfix-only release is **patch**.
- **`minFrameworkVersion`** — only when you start consuming a newer
  framework feature. Bump it to the lowest framework version that
  exposes the feature you need. Leave it absent if your module runs
  against any supported framework.
- **`sdkVersion`** — automated at pack time by future scaffolders;
  authors don't normally touch it.

### Manifest is derived from the factory at pack time

`pack-hebbsmod` dynamic-imports your bundled entry, calls the
factory with a stub deps object, and overrides the on-disk
`module.json`'s **runtime** fields (`id`, `name`, `version`,
`description`, `kind`, `dependsOn`, `provides`, `defaultInstall`)
from the resulting Module. Pack-time-only fields (`entry`, `ui`,
`publisher`, `license`, `minFrameworkVersion`, `sdkVersion`) come
from `module.json` unchanged.

That means `src/module.ts`'s `version` is the source of truth — if
the file on disk drifts from the factory, the bundled `module.json`
carries the factory's version and a drift warning is printed:

```
[pack-hebbsmod] manifest drift detected (runtime factory wins):
  version: "0.2.0" → "0.3.0"
```

### Programmatic schema

The `module.json` shape is published as a zod schema:

```ts
import {
  ManifestSchema,
  parseManifest,
  checkMinFrameworkVersion,
} from "@boringos/module-sdk";

const m = parseManifest(JSON.parse(readFileSync("module.json", "utf8")));
const compat = checkMinFrameworkVersion(m, "0.1.10");
if (!compat.ok) throw new Error(compat.reason);
```

Use these helpers in custom scaffolders, CI lint scripts, or any
tool that consumes a `module.json`. The schema is `passthrough`, so
extra fields are preserved.

---

## Dependencies

`dependsOn` entries are either concrete or capability-based.

### Concrete

```ts
dependsOn: [{ moduleId: "framework" }]
```

Hard dep on a specific Module. Use only when the dependency is
unique (e.g. the built-in `framework` module).

### Capability

```ts
dependsOn: [{ capability: "crm-source" }]
```

Declares "I need any Module that announces `crm-source` in its
`provides`." The framework resolves at install time. If zero
modules match, install fails. If multiple, the tenant picks.

This is what makes a `prevent-churn` Module work across
Salesforce / HubSpot / Hebbs CRM as long as each `provides:
["crm-source"]`.

### Optional

```ts
dependsOn: [{ capability: "email-send", optional: true }]
```

The Module loads even if no provider exists. The Module's tools
that reference `email-send` should check at call time and degrade
gracefully.

---

## Schema

Modules that own data declare DDL via `schema: Migration[]`.

### Naming rule

**All Module-owned tables MUST be prefixed `<module-id>__`.**

| Module id | Allowed table names |
|---|---|
| `hebbs-crm` | `hebbs_crm__deals`, `hebbs_crm__contacts` |
| `triage` | `triage__rules`, `triage__history` |

The prefix uses underscore, not hyphen, because Postgres
identifiers don't take hyphens. The framework substitutes
`hyphen → underscore` when validating.

This gives:
- Clean uninstall: `DROP TABLE` everything matching the prefix.
- Zero collision risk between independent Modules.
- Easy ownership audits: one `\dt` and you can see who owns what.

### Migrations

```ts
const initial: Migration = {
  id: "0001_initial",
  async up(db) {
    await db.execute(`
      CREATE TABLE hebbs_crm__deals (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        title TEXT NOT NULL,
        amount_cents INTEGER,
        stage TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
  },
  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS hebbs_crm__deals`);
  },
};
```

The framework runs `up` on install, `down` on uninstall.
Migrations are tracked per-Module per-tenant; re-installing a
Module re-runs unapplied migrations only.

---

## Lifecycle hooks

| Hook | When called | Typical use |
|---|---|---|
| `onInstall(ctx)` | Tenant installs the Module | Run schema migrations, seed default config rows, install default workflows/agents/routines, register webhook URLs with the 3rd party |
| `onUninstall(ctx)` | Before removing the Module install | Drop schema, revoke OAuth, unregister webhooks, clean up |
| `onTenantCreate(ctx)` | New tenant signs up AND `defaultInstall: true` | Auto-provision the Module for the new tenant |

`ModuleContext` carries `tenantId`, `moduleId`, and a `db` handle.

```ts
lifecycle: {
  async onInstall(ctx) {
    await ctx.db.execute(
      `INSERT INTO hebbs_crm__pipelines (tenant_id, name, stages)
       VALUES ('${ctx.tenantId}', 'Default', '["lead","qualified","won","lost"]')`
    );
  },
  async onUninstall(ctx) {
    await ctx.db.execute(
      `DELETE FROM hebbs_crm__pipelines WHERE tenant_id = '${ctx.tenantId}'`
    );
  },
}
```

Hooks must be **idempotent** — install may be retried on partial
failure; uninstall may be called against tenants that never had
the Module.

---

## UI registration

A Module's browser-facing surface lives in a separate `PluginUI`
object, exported from the Module's `ui/index.mjs` bundle (see the
`.hebbsmod` packaging in `BUILD-A-MODULE.md`). The shell's
`pluginHost` registers it at boot via `pluginHost.register(ui)`;
contributions are gated per-tenant by `useInstalledModules()`.

```ts
// packages/web/src/ui.ts — typical layout in a hybrid module
import type { PluginUI } from "@boringos/ui";

import { DealsPage } from "./pages/Deals.js";
import { DealDetailPanel } from "./panels/DealDetail.js";
import { PipelineSettings } from "./settings/PipelineSettings.js";
import { DealsClosingThisWeek } from "./dashboard/DealsClosingThisWeek.js";

export const crmUI: PluginUI = {
  moduleId: "crm",
  displayName: "CRM",
  navItems: [
    { id: "deals", label: "Deals", path: "/deals", element: DealsPage, order: 20 },
    { id: "deal-detail", label: "Deal", path: "/deals/:id", element: DealsPage, hidden: true },
  ],
  entityPanels: [
    { entityKind: "crm_deal", id: "overview", label: "Overview", element: DealDetailPanel },
  ],
  entityActions: [
    { entityKind: "crm_deal", id: "mark-won", label: "Mark won", invoke: markWon },
  ],
  settingsPanels: [
    { id: "crm.pipeline", label: "Pipeline configuration", element: PipelineSettings },
  ],
  dashboardWidgets: [
    {
      id: "deals-closing-this-week",
      title: "Closing this week",
      size: "medium",
      slot: "secondary",
      element: DealsClosingThisWeek,
    },
  ],
  copilotTools: [/* ... */],
  inboxFilters: [/* ... */],
};
```

`element` is a **real `React.ComponentType` reference** (or a
`React.lazy` thunk) — not a symbolic name. The Module's UI bundle
ships React components, the shell mounts them, and they share the
host's React + plugin-host context. See `BUILD-A-MODULE.md` for
the `kind: "hybrid"` + `ui.sourcePath` packaging that wires the
sibling `packages/web/` build into the `.hebbsmod`.

### Contribution surfaces

| Field | What it adds | Gating |
|---|---|---|
| `navItems` | Sidebar entries + routes (`hidden: true` mounts the route without the link) | Per-tenant install |
| `entityPanels` | Tabs on the entity detail screen (`entityKind` = the entity row's kind) | Per-tenant install |
| `entityActions` | Context-menu actions on entities | Per-tenant install + optional `visible(entity)` predicate |
| `settingsPanels` | Tabs in the admin Settings screen | Per-tenant install |
| `copilotTools` | Tool ids the copilot UI auto-suggests | Per-tenant install |
| `inboxFilters` | Inbox-page filters (`match(item)` predicate) | Per-tenant install |
| `dashboardWidgets` | Tiles on the shell Home dashboard (task_26) | Per-tenant install |

### Dashboard widgets

Each widget declares its grid footprint and vertical placement:

```ts
dashboardWidgets: [
  {
    id: "deals-closing-this-week",      // stable, module-local
    title: "Closing this week",         // header label
    size: "medium",                      // "small" | "medium" | "large"
    slot: "secondary",                   // "primary" | "secondary"
    element: DealsClosingThisWeek,       // React component, no required props
    order: 100,                          // optional sort hint within (slot, moduleId)
  },
],
```

The Home grid is 4 columns wide on `md+`: `small` spans 1 col,
`medium` spans 2, `large` spans 4 (full row). `primary` widgets
render above `secondary` with a gutter between. The shell wraps
every widget in a per-widget error boundary + Suspense skeleton —
a broken or slow widget never blacks out the page. The widget
fetches its own data via the standard plugin hooks
(`useTool`, `useToolMutation`) or your existing framework hooks.

### Theme support — the `--bos-*` contract

The shell ships a Light/Dark theme picker (Settings → Appearance)
that flips `data-theme="dark"` on `<html>`. To make your Module's
UI follow the user's theme choice, import the shell's CSS-variable
contract from `@boringos/ui/theme.css` and define your Tailwind
tokens as references to it:

```css
/* packages/web/src/index.css */
@import "@boringos/ui/theme.css";
@import "tailwindcss";

@theme {
  --color-bg:             var(--bos-bg);
  --color-surface:        var(--bos-surface);
  --color-surface-raised: var(--bos-surface-raised);
  --color-text:           var(--bos-text);
  --color-muted:          var(--bos-muted);
  --color-border:         var(--bos-border);
  --color-accent:         var(--bos-accent);
  --color-success:        var(--bos-success);
  --color-warning:        var(--bos-warning);
  --color-danger:         var(--bos-danger);
  --color-info:           var(--bos-info);
}
```

The shell rewrites `--bos-*` values on theme switch; your Module's
CSS resolves through the cascade with no JS, no rebuild, no shell
→ plugin event. The same mechanism applies whether your bundle is
co-built into the shell or loaded at runtime as a `.hebbsmod`.

**Available contract variables** (full list in
`packages/@boringos/ui/theme.css`):

| Group       | Variables                                                                                          |
|---          |---                                                                                                 |
| Surfaces    | `--bos-bg`, `--bos-bg-warm`, `--bos-surface`, `--bos-surface-raised`, `--bos-surface-tint`          |
| Borders     | `--bos-border`, `--bos-border-subtle`                                                              |
| Text        | `--bos-text`, `--bos-text-secondary`, `--bos-muted`, `--bos-muted-strong`                          |
| Accent      | `--bos-accent`, `--bos-accent-light`, `--bos-accent-bright`, `--bos-accent-tint`                   |
| State       | `--bos-success`, `--bos-warning`, `--bos-danger`, `--bos-info` (+ `*-tint` variants)               |
| Misc        | `--bos-grid-dot`                                                                                   |

**Module-specific colored chips** (purple stages, custom status
badges, etc.) that have no `--bos-*` equivalent should declare
their own light values in `@theme` and add a `[data-theme="dark"]`
override block in your stylesheet — see
`boringos-crm/packages/web/src/index.css` for the reference
pattern.

---

## Routines

Cron / event / webhook scheduled invocations. Same shape as tenant-
edited routines; the Module ships defaults that tenants can edit
or disable.

```ts
routines: [
  {
    id: "weekly-pipeline-summary",
    title: "Weekly pipeline summary",
    trigger: { type: "cron", expression: "0 9 * * 1", timezone: "UTC" },
    tool: "hebbs-crm.send_pipeline_summary",
    inputs: { format: "markdown" },
    enabled: true,
  },
  {
    id: "link-inbound-email",
    title: "Link inbound email to deal",
    trigger: { type: "event", eventType: "gmail.email_received" },
    tool: "hebbs-crm.link_email_to_deal",
    inputs: { messageId: "{{event.messageId}}" },
  },
]
```

Trigger types:
- `cron` — fires on a cron expression with timezone
- `event` — fires when an event matches
- `webhook` — fires when an inbound webhook hits this Module

Routines are seeded on install. Tenants can disable in the admin
UI without losing the definition.

---

## Webhooks

```ts
webhooks: [
  {
    event: "messages",
    description: "Inbound Slack messages",
    async verify(req) {
      const sig = req.headers["x-slack-signature"];
      const ts = req.headers["x-slack-request-timestamp"];
      return verifySlackSignature(req.body, sig, ts);
    },
    async handler(req, ctx) {
      const payload = JSON.parse(req.body);
      await emit("slack.message_received", { tenantId: ctx.tenantId, payload });
    },
  },
]
```

The framework mounts each Module's webhooks at
`/api/webhooks/<module-id>/<event>`. Auth is the Module's
responsibility; declare a `verify` function.

Common patterns:
- **HMAC signature** (Slack, Stripe) — verify against a per-tenant
  secret stored in `module_credentials`.
- **Query-string secret** (cheap webhooks) — short, opaque.
- **mTLS** — when the 3rd party supports it.

---

## OAuth

For connector Modules brokering a 3rd-party API.

```ts
oauth: {
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
  clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
  scopes: ["https://www.googleapis.com/auth/gmail.send"],
  pkce: true,
}
```

> **Status:** `OAuthConfig` is declared in the SDK; built-in
> connector Modules (`connector-google`, `connector-slack`)
> currently still go through the legacy `connectors` table for
> credentials. The planned end state is a per-Module
> `module_credentials` table with encryption at rest and
> 401-driven refresh.

---

## Permissions

Default permission gating for the Module's tools. Per-tool
overrides via the Tool's own `permissions` field.

```ts
permissions: {
  defaultRoles: ["admin", "member"],
}
```

Empty / undefined = open within tenant. See [TOOLS.md](TOOLS.md)
for per-tool gating.

---

## Default workflows + agents

Both are seeded by `onInstall` and become editable rows the
tenant owns.

### Workflows

```ts
workflows: [
  {
    name: "Email-to-deal linker",
    description: "When email mentions a deal id, comment on the deal task",
    blocks: [
      { id: "trigger", kind: "trigger" },
      { id: "extract", kind: "tool", tool: "hebbs-crm.extract_deal_id",
        inputs: { body: "{{trigger.body}}" } },
      { id: "comment", kind: "tool", tool: "framework.comments.post",
        inputs: { taskId: "{{extract.taskId}}", body: "{{trigger.summary}}" } },
    ],
    edges: [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "extract" },
      { id: "e2", sourceBlockId: "extract", targetBlockId: "comment" },
    ],
    trigger: { type: "event", eventType: "gmail.email_received" },
  },
]
```

Block schema is the DAG shape — see
`docs/blockers/task_12_greenfield_rebuild.md` §13b.3.

### Agents

```ts
agents: [
  {
    name: "Sales rep",
    persona: "personas-default.sales-rep",
    instructions: "You sell to mid-market SaaS. Pipeline ...",
    tools: ["hebbs-crm.*", "gmail.send"],
    reportsTo: "Chief of Staff",
  },
]
```

The framework creates these as rows in `agents` with
`source: "app", source_app_id: <module-id>` (provenance columns
shipped via task_07) so uninstall can clean them up.

---

## Install state

Stored in `module_installs`:

```
(tenantId, moduleId, version, installedAt, configJson)
```

The framework reads this on every agent wake to decide which
modules' skills + tools to expose. Uninstall removes the row plus
runs `onUninstall`.

`configJson` holds tenant-supplied configuration the Module
declares it accepts (e.g. "which Slack channel does triage post
into") — exposed in the admin UI per the Module's settings panel.

---

## Best practices

### When to make something a Tool vs a Routine vs a Workflow

| Need | Use |
|---|---|
| Agent calls it directly with arguments | Tool |
| Runs on a schedule with fixed inputs | Routine |
| Multi-step composition with branching | Workflow |
| Inbound 3rd-party HTTP | Webhook → emits event → routine/workflow listens |

### When to bundle vs split

- **One Module per cohesive concept.** "Hebbs CRM" is one
  Module; don't split deals, contacts, and pipelines into three.
- **One Module per 3rd-party service.** Don't combine Gmail and
  Slack — they have separate OAuth, separate failure modes,
  separate skills.
- **One Module per business capability.** "Lead scoring" and
  "deal forecasting" are separate Modules even if both depend on
  `crm-source`.

### Module ids

- Lowercase, hyphen-separated.
- Reserved prefix: `framework`, `personas-*` — only built-ins.
- Avoid generic names (`utils`, `helpers`) — collisions hurt.
- Match the npm package name for third-party Modules:
  `@hebbs/crm` → id `"hebbs-crm"`.

---

## Anti-patterns

| Don't | Why |
|---|---|
| Side effects in tools without `tool_calls` audit | The dispatcher writes audit rows automatically — bypass at your peril |
| Schema without `<id>__` prefix | Uninstall can't clean up; collides with other Modules |
| Reading `tenantId` from tool inputs | Agents could spoof; always read from `ToolContext` |
| Mutating other Modules' tables | Each Module owns its own data; cross-Module data flows via tools |
| Synchronous OAuth refresh in a tool handler | Refresh in a connector helper; tool handlers stay fast |
| Lifecycle hooks that aren't idempotent | Install retries and double-calls happen — design for them |

---

## See also

- [`BUILD-A-MODULE.md`](BUILD-A-MODULE.md) — step-by-step guide
- [`TOOLS.md`](TOOLS.md) — Tool spec
- [`SKILLS.md`](SKILLS.md) — Skill spec
- [`docs/install-flow.md`](docs/install-flow.md) — packaging, upload, install/uninstall flow
- `packages/@boringos/module-sdk/src/types.ts` — TypeScript types
- `packages/@boringos/core/src/modules/` — built-in Module implementations
