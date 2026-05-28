# create-hebbs-module

## 0.4.0

### Minor Changes

- 7e3758d: Add three recipe variants on top of the default `one-of-each` template (MDK T5.3) — pick via `--template <name>`:

  - `data` — schema-heavy: two tenant-scoped tables (`<id>__demo_items` + `_categories`), `items.create` / `items.list` CRUD tools, no seeded agents/workflows/routines.
  - `agent-only` — a seeded agent + skill, no tools, no schema (consumes framework primitives + other modules' tools).
  - `connector-consumer` — imports `@boringos/connector-google`'s typed `GmailClient`, dispatches via `deps.getConnectorToken("google", "<id>")`, declares optional `email-send` capability in `module.json.dependsOn`.

  Each variant emits a complete buildable module with the same file layout (`module.json`, `package.json`, `tsconfig.json`, `src/module.ts`, `src/index.ts`, `src/skills/<id>.md`, README, `.gitignore`). Migrations directory only created for templates that ship schema. Invalid template names error out before touching disk.

## 0.3.0

### Minor Changes

- 6c61b4a: Extend `create-hebbs-module`'s default template to the "one-of-each" surface (MDK T5.2). Scaffolded modules now ship:

  - 1 tool (`<id>.greet`, zod-validated)
  - 1 `SKILL.md` at `src/skills/<id>.md`
  - 1 demo table migration (`<id>__demo`) via `Module.schema`, plus a human-readable `src/migrations/001-demo.sql` mirror
  - 1 seeded agent (`<DisplayName> Concierge`)
  - 1 seeded workflow (`<id>.daily_greet`, one tool node)
  - 1 seeded cron routine (`<id>-daily-9am`, fires the workflow daily at 09:00 UTC)
  - `__moduleDir` set so the SKILL ref resolves correctly

  Demo table names sanitise `-` → `_` so unquoted SQL identifiers stay valid for kebab-case module ids. T5.3 will layer recipe variants (data-only, agent-only, connector-consumer) on top.

## 0.2.0

### Minor Changes

- ef6fd4f: New package `create-hebbs-module` (lives at `packages/@boringos/create-hebbs-module/`). Invoked via `pnpm create hebbs-module <id>` or `npm create hebbs-module <id>` — emits a minimum-viable Hebbs module on disk: `module.json`, `package.json` (pinned to published `@boringos/module-sdk` and `@boringos/hebbs-cli`), `tsconfig.json`, `src/module.ts` (one tool + one skill), `src/index.ts`, `README.md`, `.gitignore`. Rejects invalid ids before touching disk; refuses to overwrite existing modules. The T5.2 "one-of-each" template (UI, widget, seeded agent/workflow/routine, demo schema) lands on top of this in the next iteration. MDK T5.1.
