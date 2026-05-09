# MODULES.md — the Module manifest spec

Reference for v2's universal component shape. If you're starting
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

Modules can ship browser-facing surface via `ui`. The shell imports
the Module's React exports at host-app build time and renders
matching nav entries / panels for any tenant that has the Module
installed.

```ts
ui: {
  screens: [
    {
      id: "deals",
      label: "Deals",
      icon: "briefcase",
      path: "/apps/crm/deals",
      component: "DealsScreen",
    },
  ],
  taskPanels: [
    {
      id: "deal-context",
      label: "Linked deal",
      component: "DealContextPanel",
      appliesTo: { taskOriginKind: "crm" },
    },
  ],
  inboxFilters: [/* ... */],
  settingsPanels: [/* ... */],
}
```

`component` is a symbolic name — the shell resolves it against the
Module package's React exports. The actual React rendering happens
in the shell, not the Module.

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
> currently still go through the v1 `connectors` table for
> credentials. The planned end state per task_12 §5.2 is a
> per-Module `module_credentials` table with encryption at rest
> and 401-driven refresh.

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

Block schema is the v2 DAG shape — see
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
- [`MIGRATION-V1-TO-V2.md`](MIGRATION-V1-TO-V2.md) — porting v1 connectors / apps / plugins
- `packages/@boringos/module-sdk/src/types.ts` — TypeScript types
- `packages/@boringos/core/src/v2-modules/` — built-in Module implementations
