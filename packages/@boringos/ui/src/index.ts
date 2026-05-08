// Client (framework-agnostic, no React)
export { createBoringOSClient } from "./client.js";
export type {
  BoringOSClient,
  BoringOSClientConfig,
  TaskWithComments,
  ConnectorInfo,
  WorkflowInfo,
  HealthStatus,
  RuntimeModel,
  InboxItem,
} from "./client.js";

// Re-export the core domain types from @boringos/shared so consumers
// of the SDK don't need to depend on shared directly.
export type {
  Agent,
  AgentRun,
  Task,
  TaskComment,
} from "@boringos/shared";

// React provider
export { BoringOSProvider, useClient } from "./provider.js";
export type { BoringOSProviderProps } from "./provider.js";

// React hooks
export {
  useAgents,
  useTasks,
  useTask,
  useRuns,
  useRuntimes,
  useRuntimeModels,
  useSettings,
  useRoutines,
  useWorkflows,
  useWorkflowRuns,
  useBudgets,
  useCosts,
  useConnectors,
  useProjects,
  useGoals,
  useOnboarding,
  useEvals,
  useInbox,
  useEntityRefs,
  useSearch,
  useHealth,
} from "./hooks.js";
