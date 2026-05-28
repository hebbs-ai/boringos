// SPDX-License-Identifier: LGPL-3.0-or-later
//
// /module-sdk — public type surface for Modules.
//
// In this architecture, every component (connectors, apps, capabilities,
// built-in subsystems) is shaped as a `Module`. This package
// exports the types module authors implement. Runtime behaviour
// (registries, dispatch, prompt assembly) lives in
// @boringos/agent and @boringos/core.
//
// (see types.ts) until the phased
// migration in task_12 retires them.

export * from "./types.js";

// Explicit named re-export of ModuleKind for discoverability —
// consumers can `import type { ModuleKind } from "@boringos/module-sdk"`.
// (Also covered by the `export *` above; named here so it shows up
// directly in the package's public surface listing.)
export type { ModuleKind } from "./types.js";
export { inferModuleKind } from "./types.js";

// Convenience re-export so Module authors can write
//   import { z } from "@boringos/module-sdk";
// without taking a separate Zod dep. Zod is the canonical schema
// library for Tool inputs/outputs; the registry duck-types
// on `safeParse` so other libraries also work, but Zod is the
// blessed choice.
export { z } from "zod";

// Static `module.json` manifest schema (MDK T2.2). Consumed by
// `pack-hebbsmod`, the host install-manager, and third-party
// scaffolders.
export {
  ManifestSchema,
  parseManifest,
  compareSemver,
  checkMinFrameworkVersion,
  MODULE_ID_RE,
  SEMVER_RE,
  type Manifest,
} from "./manifest.js";
