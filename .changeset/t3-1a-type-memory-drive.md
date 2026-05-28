---
"@boringos/module-sdk": minor
---

Type `ModuleFactoryDeps.memory` as `MemoryProvider` (from `@boringos/memory`) and `ModuleFactoryDeps.drive` as `StorageBackend` (from `@boringos/drive`) — replacing the pre-MDK `unknown` casts (MDK T3.1a, per the T0.4 audit). Both packages are declared as **optional** peer dependencies (`peerDependenciesMeta.optional: true`), so modules that don't consume memory or storage don't need to install them. Cycle-free: neither package depends on `@boringos/module-sdk`.
