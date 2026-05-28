---
"create-hebbs-module": minor
---

Add three recipe variants on top of the default `one-of-each` template (MDK T5.3) — pick via `--template <name>`:

- `data` — schema-heavy: two tenant-scoped tables (`<id>__demo_items` + `_categories`), `items.create` / `items.list` CRUD tools, no seeded agents/workflows/routines.
- `agent-only` — a seeded agent + skill, no tools, no schema (consumes framework primitives + other modules' tools).
- `connector-consumer` — imports `@boringos/connector-google`'s typed `GmailClient`, dispatches via `deps.getConnectorToken("google", "<id>")`, declares optional `email-send` capability in `module.json.dependsOn`.

Each variant emits a complete buildable module with the same file layout (`module.json`, `package.json`, `tsconfig.json`, `src/module.ts`, `src/index.ts`, `src/skills/<id>.md`, README, `.gitignore`). Migrations directory only created for templates that ship schema. Invalid template names error out before touching disk.
