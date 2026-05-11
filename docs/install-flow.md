# Module install / uninstall flow

How a Module is **packaged**, **uploaded**, **installed**, **shown in the UI**, and **uninstalled**.

This doc is the canonical spec for the WordPress/Shopify-style end-user flow ("upload a zip, click install"). The runtime primitives (`Module`, `ModuleRegistry`, `InstallManager`, `module_installs`) are described in [`MODULES.md`](../MODULES.md) and `packages/@boringos/module-sdk/src/types.ts`. This doc layers the **package + lifecycle + UI** on top of those primitives.

> **Implementation status (task_22, 2026-05-11).** **LAYER 1 + LAYER 2 shipped.** End-to-end loop is real: a `.hebbsmod` uploaded via the Apps screen (`POST /api/admin/modules/upload`) is extracted, signature-checked (or accepted with a warning when `HEBBS_DEV_MODULES=true`), recorded in `module_packages`, dynamic-imported, and registered with the live host — tools/skills/webhooks/routines all wire up post-`listen()`. The shell hot-loads the module's UI via `import("/modules/<id>/ui/index.mjs")`. Per-tenant install (LAYER 3, the original `module-admin-routes.ts`/`install-manager.ts`) stacks on top unchanged. CRM is the first third-party module to ship this way and is no longer statically wired into `scripts/dev-server.mjs` — see [`docs/blockers/task_22_module_packages_upload_install.md`](blockers/task_22_module_packages_upload_install.md).

---

## 1. Bundle format — the "zip"

### 1.0 One compressed file

A Module is **one file**. End users see exactly that: a single `.hebbsmod` they download and upload. They never deal with internal structure.

`.hebbsmod` is a renamed `.zip`. This is the standard trick:

| Format | What it really is |
|---|---|
| `.vsix` (VSCode extension) | zip |
| `.xpi` (Firefox add-on) | zip |
| `.crx` (Chrome extension) | zip |
| `.apk` (Android app) | zip |
| `.ipa` (iOS app) | zip |
| `.docx` / `.xlsx` | zip |
| `.jar` (Java) | zip |
| WordPress plugin | zip |

**Why a custom extension on top of zip?** The OS picks the right open/install handler ("Open with Hebbs") instead of mounting the bundle as a generic archive. The framework can also reject `.zip` uploads from the wrong source while accepting `.hebbsmod`.

**Expected size.** For the Hebbs CRM module — server code, schema, UI, skills — expect **~500KB–2MB** after esbuild. Server code compresses to almost nothing because `@boringos/*` is marked external; React UI is the largest chunk. Pure connector modules (Gmail, Slack — OAuth + a few tools, no UI) are typically **< 100KB**.

**Content addressing.** The framework SHA-256s the uploaded bytes and stores the hash on `module_packages.contentHash`. One hash identifies the exact bytes that were uploaded — used for cache busting, tamper detection, and "is this the same module I uploaded yesterday?" checks.

### 1.1 Internal layout

```
crm-0.3.0.hebbsmod   (a zip archive — internals shown for spec, not user-visible)
├── module.json          # static manifest — see §1.2
├── index.mjs            # bundled ESM, default export = Module | ModuleFactory
├── skills/              # SKILL.md files referenced from manifest
│   └── deals.md
├── migrations/          # optional, also referenceable from manifest.schema
│   └── 0001_initial.sql
├── ui/                  # optional, prebuilt static assets for the shell
│   ├── index.mjs        # ESM entry exporting React components named in module.ui
│   └── assets/...
└── signature            # detached Ed25519 signature over (module.json + index.mjs + ui/index.mjs)
```

The bundle is **self-contained** — all runtime dependencies are bundled into `index.mjs` via esbuild with `@boringos/*` marked external. The host provides those at runtime.

### 1.2 `module.json` — the static manifest

Mirrors a subset of the `Module` interface — only the fields the host needs *before* importing the code:

```json
{
  "id": "crm",
  "name": "Hebbs CRM",
  "version": "0.3.0",
  "description": "Deals, contacts, pipelines",
  "kind": "module",
  "entry": "./index.mjs",
  "ui": { "entry": "./ui/index.mjs" },
  "dependsOn": [{ "capability": "email-send", "optional": true }],
  "provides": ["crm-source"],
  "permissions": { "defaultRoles": ["admin", "member"] },
  "publisher": { "id": "hebbs", "name": "Hebbs" },
  "license": "MIT",
  "minFrameworkVersion": "1.0.0"
}
```

The full `Module` (tools, schema, lifecycle hooks, etc.) is the **default export** of `index.mjs`. The host trusts that runtime export over `module.json` — `module.json` is a discovery-time summary used to render the install screen *before* the code runs.

### 1.3 `kind` — connector vs module vs hybrid

The existing three roles in `MODULES.md` are descriptive. We make them **explicit metadata** so the shell can group and filter:

| `kind`        | Meaning                                                                                                | UI grouping       | Examples              |
|---------------|--------------------------------------------------------------------------------------------------------|-------------------|-----------------------|
| `"connector"` | Wraps a 3rd-party service. Mostly `oauth`, `tools`, `webhooks`. Rarely owns DB schema.                 | "Connectors"      | Gmail, Slack          |
| `"module"`    | Owns its own data + workflows + screens. Often has `schema`, `ui`, `agents`, `workflows`.              | "Apps"            | Hebbs CRM, Triage     |
| `"hybrid"`    | Both — owns data *and* brokers a 3rd party.                                                            | "Apps"            | Stripe Billing, HubSpot Sync |

Rules:

- `kind` is **declared by the author** in `module.json`. It's a hint, not a constraint — the framework still validates each field.
- The shell uses `kind` to decide which screen the module lands on (Settings → Connectors vs Apps → Modules) and what badge it shows.
- If `kind` is missing, the framework infers it: `oauth && !schema → connector`, `schema && !oauth → module`, both → `hybrid`.

This is purely metadata + UI grouping. Dispatch, install, uninstall all work the same way regardless of `kind`.

### 1.4 `module_packages` row

When a `.hebbsmod` is uploaded, the host records one row in `module_packages`:

```
(id, version, kind, storePath, contentHash, signaturePublisherId, uploadedAt)
```

- `id`, `version`, `kind` — from `module.json`
- `storePath` — `MODULES_STORE_DIR/<id>@<version>/` after extraction
- `contentHash` — `sha256(<uploaded .hebbsmod bytes>)`
- `signaturePublisherId` — `null` in dev mode; the publisher key id in production

This is the **host-global** layer. Per-tenant install state stays in `module_installs`.

---

## 2. The lifecycle — three independent layers

Install is **not one operation**. It's three layers stacked:

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3 — Per-tenant install (existing InstallManager)     │
│   row in `module_installs` (tenantId, moduleId, version)    │
│   runs lifecycle.onInstall(ctx) per tenant                  │
│   applies schema migrations into <id>__ tables              │
│   seeds default workflows / agents / routines               │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2 — Runtime registration (NEW)                       │
│   row in `module_packages` (id, version, storePath, sig)    │
│   dynamic `import()` of index.mjs                           │
│   `app.module()` populates ToolRegistry / SkillRegistry     │
│   webhooks mounted at /api/webhooks/<id>/*                  │
│   UI assets mounted at /modules/<id>/ui/*                   │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1 — Package store (NEW)                              │
│   .hebbsmod extracted to MODULES_STORE_DIR/<id>@<version>/  │
│   signature verified, content-addressed                     │
└─────────────────────────────────────────────────────────────┘
```

LAYER 1 + 2 are **host-global** — once installed, the host knows about the module. LAYER 3 is **per-tenant** — each tenant decides whether *they* use it.

This separation matters: the same uploaded `.hebbsmod` can be installed for one tenant, uninstalled for another, and live alongside both states.

---

## 3. Install — step by step

### 3.1 Upload (LAYER 1)

```
POST /api/admin/modules/upload
Content-Type: multipart/form-data
Body: file=<crm-0.3.0.hebbsmod>
```

1. **Receive + extract** to a temp directory.
2. **Parse `module.json`**, fail on missing required fields or invalid `id` (`/^[a-z][a-z0-9-]*$/`).
3. **Verify signature.** In production mode, reject unsigned bundles or bundles signed by an unknown publisher key. In dev mode (`HEBBS_DEV_MODULES=true`), warn and accept.
4. **Reject conflicts.** If `(id, version)` already exists in `module_packages`, return 409. To replace, the caller uploads a new version or explicitly `DELETE`s first.
5. **Atomic move** to `MODULES_STORE_DIR/<id>@<version>/`. Content-addressed by version; downgrades keep both directories.
6. **Insert row** in `module_packages`:
   ```
   (id, version, kind, storePath, signaturePublisherId, uploadedAt)
   ```

At this point the bundle is on disk but **not running**. Crucially, this lets you upload multiple versions and only activate one.

### 3.2 Register at runtime (LAYER 2)

Triggered automatically after upload, or manually via `POST /api/admin/modules/<id>/activate`:

1. `await import("file://" + storePath + "/index.mjs")` — Node ESM dynamic import.
2. Take the default export (`Module | ModuleFactory`); call factory with `factoryDeps` if it's a function.
3. Validate the runtime `Module` against `module.json` — `id` and `version` must match exactly. Refuse on mismatch.
4. Call the **new** `app.registerModuleAtRuntime(mod)` — refactored from the inline loop at `boringos.ts:272`. It does what boot does today, on a single module:
   - `moduleRegistry.register(mod)`
   - register every tool on `toolRegistry`
   - register every skill on `skillRegistry`
   - mount webhooks at `/api/webhooks/<id>/<event>`
   - register routines with the scheduler
   - register settings on `settingRegistry`
5. **Mount UI assets**: serve `<storePath>/ui/` as static at `/modules/<id>/ui/*`. The shell's lazy `import()` for module UI uses this URL.

The host is now fully aware of the module. Tools at `POST /api/tools/<id>.<name>` work. Webhooks accept inbound traffic. **No tenant has it installed yet.**

### 3.3 Per-tenant install (LAYER 3 — already exists)

```
POST /api/admin/modules/:id/install
```

(Already implemented at `packages/@boringos/core/src/module-admin-routes.ts`.) The flow:

1. `installManager.install(moduleId, tenantId)`.
2. Run each `schema: Migration[]`'s `up()` against the tenant's data — creates `<id>__` tables.
3. Call `lifecycle.onInstall(ctx)` with `{ tenantId, moduleId, db }`. Idempotent.
4. Seed default `workflows`, `agents`, `routines` as tenant-owned rows with `source = "module"`, `source_app_id = <id>` for provenance.
5. Insert `module_installs` row: `(tenantId, moduleId, version, config, installedAt)`.
6. Refresh the agent's skill prompt — next wake reads the new `## Skills` section.

**Idempotency**: re-installing the same `(tenantId, moduleId, version)` is a no-op. Re-installing a different version triggers an upgrade path (run only unapplied migrations, optionally call `lifecycle.onUpgrade(ctx, fromVersion)` if defined).

**Auto-install for new tenants**: `defaultInstall: true` modules get installed for every existing tenant at registration time and for every new tenant via `onTenantCreate`.

---

## 4. UI — how installed / uninstalled / available is shown

Two screens, driven by joining `module_packages` (host-global) with `module_installs` (per-tenant).

### 4.1 The "Apps" screen — full modules

`/admin/apps` (and `/admin/connectors` for `kind === "connector"`).

Each row shows the cross product of "is the host aware of it?" × "has this tenant installed it?":

| `module_packages` row | `module_installs` row for tenant | UI state          | Primary action     |
|-----------------------|----------------------------------|-------------------|--------------------|
| present               | present, version matches         | **Installed**     | Configure / Uninstall |
| present               | present, version differs         | **Update available** | Update             |
| present               | absent                           | **Available**     | Install            |
| absent                | present (orphaned)               | **Orphaned**      | Force-uninstall    |
| absent                | absent                           | (not shown)       | —                  |

**Orphaned** is the edge case where a module's package was deleted from the host but a tenant install row remains. This shouldn't happen in normal flows (LAYER 1 deletion requires LAYER 3 cleanup first), but the UI handles it for recovery.

The shell calls two endpoints:

- `GET /api/admin/modules` — every host-registered module (LAYER 2). Already exists.
- `GET /api/admin/installs` — every install row for the current tenant (LAYER 3). Already exists.

The shell joins them client-side.

### 4.2 Per-row card

Each module renders a card with:

- **Icon + name + version** from `module.json`
- **Kind badge** — "Connector" / "App" / "App + Connector"
- **State badge** — Installed / Available / Update available / Orphaned
- **Provides / Depends-on chips** — capability labels resolved to other modules
- **Tool count + skill count**, derived from the live registry
- **Publisher** + signature-verified checkmark
- **Primary action button** matching the state column above
- **Secondary**: "Settings" (opens the module's `ui.settingsPanels`), "View tool calls" (filters `tool_calls` audit log to this module)

### 4.3 The marketplace tab (later)

Same screen, third tab: "Browse" — lists modules in the registry that are **not yet uploaded** to this host. Selecting one downloads its `.hebbsmod` and runs the upload flow above. Out of scope for the first cut.

### 4.4 Shell nav from a Module

When a module is **Installed** for the current tenant:

- Each entry in `mod.ui.screens` becomes a nav item.
- The shell lazy-loads the component via dynamic `import("/modules/<id>/ui/index.mjs")` and renders the named React export.
- `taskPanels`, `inboxFilters`, `settingsPanels` are mounted into their respective host slots.

When **Available** but not installed: nav items don't appear at all. The module is invisible to that tenant's end users.

---

## 5. Uninstall — step by step

Per-tenant uninstall (LAYER 3) is independent of host-global removal (LAYER 1 + 2).

### 5.1 Per-tenant uninstall (LAYER 3 — already exists)

```
POST /api/admin/modules/:id/uninstall
```

1. Call `lifecycle.onUninstall(ctx)` — module's chance to revoke OAuth, unregister webhooks with the 3rd party, etc.
2. Run each migration's `down()` in reverse order — drops `<id>__` tables for the tenant's data.
3. **Backstop**: `DROP TABLE` everything in this tenant's namespace matching `<id>__%` that the migration `down()` didn't catch. This is what makes the table-prefix rule load-bearing.
4. Delete tenant-owned rows seeded by this module: `DELETE FROM agents WHERE source_app_id = <id>`, same for workflows + routines.
5. Delete the `module_installs` row.
6. Refresh the tenant's agents — next wake's prompt no longer includes this module's skills.

**Hooks must be idempotent** — uninstall may be called against tenants that never had a row.

### 5.2 Host-global removal (LAYER 1 + 2 — NEW)

```
DELETE /api/admin/modules/:id?version=0.3.0
```

1. **Refuse** if any `module_installs` row still references this `(id, version)`. Caller must uninstall per-tenant first, or pass `?force=true` and accept that all tenant data for this module gets dropped.
2. **Unregister at runtime**:
   - Remove all tools from `toolRegistry` (filter by `moduleId === id`).
   - Remove all skills from `skillRegistry`.
   - Unmount webhook handlers.
   - Stop and remove routines.
   - Unmount static UI route.
   - Remove from `moduleRegistry`.
3. **Delete `module_packages` row.**
4. **Remove the directory** `MODULES_STORE_DIR/<id>@<version>/`.

### 5.3 The unloading caveat

Node ESM does not unload imported modules. After step 2 above, the module's code is still in memory — closures, captured timers, async handlers. The framework can stop *calling* them, but not *free* them.

Three options, ranked:

1. **Accept it** — uninstall removes the module from the registry, drops files, drops DB. Restarting the host fully frees memory. Document this clearly. Easiest, ships first.
2. **Worker-thread isolation** — every module loads in a `node:worker_threads` worker; uninstall = `worker.terminate()`. Clean but adds an RPC layer to every tool dispatch. Defer until third-party modules.
3. **Process-per-module** — `child_process.fork()` per module. Strongest isolation, heaviest. Defer indefinitely.

**First cut: option 1.** A "Restart host to fully unload" banner appears after uninstall.

---

## 6. State diagram

```
            upload                register                 install (per tenant)
   nothing ───────► On disk ───────────────► On disk + ───────────────────────► Active for tenant
                    (LAYER 1)               registered                          (LAYER 1+2+3)
                                            (LAYER 1+2)
                                                ▲ │
                                                │ │ uninstall (per tenant)
                                                │ ▼
                                            On disk + registered
                                            no tenants installed
                                                │ ▲
                                          delete │ │ re-register
                                                ▼ │
                                            On disk only
                                                │ ▲
                                          delete │ │ upload
                                                ▼ │
                                              nothing
```

Three independent state changes; each layer can be operated on without the others.

---

## 7. What this requires from the framework

### 7.1 New code

- `module_packages` table — `(id, version, kind, storePath, contentHash, signaturePublisherId, uploadedAt)`
- `POST /api/admin/modules/upload` — multipart receiver, signature + hash verifier, atomic store mover
- `app.registerModuleAtRuntime(mod)` — refactor of the per-module wiring loop at `boringos.ts:272`
- `app.unregisterModuleAtRuntime(id)` — inverse: drop tools/skills/webhooks/routines/settings
- `DELETE /api/admin/modules/:id` — host-global removal, with `?force=true` for cascading tenant uninstall
- Static route `/modules/:id/ui/*` — serve from `<storePath>/ui/`
- Shell screen — Apps + Connectors tabs, joining `/api/admin/modules` with `/api/admin/installs`
- `pack-hebbsmod` script in the SDK — bundles the module's TS via esbuild to `index.mjs`, then zips to `.hebbsmod`

### 7.2 Module SDK addition

Add `kind` to the `Module` interface:

```ts
export type ModuleKind = "connector" | "module" | "hybrid";

export interface Module {
  // ... existing fields
  kind?: ModuleKind;
}
```

Optional with inferred default — see §1.3.

### 7.3 Already in place — do not rebuild

- `Module` shape, `ModuleRegistry`, `ToolRegistry`, `SkillRegistry`
- `InstallManager.install()` / `.uninstall()` and lifecycle hook contract
- `module_installs` table + per-tenant install endpoints
- `<id>__` table-prefix discipline
- `source_app_id` provenance columns on `agents`, `workflows`, `routines`
- Webhook mount path convention (`/api/webhooks/<id>/<event>`)

---

## 8. The four hard parts (in order of difficulty)

1. **Hot UI loading.** Shell currently imports module UI at host-build time. Move to runtime dynamic `import()` from `/modules/<id>/ui/*`. Real work, real tradeoffs. Module Federation is the cleanest answer; raw dynamic ESM works too.
2. **Runtime `app.module()` path.** Refactor `boringos.ts` so the per-module loop is callable post-`listen()`. ~200 lines of mechanical refactor.
3. **Trust.** Uploaded zip = arbitrary server code. Choose: signed-only with publisher key list, or "dev mode unsigned" toggle. There is no realistic in-process Node sandbox.
4. **Unloading.** Accept "restart to fully free" for the first cut. Worker-thread isolation later if third-party module velocity demands it.

---

## 9. Implementation phases — workstream "U" (Upload/Install)

Sequenced so each phase is a shippable PR and the next phase depends on the previous one working end-to-end. Workstream letter "U" continues the convention from `docs/archive/build/tasks-phase-3.json` (N–T already taken).

### U1 — Foundations (1–2 days, zero behavior change)

- **U1.1** — Add `kind: "connector" | "module" | "hybrid"` to the `Module` interface in `packages/@boringos/module-sdk/src/types.ts`. Add to `MODULES.md`. Optional with inferred default.
- **U1.2** — Add `module_packages` Drizzle table in `packages/@boringos/db/src/schema/` with columns from §1.4. Export from the schema index. Generate + commit migration.
- **U1.3** — Add a `pack-hebbsmod` script (likely `scripts/pack-hebbsmod.ts` or in `module-sdk`) that any module package runs to produce `dist/<id>-<version>.hebbsmod`. esbuild with `@boringos/*` external; zip with `module.json` at the root; compute and print SHA-256 of the output.
- **U1.4** — Run U1.3 against `boringos-crm/packages/server/src/module.ts` and check the artifact into a fixtures dir so U2 has something real to load.

**Done when:** `pnpm pack-hebbsmod crm` produces a valid zip with `module.json` + `index.mjs`, and `unzip -l crm-*.hebbsmod` shows the expected layout. Nothing in the running framework changes.

### U2 — Proof of concept: runtime register (1 day)

Before the full HTTP path, prove the dynamic-import + register approach works at all:

- **U2.1** — Refactor the loop at `boringos.ts:272` into a `registerModule(mod, deps)` method callable post-`listen()`. Boot calls it in a loop; same behavior as today.
- **U2.2** — Write a 50-line throwaway script: remove CRM from the built-in list, after `app.listen()` extract `crm.hebbsmod`, `await import("file://...")`, call `app.registerModule(mod, deps)`, then `curl POST /api/tools/crm.deals.create`.

**Done when:** the curl succeeds, end-to-end, in a single terminal session. **This is the go/no-go gate.** If runtime registration doesn't work (Hono mid-flight route mounting, factory deps captured at boot, registry mutability) you find out before spending days on U3.

### U3 — Real HTTP upload + delete (3–5 days)

- **U3.1** — `POST /api/admin/modules/upload` in a new `module-package-routes.ts` (or extend `module-admin-routes.ts`). Multipart receive → SHA-256 → extract to temp → validate `module.json` → verify signature (or skip if `HEBBS_DEV_MODULES=true`) → atomic move to `MODULES_STORE_DIR/<id>@<version>/` → dynamic import → `registerModule()` → insert `module_packages` row.
- **U3.2** — `app.unregisterModule(id)` — inverse of U2.1. Drop tools/skills/webhooks/routines/settings/module from their registries.
- **U3.3** — `DELETE /api/admin/modules/:id?version=X[&force=true]` — refuse if any `module_installs` row exists for `(id, version)` (or cascade through `installManager.uninstall` for every tenant if `force=true`), call `unregisterModule`, delete `module_packages` row, `rm -rf` the store directory.
- **U3.4** — `HEBBS_DEV_MODULES` env var + signature verification path. Production rejects unsigned bundles; dev accepts with a warning.

**Done when:** a developer can `curl -F file=@crm.hebbsmod /api/admin/modules/upload`, see CRM tools at `/api/admin/modules`, install for a tenant via the existing endpoint, use CRM, then `DELETE /api/admin/modules/crm?version=0.3.0` and have it gone (server-side).

### U4 — UI (3–5 days)

- **U4.1** — Static mount: serve `<storePath>/ui/*` at `/modules/<id>/ui/*` in `core`.
- **U4.2** — Shell "Apps" + "Connectors" screens, split by `kind`, doing the package×install join from §4. Two existing endpoints (`/api/admin/modules`, `/api/admin/installs`) already provide the data — UI work only.
- **U4.3** — Per-card state machine from §4.1: Installed / Available / Update available / Orphaned.
- **U4.4** — Drag-and-drop or file-picker upload affordance on the Apps screen → hits `/api/admin/modules/upload`.
- **U4.5** — Dynamic UI loading: `import(/* @vite-ignore */ "/modules/<id>/ui/index.mjs")` for each screen declared in `mod.ui.screens`. Render only when the module is installed for the current tenant.

**Done when:** an end user can drop a `.hebbsmod` onto the Apps screen, watch it appear as "Available", click Install, see CRM's nav entries appear in the shell, click around the CRM, click Uninstall, and watch everything disappear cleanly.

### What I'd prove first

U2.2 — the 50-line throwaway script. It validates the entire architecture for a day of work. If that demo runs, the rest is just paperwork (HTTP plumbing + UI). If it doesn't run, every later phase needs a different design.

---

## See also

- [`MODULES.md`](../MODULES.md) — the runtime `Module` spec
- [`BUILD-A-MODULE.md`](../BUILD-A-MODULE.md) — author-facing walkthrough
- `packages/@boringos/module-sdk/src/types.ts` — TypeScript types
- `packages/@boringos/core/src/module-admin-routes.ts` — current per-tenant install endpoints
- `packages/@boringos/db/src/schema/module-installs.ts` — `module_installs` table
- `packages/@boringos/agent/src/registries/install-manager.ts` — `InstallManager` implementation
