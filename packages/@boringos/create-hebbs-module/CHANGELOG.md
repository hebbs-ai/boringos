# create-hebbs-module

## 0.2.0

### Minor Changes

- ef6fd4f: New package `create-hebbs-module` (lives at `packages/@boringos/create-hebbs-module/`). Invoked via `pnpm create hebbs-module <id>` or `npm create hebbs-module <id>` — emits a minimum-viable Hebbs module on disk: `module.json`, `package.json` (pinned to published `@boringos/module-sdk` and `@boringos/hebbs-cli`), `tsconfig.json`, `src/module.ts` (one tool + one skill), `src/index.ts`, `README.md`, `.gitignore`. Rejects invalid ids before touching disk; refuses to overwrite existing modules. The T5.2 "one-of-each" template (UI, widget, seeded agent/workflow/routine, demo schema) lands on top of this in the next iteration. MDK T5.1.
