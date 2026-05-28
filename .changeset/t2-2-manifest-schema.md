---
"@boringos/module-sdk": minor
---

Add `ManifestSchema` (a zod schema for `module.json`) and helpers `parseManifest`, `compareSemver`, `checkMinFrameworkVersion`, plus the `MODULE_ID_RE` / `SEMVER_RE` constants (MDK T2.2). Replaces the ad-hoc field-by-field validation that lived inside `pack-hebbsmod`. Third-party scaffolders and the host install-manager now have a single typed entry point for `module.json` validation, including the `minFrameworkVersion` install-time compatibility gate.
