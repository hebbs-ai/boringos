# Blocker — task_17: Tenant settings manifest (`app.setting()` builder)

> **Why now:** the only residual from [`task_04`](task_04_admin_settings_cron_workflow.md)
> not absorbed by [`task_15`](task_15_agents_screen_polish.md) or
> [`task_16`](task_16_shell_information_architecture.md). Settings has
> shrunk to General + Branding + app-contributed panels, but apps have
> no way to declare typed tenant‑level config that the host shell can
> render automatically. Every app today either ships its own React
> panel via `useSlot("settingsPanels")` (heavyweight) or asks
> operators to call `PATCH /api/admin/settings` by hand
> (operator-hostile). Examples that exist today and dodge the gap:
>
> - `agents_paused: "true"` — the global pause toggle. Hardcoded into
>   `Settings/AgentsPanel.tsx`.
> - `inbox.replier.proposeSlots` — the calendar opt-in from
>   [`task_03`](task_03_calendar_schedule_from_inbox.md). No UI today;
>   admin has to curl.
>
> Without a manifest, every new app-level toggle is either a custom
> panel or a CLI exercise. With one, `app.setting({...})` declares a
> typed key and the shell renders it inside General with the right
> input type, validation, default, and gating.

> **Depends on:** none. The `tenant_settings` table already exists
> (`packages/@boringos/db/src/schema/tenants.ts:12`); this is purely
> SDK + shell wiring.

---

## 0. What's already there

- **Storage**: `tenantSettings` table with `(tenantId, key, value)`
  rows. Used today for `agents_paused`, `inbox.replier.proposeSlots`,
  and a handful of others. Values are `text` (everything serialises
  to string).
- **Read/write API**: `GET /api/admin/settings` (returns the
  flat `Record<string, string | null>`),
  `PATCH /api/admin/settings` (merge-update).
- **Hook**: `useSettings()` in `@boringos/ui` already wraps these.
- **App SDK shape**: `AppDefinition` in
  `packages/@boringos/app-sdk/src/define-app.ts:80`. Today it
  has `agents`, `workflows`, `contextProviders`, `routes`, lifecycle
  hooks. No `settings` field.
- **Module SDK**: v2 `Module` in `module-sdk/src/types.ts` is the
  long-term north star (per task_12). Whatever shape we ship for
  apps must collapse cleanly into Modules at v1 cutover.

---

## 1. The gap

Concretely missing:

1. **Declaration**: an app cannot say "I have a tenant-level boolean
   called `inbox.replier.proposeSlots`, default false, label
   'Propose calendar slots in replies', admin only."
2. **Rendering**: the General tab of Settings doesn't iterate over
   declared settings — it shows a fixed Tenant name / Your role /
   Email block. Adding a row today is a code change.
3. **Validation**: nothing stops a value going in that the app
   doesn't expect. Apps defensively re-parse on every read.
4. **Gating**: every key today is implicitly admin-only. There's no
   primitive for "user-scoped" or "staff-readable" settings.

---

## 2. Proposed design

### 2a. `SettingDefinition` shape

Add to `@boringos/app-sdk/src/define-app.ts`:

```ts
export type SettingType =
  | "string"
  | "boolean"
  | "number"
  | "select"
  | "longtext"
  | "secret";

export type SettingScope = "tenant" | "user";

export interface SettingDefinition {
  /** Storage key. Convention: `<appId>.<dotted.path>`. */
  key: string;
  /** Display label in the Settings UI. */
  label: string;
  /** Help text shown beneath the input. */
  description?: string;
  /** Input type. Drives the UI widget + serialisation. */
  type: SettingType;
  /** For type: "select", the allowed options. */
  options?: Array<{ value: string; label: string }>;
  /** Default applied when the row is missing. */
  default?: string | number | boolean;
  /** Who can read/write. Default: tenant-scoped, admin-only. */
  scope?: SettingScope;
  /** Required role to edit. Default: "admin". */
  editableBy?: "admin" | "staff" | "member";
  /** Required role to read. Default: same as editableBy. */
  readableBy?: "admin" | "staff" | "member";
  /** Optional Zod-style validator (kept loose; app provides regex/checker). */
  validate?: (value: unknown) => string | null;
}
```

### 2b. `AppDefinition.settings` field

```ts
export interface AppDefinition {
  // ... existing fields ...
  settings?: SettingDefinition[];
}
```

Apps declare:

```ts
export default defineApp({
  id: "inbox",
  settings: [
    {
      key: "inbox.replier.proposeSlots",
      label: "Propose calendar slots in replies",
      description:
        "When the replier drafts a reply that asks to schedule, append two free slots from your calendar.",
      type: "boolean",
      default: false,
    },
    {
      key: "inbox.triage.autoArchive",
      label: "Auto-archive low-priority mail",
      type: "select",
      options: [
        { value: "off", label: "Off" },
        { value: "promotions", label: "Promotions only" },
        { value: "promotions_social", label: "Promotions + Social" },
      ],
      default: "off",
    },
  ],
});
```

### 2c. v2 Module parity

The `Module` interface (`module-sdk/src/types.ts`) gets the same
field with the same shape. At v1 cutover, the AppDefinition path
collapses into Module. Same `SettingDefinition` type lives in a
shared package (likely `@boringos/shared` or its own
`@boringos/setting-sdk`) so both surfaces import it.

### 2d. Registry + read API

The host bootstraps a `SettingRegistry` that aggregates definitions
from every installed app + module. The registry exposes:

```ts
class SettingRegistry {
  list(): SettingDefinition[];
  get(key: string): SettingDefinition | undefined;
  byApp(appId: string): SettingDefinition[];
  validateValue(key: string, value: unknown): string | null;
  defaults(): Record<string, string>;
}
```

Two new admin routes:

- `GET /api/admin/settings/manifest` → flat array of every declared
  `SettingDefinition` for this tenant's installed apps + modules.
- `PATCH /api/admin/settings` (existing) — extended to validate
  against the registry. Reject on unknown keys; reject on invalid
  values with the validator's message.

### 2e. Shell rendering

`screens/Settings.tsx` General tab grows three sub-sections:

- **Tenant** — name, default runtime, default model.
- **Apps** — auto-generated from manifest, grouped by `appId` derived
  from the key prefix. Each setting is a labelled input with help
  text + revert-to-default button.
- **Modules** — same, for v2 modules.

A small generic `<SettingInput>` component switches on `type`:

| type | widget |
|---|---|
| `boolean` | Toggle |
| `string` | Single-line text input |
| `longtext` | Multi-line textarea |
| `number` | Number input with min/max |
| `select` | Native select |
| `secret` | Password input + reveal toggle |

For the operator: every setting has a value source label
(`default` / `tenant override` / `app default`) so it's obvious why
a flag is on or off.

---

## 3. Migration of existing keys

Before rolling out the manifest, declare the keys we already use so
they get UI for free:

| Key | App / Module | Type | Default |
|---|---|---|---|
| `agents_paused` | framework | `boolean` | `false` |
| `inbox.replier.proposeSlots` | inbox | `boolean` | `false` |
| `inbox.triage.autoArchive` | inbox | `select` | `off` |
| (anything else found by grepping `tenant_settings` reads) | — | — | — |

Migrating means: add a `settings` array on the relevant app/module,
remove the hardcoded toggle in `Settings/AgentsPanel.tsx` (the
auto-rendered panel takes over), and verify the resulting UI matches.

---

## 4. Phases

### Phase 1 — SDK shape
1. `SettingDefinition` + extend `AppDefinition` and `Module`.
2. Tests covering type discrimination + defaults serialisation.

### Phase 2 — Registry + admin routes
3. `SettingRegistry` built at boot from installed apps/modules.
4. `GET /api/admin/settings/manifest`.
5. `PATCH /api/admin/settings` validates against registry.

### Phase 3 — Shell auto-render
6. `<SettingInput>` widget per type.
7. Manifest hook in `@boringos/ui` (`useSettingsManifest()`).
8. General tab renders auto-grouped sections.

### Phase 4 — Migrate existing keys
9. Declare `agents_paused`, replier slots, triage auto-archive.
10. Delete the hardcoded toggle UI in `Settings/AgentsPanel.tsx`.
11. Smoke-test both admin and non-admin renders.

---

## 5. Open questions

- **Where does the type live** — `@boringos/shared`,
  `@boringos/app-sdk`, or a new `@boringos/setting-sdk`? Lean toward
  `@boringos/shared` so both app-sdk and module-sdk import without
  cross-deps.
- **Per-user settings** (`scope: "user"`) — needs a new
  `user_tenant_settings` table or a `user_id NULL` column on the
  existing one. Defer until the first app actually wants it; mark
  `user` scope as `// reserved` in the type for now.
- **Secrets** (`type: "secret"`) — straightforward to render as
  password input, but we should NOT round-trip the value to the
  client on read. Manifest carries `hasValue: boolean`, not the
  value itself; `PATCH` is write-only. This stops accidental leaks
  via the React DevTools / network tab.
- **Validator serialisation** — the function on `SettingDefinition`
  doesn't survive the wire. Either keep validation server-side only
  (apps register their validators via a separate registry) or
  mirror a small subset of validators on the client (regex,
  min/max, enum). Pick when the first app actually needs more than
  the type-driven validation.

---

## 6. Pointers

- App-SDK shape today: `packages/@boringos/app-sdk/src/define-app.ts:80`
- Module-SDK shape today: `packages/@boringos/module-sdk/src/types.ts:430`
- Existing settings storage: `packages/@boringos/db/src/schema/tenants.ts:12`
- Existing read/write hook: `packages/@boringos/ui/src/hooks.ts` (`useSettings`)
- Existing General tab rendering: `packages/@boringos/shell/src/screens/Settings.tsx`
- v1→v2 collapse plan (Module north star): `task_12_greenfield_rebuild.md`
