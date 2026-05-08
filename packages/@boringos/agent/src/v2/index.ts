// SPDX-License-Identifier: MIT
//
// v2 entry — re-exports the Module / Tool / Skill registries.
//
// The v2 namespace is intentionally walled off from the v1 engine
// during the phased rebuild. v1 keeps using the existing
// providers / handlers / connector registry. v2 builds alongside
// in this directory, gets wired up as task_12's phases land, and
// eventually replaces the v1 surface.

export { createToolRegistry } from "./tool-registry.js";
export type {
  ToolRegistry,
  RegisteredTool,
} from "./tool-registry.js";

export { createSkillRegistry } from "./skill-registry.js";
export type {
  SkillRegistry,
  RegisteredSkill,
} from "./skill-registry.js";

export { createModuleRegistry } from "./module-registry.js";
export type {
  ModuleRegistry,
  ModuleRegistryDeps,
} from "./module-registry.js";

export { dispatch, invoke } from "./dispatcher.js";
export type {
  DispatchResult,
  DispatchDeps,
  DispatchOptions,
} from "./dispatcher.js";

export { createSkillsProvider } from "./skills-provider.js";
export type { SkillsProviderDeps } from "./skills-provider.js";
export { createToolCatalogProvider } from "./tool-catalog-provider.js";
export type { ToolCatalogProviderDeps } from "./tool-catalog-provider.js";
