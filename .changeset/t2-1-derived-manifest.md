---
"@boringos/module-sdk": minor
---

`pack-hebbsmod` now derives the bundled `module.json` from the Module factory at pack time (MDK T2.1). Runtime fields (`id`, `name`, `version`, `description`, `kind`, `dependsOn`, `provides`, `defaultInstall`) come from the factory's returned Module; pack-time-only fields (`entry`, `ui`, `publisher`, `license`, `minFrameworkVersion`) come from the on-disk static `module.json` unchanged. Drift between the two is logged on stdout. Exports a new `mergeManifest(static, runtime)` helper for callers who need the merge logic standalone.
