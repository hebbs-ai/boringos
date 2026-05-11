import type { SkillProvider, WakeReason } from "@boringos/shared";

// ── Runtime types ────────────────────────────────────────────────────────────

export const RUNTIME_TYPES = [
  "claude",
  "chatgpt",
  "gemini",
  "ollama",
  "command",
  "webhook",
] as const;

export type RuntimeType = (typeof RUNTIME_TYPES)[number];

// ── RuntimeModule — the core interface every runtime must implement ───────────

export interface RuntimeModule extends SkillProvider {
  readonly type: string;

  execute(
    ctx: RuntimeExecutionContext,
    callbacks: AgentRunCallbacks,
  ): Promise<RuntimeExecutionResult>;

  testEnvironment(config: Record<string, unknown>): Promise<RuntimeTestResult>;

  models?: RuntimeModel[];
  listModels?: () => Promise<RuntimeModel[]>;
}

// ── Execution context — what gets passed to the runtime ──────────────────────

export interface RuntimeExecutionContext {
  runId: string;
  agentId: string;
  tenantId: string;
  taskId?: string;
  wakeReason?: WakeReason;

  config: Record<string, unknown>;

  systemInstructions?: string;
  contextMarkdown: string;

  extraEnv?: Record<string, string>;
  previousSessionId?: string;

  callbackUrl: string;
  callbackToken: string;

  workspaceCwd?: string;
  workspaceBranch?: string;
}

// ── Execution result ─────────────────────────────────────────────────────────

export interface RuntimeExecutionResult {
  exitCode: number;
  sessionId?: string;
  errorMessage?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  };
  costUsd?: number;
  model?: string;
  provider?: string;
}

// ── Callbacks — streaming interface from runtime to engine ───────────────────

export interface AgentRunCallbacks {
  onOutputLine(line: string): void | Promise<void>;
  onStderrLine?(line: string): void | Promise<void>;
  onCostEvent(event: CostEvent): void;
  onComplete(result: CompletionResult): void;
  onError(error: Error): void;
}

export interface CostEvent {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  model: string;
  costUsd?: number;
}

export interface CompletionResult {
  exitCode: number;
  sessionId?: string;
  summary?: string;
}

// ── Health and diagnostics ───────────────────────────────────────────────────

export const RUNTIME_HEALTH_STATUSES = [
  "unchecked",
  "healthy",
  "degraded",
  "offline",
] as const;

export type RuntimeHealthStatus = (typeof RUNTIME_HEALTH_STATUSES)[number];

export interface RuntimeTestCheck {
  code: string;
  level: "info" | "warn" | "error";
  message: string;
  hint?: string;
}

export interface RuntimeTestResult {
  status: "pass" | "warn" | "fail";
  checks: RuntimeTestCheck[];
  testedAt: string;
}

export interface RuntimeModel {
  id: string;
  label: string;
}

// ── RuntimeRegistry — injectable runtime lookup ──────────────────────────────

export interface RuntimeRegistry {
  register(module: RuntimeModule): void;
  get(type: string): RuntimeModule | undefined;
  list(): RuntimeModule[];
  has(type: string): boolean;
}
