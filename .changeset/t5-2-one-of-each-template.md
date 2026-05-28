---
"create-hebbs-module": minor
---

Extend `create-hebbs-module`'s default template to the "one-of-each" surface (MDK T5.2). Scaffolded modules now ship:

- 1 tool (`<id>.greet`, zod-validated)
- 1 `SKILL.md` at `src/skills/<id>.md`
- 1 demo table migration (`<id>__demo`) via `Module.schema`, plus a human-readable `src/migrations/001-demo.sql` mirror
- 1 seeded agent (`<DisplayName> Concierge`)
- 1 seeded workflow (`<id>.daily_greet`, one tool node)
- 1 seeded cron routine (`<id>-daily-9am`, fires the workflow daily at 09:00 UTC)
- `__moduleDir` set so the SKILL ref resolves correctly

Demo table names sanitise `-` → `_` so unquoted SQL identifiers stay valid for kebab-case module ids. T5.3 will layer recipe variants (data-only, agent-only, connector-consumer) on top.
