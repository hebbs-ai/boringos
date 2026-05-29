---
"@boringos/hebbs-cli": minor
---

Codemod runner foundation + one bundled codemod (MDK T7.5).

- New `Codemod` interface (`id`, `description`, `extensions`, `transform`). Regex-driven by design — no `ts-morph` / `jscodeshift` / `babel` dep, so the CLI bundle stays slim.
- `runCodemod(codemod, { modulePath, write })` walks `src/**` filtered by extension and applies the transform. Dry-run by default; `--write` applies.
- Ships `moduleUiToPluginUi` — renames the deprecated `ModuleUI` import to `PluginUI` (the MDK T3.2 surface change). The structural slot move still needs a manual pass — see BUILD-A-MODULE.md — but this codemod handles the name churn.
- CLI: `hebbs codemod <module> --codemod <id> [--write]`. `hebbs codemod <module>` with no flags lists available codemods.
- Programmatic API exports `runCodemod`, `bundledCodemods`, `moduleUiToPluginUi`, plus the types.
