# Task 22 — Module Packages (`.hebbsmod` upload + dynamic install)

> **Implement LAYER 1 + LAYER 2 from [`docs/install-flow.md`](../install-flow.md).**
> Today's install/uninstall (LAYER 3) flips a per-tenant row and runs
> the migrations; the module's code is statically imported in
> `scripts/dev-server.mjs` at boot. The target is a WordPress/Shopify-style
> flow: author runs `pnpm build`, a `.hebbsmod` zip drops out, admin
> uploads it via the Apps screen, framework dynamic-imports + registers
> + runs migrations, end users click Install per tenant. Uninstall and
> Delete fully tear down. **Re-install requires re-upload.**

---

## Status

| Field | Value |
|---|---|
| **State** | SHIPPED |
| **Owner** | parag |
| **Branch** | `main` (small, sequential commits per phase) |
| **Started** | 2026-05-11 |
| **Last updated** | 2026-05-11 |
| **Closing commit** | _<u5-commit-sha>_ |
| **Estimated effort** | 10–15 dev-days across 5 phases; U2.2 was the 1-day go/no-go gate |
| **Prerequisites** | task_21 landed (single Module system, no v1 surface). Per-tenant install/uninstall works. |
| **Spec** | [`docs/install-flow.md`](../install-flow.md) — read this first for the architecture |
| **Touches docs** | [`BUILD-A-MODULE.md`](../../BUILD-A-MODULE.md) (author-facing), [`MODULES.md`](../../MODULES.md) (`kind` field), [`install-flow.md`](../install-flow.md) (status banner updated) |

---

## 1. The principle

What the user actually clicks once this lands:

```
Author              Admin                    User
─────────────       ──────────────────       ─────────
pnpm build          Drop .hebbsmod onto      Click Install
  ↓                 Apps screen              on the module card
crm-0.3.0           ↓                        ↓
.hebbsmod           POST /api/admin/         POST /api/admin/
appears in dist     modules/upload           modules/:id/install
                    ↓                        ↓
                    extracted, validated,    migrations applied,
                    dynamic-imported,        lifecycle.onInstall
                    registered host-wide     runs, tenant active
```

Three independent layers (per `install-flow.md`):
- **LAYER 1** — package on disk (`module_packages` row + extracted bundle dir)
- **LAYER 2** — host process knows about the module (tools/skills/webhooks/routines registered in-memory)
- **LAYER 3** — per-tenant install (already shipped)

This task delivers LAYER 1 + LAYER 2 + the cutover so CRM (and any future third-party module) ships as a `.hebbsmod` artifact rather than a workspace dependency.

---

## 2. Current state — gap analysis

| Capability | Status | File pointer |
|---|---|---|
| Module shape (`Module`, `ToolRegistry`, `SkillRegistry`) | ✅ Shipped | `packages/@boringos/module-sdk/src/types.ts` |
| Per-tenant install/uninstall + lifecycle hooks | ✅ Shipped | `packages/@boringos/agent/src/registries/install-manager.ts` |
| `module_installs` table | ✅ Shipped | `packages/@boringos/db/src/schema/module-installs.ts` |
| `module_migrations` table | ✅ Shipped | `packages/@boringos/db/src/schema/module-migrations.ts` |
| Webhook mount convention `/api/webhooks/<id>/<event>` | ✅ Shipped | `boringos.ts` boot loop |
| Module-wiring loop callable post-`listen()` | ❌ Missing — inline at `boringos.ts:272` | needs U2.1 |
| `module_packages` table | ❌ Missing | U1.2 |
| `.hebbsmod` bundle format + `pack-hebbsmod` script | ❌ Missing | U1.3 |
| `POST /api/admin/modules/upload` | ❌ Missing | U3.1 |
| `DELETE /api/admin/modules/:id?version=…` | ❌ Missing | U3.3 |
| Hot UI loading from `/modules/:id/ui/*` | ❌ Missing — shell statically bundles plugin UIs via `modules.config.ts` | U4 |
| `kind: "connector" \| "module" \| "hybrid"` field | ❌ Missing | U1.1 |
| Auto-pack on every module build | ❌ Missing | U1.4 ← **user's explicit ask** |

Today CRM is wired in `scripts/dev-server.mjs` via `import { createCrmModule } from "@boringos-crm/server"`. Click-Install only flips LAYER 3. Click-Uninstall only flips LAYER 3. The CRM code stays in process memory regardless.

---

## 3. The plan — 5 phases

### U1 — Foundations (1–2 days, zero behaviour change)

Goal: every artifact the upload path will need exists, but the framework doesn't use them yet.

- **U1.1** — Add `kind?: "connector" | "module" | "hybrid"` to the `Module` interface in `packages/@boringos/module-sdk/src/types.ts`. Optional with the inference rule from `install-flow.md` §1.3 (`oauth && !schema → connector`, etc.). Add a one-paragraph section to [`MODULES.md`](../../MODULES.md).

- **U1.2** — Add `module_packages` Drizzle table:
  ```ts
  // packages/@boringos/db/src/schema/module-packages.ts
  export const modulePackages = pgTable("module_packages", {
    id: text("id").notNull(),                       // module id
    version: text("version").notNull(),             // semver
    kind: text("kind").notNull(),                   // connector | module | hybrid
    storePath: text("store_path").notNull(),        // MODULES_STORE_DIR/<id>@<version>/
    contentHash: text("content_hash").notNull(),    // sha256 of the .hebbsmod bytes
    signaturePublisherId: text("signature_publisher_id"), // null in dev mode
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
    // composite PK on (id, version)
  });
  ```
  Export from `schema/index.ts`. Generate the migration in `migrate.ts`.

- **U1.3** — Build the `pack-hebbsmod` CLI inside `@boringos/module-sdk`:
  - Input: a module package path (defaults to `cwd`).
  - Reads the package's `module.ts` / `module.json` for id + version.
  - esbuild bundles the module's TS into `dist/index.mjs` with `@boringos/*` marked external.
  - Reads `module.json` (or generates one from the Module manifest's static fields).
  - Bundles `skills/`, `migrations/`, `ui/` (if present).
  - Zips with `module.json` at the root → `dist/<id>-<version>.hebbsmod`.
  - Computes + prints the SHA-256.
  - Exit code 0 on success, non-zero on validation failures (missing id, bad semver, oversized bundle).

- **U1.4** — **Auto-pack: bake `.hebbsmod` generation into every module's build.** Two options to evaluate in the PR; recommend (b):

  | Option | Description | Pros | Cons |
  |---|---|---|---|
  | (a) Postbuild hook per package | Each module's `package.json` adds `"postbuild": "pack-hebbsmod"`. `pnpm -r build` then auto-packs every module. | Idiomatic. One-line per package. | Touches every module's package.json. |
  | (b) Workspace orchestrator (RECOMMENDED) | Root `scripts/pack-modules.mjs` walks workspaces, finds packages with a `module.ts`, runs `pack-hebbsmod` on each. Wired as `pnpm pack:modules` and chained from root `build` script. | Zero per-package config. Discovers new modules automatically. | Slight magic. |

  **The user explicitly asked: every module must auto-create its `.hebbsmod`.** Whichever option lands, the contract is: after `pnpm -r build`, every standalone module package has a fresh `<id>-<version>.hebbsmod` in its `dist/`.

- **U1.5** — **Update [`BUILD-A-MODULE.md`](../../BUILD-A-MODULE.md)**: add a "How to ship" section. Documents the `pack-hebbsmod` output, the new authoring flow (write code → `pnpm build` → upload the artifact), and the `kind` field. Keep the "minimal Module" walkthrough at the top; append the packaging + upload story at the bottom.

- **U1.6** — Generate `.hebbsmod` fixtures: run `pack-hebbsmod` against `boringos-crm/packages/server/` and check the artifact into a fixture dir (`tests/fixtures/crm-0.x.x.hebbsmod`). U2 + U3 need a real artifact to load.

**Done when:** `pnpm -r build` produces `crm-0.x.x.hebbsmod` in `boringos-crm/packages/server/dist/`; `unzip -l` shows `module.json` + `index.mjs` + `skills/` + `migrations/` + (if applicable) `ui/`. Nothing in the running framework changes. BUILD-A-MODULE.md is updated.

---

### U2 — Proof of concept: runtime register (1 day, **GO/NO-GO GATE**)

Per `install-flow.md` §9 — the cheapest way to validate the entire architecture. If U2.2's demo fails, the rest of the plan needs rethinking.

- **U2.1** — Refactor the module-wiring loop in `boringos.ts` (around line 272 today — register tools/skills/webhooks/routines/settings for each module) into:
  ```ts
  app.registerModule(mod: Module, factoryDeps: ModuleFactoryDeps): Promise<void>
  ```
  Boot still calls it in a loop; same behaviour as today. Add `app.unregisterModule(id: string)` as a stub (inverse to be filled in U3.2).

- **U2.2** — Write `scripts/try-runtime-install.mjs` (the doc's 50-line throwaway script):
  1. Remove CRM from the static module list in `dev-server.mjs` (or use a flag to skip).
  2. `app.listen()` first.
  3. `import("file:///path/to/crm-0.x.x.hebbsmod's extracted index.mjs")`.
  4. Take the default export, call `app.registerModule(mod, deps)`.
  5. `curl -X POST http://localhost:3030/api/tools/crm.contacts.create ...` from the same script.

**Done when:** curl returns `200 {ok: true, result: {...}}` in a single terminal session, and the run shows in `/api/admin/tool-calls`.

**If this fails**, suspect: Hono mid-flight route mounting, factory deps captured at boot time, registry mutation contracts. Surface the specific failure mode in the task log and replan U3.

---

### U3 — Real HTTP upload + delete path (3–5 days)

- **U3.1** — `POST /api/admin/modules/upload`:
  - New file `module-package-routes.ts` (or extend `module-admin-routes.ts`).
  - Multipart receive → SHA-256 hash of bytes → extract to temp → parse `module.json` → validate (id pattern, semver, required fields) → verify Ed25519 signature OR accept with warning when `HEBBS_DEV_MODULES=true` → atomic move to `MODULES_STORE_DIR/<id>@<version>/` → dynamic import `index.mjs` → call `app.registerModule(...)` → insert `module_packages` row.
  - Returns the parsed manifest + the storePath for client confirmation.

- **U3.2** — `app.unregisterModule(id: string)` — inverse of U2.1:
  - Remove tools from `toolRegistry` (filter `moduleId === id`).
  - Remove skills from `skillRegistry`.
  - Unmount webhook handlers.
  - Stop + remove routines.
  - Drop module from `moduleRegistry`.
  - Unmount static UI route (when U4 lands).
  - Return a `restartRecommended: true` flag — Node ESM doesn't unload (see §4 risks).

- **U3.3** — `DELETE /api/admin/modules/:id?version=…&force=true|false`:
  - If `module_installs` rows reference `(id, version)` and `force=false` → 409 with the list of tenants.
  - If `force=true` → walk tenants and call `installManager.uninstall(id, tenant)` for each first.
  - Then call `app.unregisterModule(id)`.
  - Delete `module_packages` row.
  - `rm -rf MODULES_STORE_DIR/<id>@<version>/`.

- **U3.4** — Signature path:
  - `HEBBS_DEV_MODULES=true` env var. In production, reject unsigned bundles or bundles signed by unknown publishers.
  - Publisher key list stored in `framework_settings` table OR a config file. The spec doesn't pin this — recommend config file for now, settings-table later.

- **U3.5** — Audit log entries for upload/delete (write to `activity_log` table with `actor_type: "user"`, `action: "module.uploaded" / "module.deleted"`).

**Done when:** the full curl-only roundtrip works:
```bash
curl -F file=@crm-0.x.x.hebbsmod  http://localhost:3030/api/admin/modules/upload  → 201
curl /api/admin/modules                                                            → CRM listed
curl -X POST /api/admin/modules/crm/install                                        → tenant install
curl -X POST /api/tools/crm.deals.create ...                                       → 200
curl -X DELETE /api/admin/modules/crm?version=0.x.x                                → 409 (still installed)
curl -X POST /api/admin/modules/crm/uninstall                                      → tenant uninstall
curl -X DELETE /api/admin/modules/crm?version=0.x.x                                → 200, gone
```

---

### U4 — UI (3–5 days)

- **U4.1** — Static UI mount: serve `<storePath>/ui/*` at `/modules/:id/ui/*` in `core` (Hono static handler). Cache headers tuned for hashed asset filenames.

- **U4.2** — Shell "Apps" + "Connectors" screens. Two endpoints already exist (`/api/admin/modules`, `/api/admin/installs`); the UI work is the join + the per-card state machine.

- **U4.3** — Per-card state machine from `install-flow.md` §4.1: **Installed** (Configure/Uninstall) / **Available** (Install) / **Update available** (Update) / **Orphaned** (Force-uninstall).

- **U4.4** — Drag-and-drop or file-picker upload affordance on the Apps screen → `POST /api/admin/modules/upload`. Progress indicator. Show extracted manifest preview before final commit (publisher, kind, depends-on, capability badges).

- **U4.5** — Dynamic UI loading: replace `modules.config.ts`'s static workspace links with runtime `import(/* @vite-ignore */ "/modules/<id>/ui/index.mjs")` keyed off the install state. Render the module's UI screens only when the module is installed for the current tenant.

**Done when:** an end user can drop a `.hebbsmod` onto the Apps screen, see "Available", click Install, watch the CRM nav group appear in the sidebar, click around, then Uninstall + Delete and watch everything disappear cleanly (with the "Restart host to fully unload" banner).

---

### U5 — End-to-end cutover (1–2 days)

The point of the whole exercise. Switch CRM from "statically wired via workspace dependency" to "upload-only".

- **U5.1** — Remove `createCrmModule` from `scripts/dev-server.mjs`. Remove `@boringos-crm/server` workspace link from `boringos-framework` root.
- **U5.2** — Document the new dev flow in BUILD-A-MODULE.md: `pnpm build` in `boringos-crm` → `pnpm hebbs install crm-0.x.x.hebbsmod` (CLI) OR upload via Apps screen.
- **U5.3** — Decision: should built-in modules (framework, memory, drive, inbox, workflow, copilot, slack, google, triage, inbox-triage, inbox-replier) ALSO ship as `.hebbsmod` artifacts, or stay statically wired as "framework core"?
  - **Recommended:** built-ins stay statically wired. They're framework infrastructure, not third-party. The `.hebbsmod` path is for everything else.
  - **Alternative:** every module is uniform (.hebbsmod-based). Cleaner architecture but more boot complexity and slower startup.
- **U5.4** — Update `install-flow.md` status banner to "LAYER 1 + LAYER 2 shipped".

**Done when:** `git grep "createCrmModule"` in framework returns zero hits; a fresh clone + `pnpm install` + `pnpm dev` produces a framework with **only built-ins**; CRM only appears after `pack-hebbsmod` + upload.

---

## 4. Risks (from `install-flow.md` §8)

| Risk | Status / Mitigation |
|---|---|
| **Hot UI loading** — shell statically bundles plugin UIs today (`modules.config.ts` + `@boringos-crm/web` link + Tailwind `@source`) | Tackled in U4.5. Real engineering work — likely the longest single task. Module Federation is one path; raw dynamic ESM another. |
| **Trust** — uploaded zip = arbitrary server code | U3.4: signed-only in production, `HEBBS_DEV_MODULES=true` for dev. No in-process Node sandbox is realistic. |
| **Node ESM doesn't unload** — after `unregisterModule`, code stays in memory | Accept it. Show "Restart to fully free" banner after uninstall. Worker-thread isolation deferred to a future task. |
| **Refactor of `boringos.ts` module-wiring loop** | U2.1 — straightforward but mechanical (~200 lines). Make `factoryDeps` capturable + reusable. |
| **Vite + dynamic module URLs in dev** | Vite dev server needs to know about `/modules/*` paths. May need a dev-only middleware or vite plugin. Investigate during U4. |

---

## 5. Auto-pack design (the explicit ask)

> *"Ensure .hebbsmodule is baked in to every module that it auto creates with a script or something."*

The contract:

1. Every module package has a known shape: `package.json` with a `module.ts` (or `module.json`) declaring the `Module` manifest.
2. Running `pnpm -r build` from the framework root walks every workspace, builds, AND produces a `<id>-<version>.hebbsmod` in each module package's `dist/`.
3. The `.hebbsmod` is the deployable artifact; nothing else needs to leave the developer's machine.

Two implementations to weigh in U1.4:

**(a) Per-package postbuild hook** — opt-in via `package.json`:
```json
{
  "scripts": {
    "build": "tsc",
    "postbuild": "pack-hebbsmod"
  }
}
```

**(b) Workspace-level orchestrator** — zero per-package config:
```js
// scripts/pack-modules.mjs (run by root `pnpm pack:modules`,
// chained from root `pnpm build`)
const modulePackages = scanWorkspaces().filter(hasModuleEntry);
for (const pkg of modulePackages) {
  await runPackHebbsmod(pkg);
}
```

Recommend (b). New modules get packaged automatically the moment they ship a `module.ts`. No per-package opt-in to forget.

Either way, the SDK exposes `pack-hebbsmod` as a callable script:
```bash
pnpm exec pack-hebbsmod                  # in any module package
pnpm exec pack-hebbsmod ./packages/foo   # explicit path
```

---

## 6. Touch list — what gets changed

| Phase | New | Modified |
|---|---|---|
| U1 | `module-sdk/src/cli/pack-hebbsmod.ts`, `db/src/schema/module-packages.ts`, `scripts/pack-modules.mjs`, `tests/fixtures/crm-*.hebbsmod` | `module-sdk/src/types.ts` (`kind`), `db/src/schema/index.ts`, `db/src/migrate.ts`, `MODULES.md`, `BUILD-A-MODULE.md` |
| U2 | `scripts/try-runtime-install.mjs` (throwaway) | `boringos.ts` (extract `registerModule`/`unregisterModule`), `scripts/dev-server.mjs` (toggle for the demo) |
| U3 | `core/src/module-package-routes.ts` | `boringos.ts` (mount routes), `auth-middleware.ts` (multipart) |
| U4 | `shell/src/screens/Modules/*` (rebuild around upload), runtime UI loader hook | `shell/modules.config.ts` (remove static links once dynamic path works) |
| U5 | — | `scripts/dev-server.mjs`, `boringos-framework/package.json` (drop CRM workspace dep), `install-flow.md` (status banner) |

---

## 7. Done when (end-to-end demo)

Single-session demo proving the loop is real:

```
# 1. Author side
cd boringos-crm
edit packages/server/src/tools/contacts.ts
pnpm -r build
ls packages/server/dist/crm-0.x.x.hebbsmod   # ✓ artifact exists

# 2. Admin side (UI)
Open Apps screen → drag crm-0.x.x.hebbsmod onto drop zone
→ "Available" card appears with the manifest preview
→ click Install → "Installed" badge

# 3. User side (Copilot)
"Add parag@talker.network to CRM as Parag Arora at Talker"
→ 1 contact, 1 company, 1 deal created (the dedupe fix from task_21 still works)

# 4. Teardown
Click Uninstall → tenant data dropped, CRM nav group disappears
Click Delete → /modules/crm route 404s, module_packages row gone,
              /api/admin/modules no longer lists CRM
"Restart host to fully unload" banner shown

# 5. Re-install
Upload the same .hebbsmod again → "Available" → Install → CRM is back
```

Re-install requires re-upload. That's the design.

---

## 8. Status log

| Date | Phase | Status | Notes |
|---|---|---|---|
| 2026-05-11 | — | DRAFTED | Task created. Specced against `install-flow.md`. Auto-pack design captured. Awaiting kickoff. |
| 2026-05-11 | U5 | LANDED | CRM removed from static wiring. Framework boot now ships built-ins only. CRM installable via `boringos-crm/packages/server/dist/crm-0.2.0.hebbsmod` upload. Re-install requires re-upload — the design contract is real. |
