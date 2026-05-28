---
"@boringos/core": minor
---

`module-package-routes` (the `POST /api/admin/modules/upload` route) now enforces `module.json.minFrameworkVersion` at upload time using `checkMinFrameworkVersion` from `@boringos/module-sdk`. A new optional `frameworkVersion` field on `ModulePackageRoutesDeps` declares the host's version; when set, uploads of bundles requesting a higher minimum return `400 { error: "incompatible_framework", message: "<id>@<version>: module requires framework >= X, host is Y" }` before the bundle is moved to the store. Hosts that don't set `frameworkVersion` fall back to the pre-T2.3 behaviour (no check). MDK T2.3.
