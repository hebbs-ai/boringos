/**
 * v2 dispatcher tests — Phase 2 of task_12.
 *
 * Verifies the in-process dispatch path (validation, error model,
 * thrown-handler recovery). The audit row write is exercised by
 * the HTTP integration test in tests/v2-http.test.ts where a real
 * DB is available; this file focuses on dispatcher logic with no
 * DB.
 */
import { describe, it, expect } from "vitest";
import {
  createToolRegistry,
  dispatch,
  invoke,
} from "@boringos/agent";
import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext } from "@boringos/module-sdk";

const ctx: ToolContext = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  agentId: "00000000-0000-0000-0000-000000000002",
  runId: "00000000-0000-0000-0000-000000000003",
  invokedBy: "agent",
};

const echoTool: Tool<{ msg: string }, { echoed: string }> = {
  name: "echo",
  description: "Echo a message",
  inputs: z.object({ msg: z.string() }),
  output: z.object({ echoed: z.string() }),
  async handler(input) {
    return { ok: true, result: { echoed: input.msg.toUpperCase() } };
  },
};

const errorTool: Tool<{ kind: "biz" | "throw" }> = {
  name: "kaboom",
  description: "Returns or throws errors for testing",
  inputs: z.object({ kind: z.enum(["biz", "throw"]) }),
  async handler(input) {
    if (input.kind === "throw") throw new Error("boom");
    return {
      ok: false,
      error: {
        code: "upstream_unavailable",
        message: "third-party down",
        retryable: true,
      },
    };
  },
};

describe("v2 — dispatcher", () => {
  it("rejects with not_found when the tool isn't registered", async () => {
    const tools = createToolRegistry();
    const out = await dispatch(
      { registry: tools },
      "nope.missing",
      {},
      ctx,
    );
    expect(out.status).toBe(404);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.error.code).toBe("not_found");
    }
  });

  it("returns invalid_input on schema failure (no handler invoked)", async () => {
    const tools = createToolRegistry();
    let handlerCalls = 0;
    tools.register("test", {
      ...echoTool,
      async handler(input) {
        handlerCalls += 1;
        return { ok: true, result: { echoed: input.msg } };
      },
    });

    const out = await dispatch(
      { registry: tools },
      "test.echo",
      { not_msg: 123 },
      ctx,
    );
    expect(out.status).toBe(400);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.error.code).toBe("invalid_input");
      expect(out.result.error.retryable).toBe(false);
    }
    expect(handlerCalls).toBe(0);
  });

  it("dispatches a happy-path call and returns the result", async () => {
    const tools = createToolRegistry();
    tools.register("test", echoTool);

    const out = await dispatch(
      { registry: tools },
      "test.echo",
      { msg: "hello" },
      ctx,
    );

    expect(out.status).toBe(200);
    expect(out.result).toEqual({ ok: true, result: { echoed: "HELLO" } });
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("preserves a structured business error (status 200, ok=false)", async () => {
    const tools = createToolRegistry();
    tools.register("test", errorTool);

    const out = await dispatch(
      { registry: tools },
      "test.kaboom",
      { kind: "biz" },
      ctx,
    );

    expect(out.status).toBe(200);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.error.code).toBe("upstream_unavailable");
      expect(out.result.error.retryable).toBe(true);
    }
  });

  it("converts a thrown handler error into a 500 internal", async () => {
    const tools = createToolRegistry();
    tools.register("test", errorTool);

    const out = await dispatch(
      { registry: tools },
      "test.kaboom",
      { kind: "throw" },
      ctx,
    );

    expect(out.status).toBe(500);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.error.code).toBe("internal");
      expect(out.result.error.message).toContain("boom");
      expect(out.result.error.retryable).toBe(false);
    }
  });

  it("invoke() throws on internal errors but returns business errors as data", async () => {
    const tools = createToolRegistry();
    tools.register("test", errorTool);

    const businessErr = await invoke<{ kind: "biz" | "throw" }, never>(
      { registry: tools },
      "test.kaboom",
      { kind: "biz" },
      ctx,
    );
    expect(businessErr.ok).toBe(false);

    await expect(
      invoke<{ kind: "biz" | "throw" }, never>(
        { registry: tools },
        "test.kaboom",
        { kind: "throw" },
        ctx,
      ),
    ).rejects.toThrow(/internal error/);
  });

  it("derives moduleId from the dotted full name", async () => {
    const tools = createToolRegistry();
    tools.register("crm", echoTool);
    const out = await dispatch(
      { registry: tools },
      "crm.echo",
      { msg: "ok" },
      ctx,
    );
    expect(out.status).toBe(200);
  });
});
