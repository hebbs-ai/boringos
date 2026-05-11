import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RuntimeModule, RuntimeExecutionContext, RuntimeExecutionResult, AgentRunCallbacks } from "../types.js";
import { spawnAgent, buildAgentEnv, detectCli } from "../spawn.js";

export const claudeRuntime: RuntimeModule = {
  type: "claude",

  models: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],

  skillMarkdown() {
    return "This agent runs on Claude Code CLI. It can read/write files, run shell commands, and use MCP tools.";
  },

  async execute(ctx: RuntimeExecutionContext, callbacks: AgentRunCallbacks): Promise<RuntimeExecutionResult> {
    const config = ctx.config as Record<string, string | string[] | undefined>;
    const command = (config.command as string) ?? "claude";
    const model = config.model as string | undefined;
    const cwd = ctx.workspaceCwd ?? process.cwd();

    const args = ["--print", "-", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
    if (model) args.push("--model", model);
    if (ctx.previousSessionId) args.push("--resume", ctx.previousSessionId);

    const extraArgs = config.extraArgs as string[] | undefined;
    if (extraArgs) args.push(...extraArgs);

    let systemPromptFile: string | undefined;
    let tempDir: string | undefined;

    try {
      if (ctx.systemInstructions) {
        tempDir = await mkdtemp(join(tmpdir(), "boringos-"));
        systemPromptFile = join(tempDir, "system-prompt.md");
        await writeFile(systemPromptFile, ctx.systemInstructions, "utf8");
        args.push("--append-system-prompt-file", systemPromptFile);
      }

      const env = buildAgentEnv(ctx);
      let sessionId: string | undefined;
      let lastCostEvent: { inputTokens: number; outputTokens: number; model: string; costUsd?: number } | undefined;

      const result = await spawnAgent({
        command,
        args,
        cwd,
        env,
        stdin: ctx.contextMarkdown,
        onOutputLine: async (line) => {
          try {
            const event = JSON.parse(line);
            if (event.type === "result" && event.session_id) {
              sessionId = event.session_id;
            }
            if (event.type === "result" && event.usage) {
              lastCostEvent = {
                inputTokens: event.usage.input_tokens ?? 0,
                outputTokens: event.usage.output_tokens ?? 0,
                model: event.model ?? model ?? "claude",
                costUsd: event.total_cost_usd,
              };
            }
          } catch {
            // Not JSON — raw text output
          }
          await callbacks.onOutputLine(line);
        },
        onStderrLine: callbacks.onStderrLine,
      });

      if (lastCostEvent) callbacks.onCostEvent(lastCostEvent);
      callbacks.onComplete({ exitCode: result.exitCode, sessionId });

      return {
        exitCode: result.exitCode,
        sessionId,
        usage: lastCostEvent ? {
          inputTokens: lastCostEvent.inputTokens,
          outputTokens: lastCostEvent.outputTokens,
        } : undefined,
        costUsd: lastCostEvent?.costUsd,
        model: lastCostEvent?.model ?? model,
        provider: "anthropic",
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      return { exitCode: 1, errorMessage: error.message };
    } finally {
      if (systemPromptFile) await unlink(systemPromptFile).catch(() => {});
      if (tempDir) {
        const { rmdir } = await import("node:fs/promises");
        await rmdir(tempDir).catch(() => {});
      }
    }
  },

  async testEnvironment() {
    const { available } = await detectCli("claude");
    return {
      status: available ? "pass" as const : "fail" as const,
      checks: [{
        code: "claude_cli_available",
        level: available ? "info" as const : "error" as const,
        message: available ? "Claude CLI found on PATH" : "Claude CLI not found",
        hint: available ? undefined : "Install Claude Code: https://docs.anthropic.com/en/docs/claude-code",
      }],
      testedAt: new Date().toISOString(),
    };
  },
};
