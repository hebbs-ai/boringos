import type { Hook, WakeReason, RunStatus, Agent } from "@boringos/shared";
import type { MemoryProvider } from "@boringos/memory";
import type {
  RuntimeExecutionContext,
  RuntimeExecutionResult,
  AgentRunCallbacks,
  CostEvent,
} from "@boringos/runtime";

// ── AgentEngine — the execution pipeline ─────────────────────────────────────

export interface AgentEngine {
  wake(request: WakeRequest): Promise<WakeupOutcome>;
  enqueue(wakeupId: string): Promise<string>;
  cancel(runId: string): Promise<void>;
  recoverPending(): Promise<RecoverPendingResult>;

  beforeRun: Hook<BeforeRunEvent>;
  buildContext: Hook<ContextBuildEvent>;
  afterRun: Hook<AfterRunEvent>;
  onCost: Hook<CostEvent>;
  onError: Hook<RunErrorEvent>;
}

// ── Wakeup ───────────────────────────────────────────────────────────────────

export interface WakeRequest {
  agentId: string;
  tenantId: string;
  reason: WakeReason;
  taskId?: string;
  payload?: Record<string, unknown>;
}

export type WakeupOutcome =
  | { kind: "created"; wakeupRequestId: string }
  | { kind: "coalesced"; existingWakeupRequestId: string }
  | { kind: "agent_not_found" }
  | { kind: "agent_not_invokable"; agentStatus: string };

export interface RecoverPendingResult {
  orphanedRuns: number;
  reenqueued: number;
}

// ── Context provider pipeline ────────────────────────────────────────────────

export interface ContextProvider {
  name: string;
  phase: "system" | "context";
  priority: number;
  provide(event: ContextBuildEvent): Promise<string | null>;
}

export interface ContextBuildEvent {
  agent: Agent;
  tenantId: string;
  runId: string;
  taskId?: string;
  taskOriginKind?: string;
  wakeReason: WakeReason;
  memory: MemoryProvider | null;
  previousSessionId?: string;
  previousSessionSummary?: string;
  callbackUrl: string;
  callbackToken: string;
  wakeCommentId?: string;
}

// ── Run lifecycle ────────────────────────────────────────────────────────────

export interface RunLifecycle {
  create(input: CreateRunInput): Promise<string>;
  updateStatus(runId: string, status: RunStatus, extra?: RunStatusExtra): Promise<void>;
  appendLog(runId: string, line: string): Promise<void>;
  appendStderr(runId: string, line: string): Promise<void>;
}

export interface CreateRunInput {
  agentId: string;
  tenantId: string;
  wakeupRequestId: string;
  taskId?: string;
}

export interface RunStatusExtra {
  exitCode?: number;
  error?: string;
  errorCode?: string;
  sessionId?: string;
  usage?: Record<string, unknown>;
}

// ── Hook event types ─────────────────────────────────────────────────────────

export interface BeforeRunEvent {
  agentId: string;
  tenantId: string;
  runId: string;
  taskId?: string;
}

export interface AfterRunEvent {
  agentId: string;
  tenantId: string;
  runId: string;
  taskId?: string;
  /** task_24 — wake-owner (from wake-context). Drives whether the
   *  auto-checkpoint hook routes to a session log under
   *  users/<owner>/sessions/ vs the task log under tasks/<id>/. */
  ownerUserId?: string;
  /** task_24 — copilot session id when this task is part of a
   *  session. Presence + ownerUserId routes the checkpoint to the
   *  session log. */
  sessionId?: string;
  result: RuntimeExecutionResult;
}

export interface RunErrorEvent {
  agentId: string;
  tenantId: string;
  runId: string;
  taskId?: string;
  /** task_24 — see AfterRunEvent. */
  ownerUserId?: string;
  sessionId?: string;
  error: Error;
}

// ── Agent run job — the queue message shape ──────────────────────────────────

export interface AgentRunJob {
  wakeupRequestId: string;
  agentId: string;
  tenantId: string;
  wakeReason: WakeReason;
  taskId?: string;
  payload?: Record<string, unknown>;
}
