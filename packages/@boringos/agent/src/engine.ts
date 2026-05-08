import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { agents, agentWakeupRequests, agentRuns, costEvents, tasks, tenantSettings } from "@boringos/db";
import type { MemoryProvider } from "@boringos/memory";
import type { RuntimeRegistry, AgentRunCallbacks, CostEvent } from "@boringos/runtime";
import type { StorageBackend } from "@boringos/drive";
import type { QueueAdapter } from "@boringos/pipeline";
// v1 connector registry removed — v2 modules are the only catalog now.
import { createInProcessQueue } from "@boringos/pipeline";
import { createHook, generateId } from "@boringos/shared";
import type { Hook } from "@boringos/shared";
import type {
  AgentEngine,
  WakeRequest,
  WakeupOutcome,
  BeforeRunEvent,
  ContextBuildEvent,
  AfterRunEvent,
  RunErrorEvent,
  AgentRunJob,
  RecoverPendingResult,
} from "./types.js";
import { ContextPipeline } from "./context-pipeline.js";
import { signCallbackToken } from "./jwt.js";
import { createWakeup } from "./wakeup.js";
import { createRunLifecycle } from "./run-lifecycle.js";
import {
  headerProvider,
  personaProvider,
  agentInstructionsProvider,
  sessionProvider,
  memoryContextProvider,
  createTenantGuidelinesProvider,
  createTaskProvider,
  createCommentsProvider,
  createHierarchyProvider,
} from "./providers/index.js";

export interface AgentEngineConfig {
  db: Db;
  runtimes: RuntimeRegistry;
  memory: MemoryProvider | null;
  drive: StorageBackend | null;
  pipeline: ContextPipeline;
  callbackUrl: string;
  jwtSecret: string;
  queue?: QueueAdapter<AgentRunJob>;
}

function registerDefaultProviders(pipeline: ContextPipeline, config: AgentEngineConfig): void {
  // Per-agent / per-run state providers. Module SKILL.md files
  // and the v2 tool catalog (added separately by core/boringos.ts)
  // cover the rest of the prompt surface.
  pipeline.add(headerProvider);
  pipeline.add(createHierarchyProvider({ db: config.db }));
  pipeline.add(personaProvider);
  pipeline.add(createTenantGuidelinesProvider({ db: config.db }));
  pipeline.add(agentInstructionsProvider);

  pipeline.add(sessionProvider);
  pipeline.add(createTaskProvider({ db: config.db }));
  pipeline.add(createCommentsProvider({ db: config.db }));
  pipeline.add(memoryContextProvider);
}

export function createAgentEngine(config: AgentEngineConfig): AgentEngine {
  const { db, runtimes, memory, pipeline, callbackUrl, jwtSecret } = config;
  const lifecycle = createRunLifecycle(db);

  // Register built-in providers (users' custom providers were already added to pipeline)
  registerDefaultProviders(pipeline, config);

  const beforeRun: Hook<BeforeRunEvent> = createHook();
  const buildContext: Hook<ContextBuildEvent> = createHook();
  const afterRun: Hook<AfterRunEvent> = createHook();
  const onCost: Hook<CostEvent> = createHook();
  const onError: Hook<RunErrorEvent> = createHook();

  // Queue adapter — defaults to in-process if none provided
  const queue = config.queue ?? createInProcessQueue<AgentRunJob>();

  // Register job processor
  queue.process(async (job) => {
    try {
      await executeJob(job);
    } catch (err) {
      await onError.run({
        agentId: job.agentId,
        tenantId: job.tenantId,
        runId: "",
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  });

  async function executeJob(job: AgentRunJob): Promise<void> {
    // Fetch agent
    const agentRows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, job.agentId), eq(agents.tenantId, job.tenantId)))
      .limit(1);

    const agent = agentRows[0];
    if (!agent) return;

    // Create run record
    const runId = await lifecycle.create({
      agentId: job.agentId,
      tenantId: job.tenantId,
      wakeupRequestId: job.wakeupRequestId,
      taskId: job.taskId,
    });

    await lifecycle.updateStatus(runId, "running");

    // Global agent pause check
    const pauseRows = await db.select().from(tenantSettings).where(
      and(eq(tenantSettings.tenantId, job.tenantId), eq(tenantSettings.key, "agents_paused")),
    ).limit(1);
    if (pauseRows[0]?.value === "true") {
      await lifecycle.updateStatus(runId, "skipped", { error: "All agents are paused for this tenant", errorCode: "agents_paused" });
      return;
    }

    // Per-agent pause check
    if (agent.status === "paused") {
      await lifecycle.updateStatus(runId, "skipped", { error: `Agent "${agent.name}" is paused`, errorCode: "agent_paused" });
      return;
    }

    // Budget check
    const { checkBudget } = await import("./budget.js");
    const budgetResult = await checkBudget(db, job.tenantId, job.agentId);
    if (!budgetResult.allowed) {
      await lifecycle.updateStatus(runId, "failed", { error: budgetResult.reason, errorCode: "budget_exceeded" });
      return;
    }

    // Fire beforeRun hooks
    await beforeRun.run({ agentId: job.agentId, tenantId: job.tenantId, runId, taskId: job.taskId });

    // Sessions are task-scoped. Every wake must be bound to a task;
    // the task's session_id is what we resume. Two different tasks for
    // the same agent get two different sessions — no transcript
    // bleed-through. See docs/blockers/task_02_session_per_task.md.
    if (!job.taskId) {
      await lifecycle.updateStatus(runId, "failed", {
        error: `Wake for agent ${job.agentId} has no taskId. Every wake must be bound to a task.`,
        errorCode: "missing_task_id",
      });
      return;
    }
    const taskRows = await db
      .select({ sessionId: tasks.sessionId })
      .from(tasks)
      .where(eq(tasks.id, job.taskId))
      .limit(1);
    const previousSessionId = taskRows[0]?.sessionId ?? undefined;

    // Generate signed callback JWT (4-hour expiry)
    const callbackToken = signCallbackToken(
      { runId, agentId: job.agentId, tenantId: job.tenantId },
      jwtSecret,
    );

    // Build context
    const contextEvent: ContextBuildEvent = {
      agent: {
        id: agent.id,
        tenantId: agent.tenantId,
        name: agent.name,
        role: agent.role,
        title: agent.title,
        icon: agent.icon,
        status: agent.status as "idle" | "running" | "paused" | "error" | "archived",
        reportsTo: agent.reportsTo,
        instructions: agent.instructions,
        runtimeId: agent.runtimeId,
        fallbackRuntimeId: agent.fallbackRuntimeId,
        budgetMonthlyCents: agent.budgetMonthlyCents,
        spentMonthlyCents: agent.spentMonthlyCents,
        pauseReason: agent.pauseReason,
        pausedAt: agent.pausedAt,
        permissions: agent.permissions as Record<string, unknown>,
        metadata: agent.metadata as Record<string, unknown> | null,
        lastHeartbeatAt: agent.lastHeartbeatAt,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      },
      tenantId: job.tenantId,
      runId,
      taskId: job.taskId,
      wakeReason: job.wakeReason,
      memory,
      previousSessionId,
      previousSessionSummary: undefined,
      callbackUrl,
      callbackToken,
    };

    await buildContext.run(contextEvent);

    const { systemInstructions, contextMarkdown } = await pipeline.build(contextEvent);

    // Resolve runtime — look up from DB if agent has a runtimeId, else default to claude
    let runtimeType = "claude";
    let runtimeConfig: Record<string, unknown> = {};
    if (agent.runtimeId) {
      const { runtimes: runtimesTable } = await import("@boringos/db");
      const rtRows = await db.select().from(runtimesTable).where(eq(runtimesTable.id, agent.runtimeId)).limit(1);
      if (rtRows[0]) {
        runtimeType = rtRows[0].type;
        runtimeConfig = (rtRows[0].config as Record<string, unknown>) ?? {};
        if (rtRows[0].model && !runtimeConfig.model) {
          runtimeConfig.model = rtRows[0].model;
        }
      }
    }
    const runtime = runtimes.get(runtimeType);
    if (!runtime) {
      await lifecycle.updateStatus(runId, "failed", { error: `No runtime found for type: ${runtimeType}` });
      return;
    }

    // Execute runtime
    let lastModel: string | undefined;

    const callbacks: AgentRunCallbacks = {
      async onOutputLine(line) {
        await lifecycle.appendLog(runId, line);
      },
      async onStderrLine(line) {
        await lifecycle.appendStderr(runId, line);
      },
      onCostEvent(event) {
        onCost.run(event);
        lastModel = event.model;
        db.insert(costEvents).values({
          id: generateId(),
          tenantId: job.tenantId,
          agentId: job.agentId,
          runId,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          model: event.model,
          costUsd: event.costUsd?.toString(),
        }).catch(() => {});
      },
      onComplete(result) {
        lifecycle.updateStatus(runId, result.exitCode === 0 ? "done" : "failed", {
          exitCode: result.exitCode,
          sessionId: result.sessionId,
        });

        // Persist model used on the run record
        const runModel = lastModel ?? (runtimeConfig.model as string | undefined);
        if (runModel) {
          db.update(agentRuns).set({ model: runModel, updatedAt: new Date() } as Record<string, unknown>)
            .where(eq(agentRuns.id, runId)).catch(() => {});
        }

        // Update wakeup status
        if (job.wakeupRequestId) {
          db.update(agentWakeupRequests)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(agentWakeupRequests.id, job.wakeupRequestId))
            .catch(() => {});
        }

        // Persist the session id back to the task. Next wake on this
        // same task will resume from this session; wakes on any other
        // task will start fresh.
        if (result.sessionId && job.taskId) {
          db.update(tasks)
            .set({ sessionId: result.sessionId, updatedAt: new Date() })
            .where(eq(tasks.id, job.taskId))
            .catch(() => {});
        }
      },
      onError(error) {
        lifecycle.updateStatus(runId, "failed", { error: error.message });
        onError.run({ agentId: job.agentId, tenantId: job.tenantId, runId, error });
      },
    };

    try {
      const result = await runtime.execute(
        {
          runId,
          agentId: job.agentId,
          tenantId: job.tenantId,
          taskId: job.taskId,
          wakeReason: job.wakeReason,
          config: runtimeConfig,
          systemInstructions,
          contextMarkdown,
          callbackUrl,
          callbackToken,
          previousSessionId,
        },
        callbacks,
      );

      await afterRun.run({
        agentId: job.agentId,
        tenantId: job.tenantId,
        runId,
        taskId: job.taskId,
        result,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
    }
  }

  return {
    async wake(request: WakeRequest): Promise<WakeupOutcome> {
      return createWakeup(db, request);
    },

    async enqueue(wakeupId: string): Promise<string> {
      // Fetch wakeup request
      const rows = await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.id, wakeupId))
        .limit(1);

      const wakeup = rows[0];
      if (!wakeup) throw new Error(`Wakeup request not found: ${wakeupId}`);

      const job: AgentRunJob = {
        wakeupRequestId: wakeup.id,
        agentId: wakeup.agentId,
        tenantId: wakeup.tenantId,
        wakeReason: wakeup.reason as AgentRunJob["wakeReason"],
        taskId: wakeup.taskId ?? undefined,
        payload: wakeup.payload as Record<string, unknown> | undefined,
      };

      await queue.enqueue(job);

      return wakeupId;
    },

    async cancel(runId: string): Promise<void> {
      await lifecycle.updateStatus(runId, "cancelled");
    },

    async recoverPending(): Promise<RecoverPendingResult> {
      // A "running" agent_run row only makes sense for an in-process job.
      // On boot, there is no such process — any row in that state is stranded
      // from a prior crash/restart. Mark it failed so operators see the truth,
      // and move its wake request to "abandoned" so it isn't re-run blindly
      // (the prior process may have completed partial side effects).
      const orphaned = await db
        .select({ id: agentRuns.id, wakeupRequestId: agentRuns.wakeupRequestId })
        .from(agentRuns)
        .where(eq(agentRuns.status, "running"));

      if (orphaned.length > 0) {
        await db
          .update(agentRuns)
          .set({
            status: "failed",
            error: "Orphaned by server restart",
            errorCode: "orphaned_by_restart",
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(agentRuns.status, "running"));

        for (const row of orphaned) {
          if (!row.wakeupRequestId) continue;
          await db
            .update(agentWakeupRequests)
            .set({ status: "abandoned", updatedAt: new Date() })
            .where(eq(agentWakeupRequests.id, row.wakeupRequestId));
        }
      }

      // Remaining "pending" wakes never got a run — re-enqueue them so the
      // new process picks up the work the old one never started.
      const pending = await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.status, "pending"));

      let reenqueued = 0;
      for (const wake of pending) {
        const job: AgentRunJob = {
          wakeupRequestId: wake.id,
          agentId: wake.agentId,
          tenantId: wake.tenantId,
          wakeReason: wake.reason as AgentRunJob["wakeReason"],
          taskId: wake.taskId ?? undefined,
          payload: wake.payload as Record<string, unknown> | undefined,
        };
        try {
          await queue.enqueue(job);
          reenqueued++;
        } catch {
          // keep going — one bad row shouldn't block the rest
        }
      }

      return { orphanedRuns: orphaned.length, reenqueued };
    },

    beforeRun,
    buildContext,
    afterRun,
    onCost,
    onError,
  };
}
