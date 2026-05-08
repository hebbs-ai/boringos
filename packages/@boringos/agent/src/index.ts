export type {
  AgentEngine,
  WakeRequest,
  WakeupOutcome,
  ContextProvider,
  ContextBuildEvent,
  RunLifecycle,
  CreateRunInput,
  RunStatusExtra,
  BeforeRunEvent,
  AfterRunEvent,
  RunErrorEvent,
  AgentRunJob,
} from "./types.js";

export { ContextPipeline } from "./context-pipeline.js";
export { createWakeup } from "./wakeup.js";
export { createRunLifecycle } from "./run-lifecycle.js";
export { createAgentEngine } from "./engine.js";
export type { AgentEngineConfig } from "./engine.js";

export { resolvePersonaRole, loadPersonaBundle, mergePersonaBundle } from "./persona-loader.js";

export {
  headerProvider,
  personaProvider,
  createTenantGuidelinesProvider,
  createDriveSkillProvider,
  memorySkillProvider,
  agentInstructionsProvider,
  protocolProvider,
  approvalsSkillProvider,
  sessionProvider,
  createTaskProvider,
  createCommentsProvider,
  memoryContextProvider,
  createApiCatalogProvider,
  chiefOfStaffProvider,
} from "./providers/index.js";
export type { ApiCatalogEntry, AgentDocs } from "./providers/index.js";

export { signCallbackToken, verifyCallbackToken } from "./jwt.js";
export type { CallbackTokenClaims } from "./jwt.js";

export { checkBudget } from "./budget.js";
export type { BudgetCheckResult } from "./budget.js";

export { provisionWorkspace, cleanupWorkspace } from "./workspace.js";
export type { WorkspaceConfig, WorkspaceResult } from "./workspace.js";

export { syncSkill, injectSkills } from "./skills.js";
export type { SkillSyncConfig, InjectedSkill } from "./skills.js";

export { createAgentFromTemplate, createTeam, buildOrgTree, BUILT_IN_TEAMS } from "./templates.js";
export type { AgentTemplateConfig, CreatedAgent, TeamTemplate, OrgNode } from "./templates.js";

export { findDelegateForTask, escalateToManager, createHandoffTask, validateReparenting } from "./hierarchy.js";
export type { DelegateQuery } from "./hierarchy.js";

export { createHierarchyProvider } from "./providers/hierarchy.js";

// v2 (Skills + Tools + Modules) — additive scaffolding. See
// docs/blockers/task_12_greenfield_rebuild.md. v1 surface above
// is unchanged; v2 lives alongside until the phased migration
// retires the v1 providers / connector registry / curl block.
export {
  createToolRegistry,
  createSkillRegistry,
  createModuleRegistry,
  dispatch,
  invoke,
  createSkillsProvider,
  createToolCatalogProvider,
} from "./v2/index.js";
export type {
  ToolRegistry,
  RegisteredTool,
  SkillRegistry,
  RegisteredSkill,
  ModuleRegistry,
  ModuleRegistryDeps,
  DispatchResult,
  DispatchDeps,
  DispatchOptions,
  SkillsProviderDeps,
  ToolCatalogProviderDeps,
} from "./v2/index.js";
