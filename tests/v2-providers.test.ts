/**
 * v2 prompt provider tests — Phase 3 of task_12.
 *
 * Verifies the skills + tool-catalog context providers walk the
 * v2 registries and emit the correct prompt sections.
 */
import { describe, it, expect } from "vitest";
import {
  createToolRegistry,
  createSkillRegistry,
  createSkillsProvider,
  createToolCatalogProvider,
} from "@boringos/agent";
import { z } from "@boringos/module-sdk";
import type { Skill, Tool } from "@boringos/module-sdk";
import type { ContextBuildEvent } from "@boringos/agent";

const makeEvent = (partial: Partial<ContextBuildEvent> = {}): ContextBuildEvent => ({
  agent: {
    id: "agent-1",
    tenantId: "tenant-1",
    name: "Test Agent",
    role: "engineer",
    status: "idle",
    runtimeId: "claude",
    instructions: null,
    reportsTo: null,
    persona: null,
    metadata: null,
    workingDirectory: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ContextBuildEvent["agent"],
  tenantId: "tenant-1",
  runId: "run-1",
  taskId: "task-1",
  wakeReason: "manual",
  memory: null,
  callbackUrl: "http://localhost:3000",
  callbackToken: "tok",
  ...partial,
});

const skill = (id: string, body: string, priority?: number, role?: string): Skill => ({
  id,
  source: "module",
  body,
  priority,
  appliesTo: role
    ? (e) => e.agentRole === role
    : undefined,
});

describe("v2 — skills provider", () => {
  it("returns null when registry is empty", async () => {
    const registry = createSkillRegistry();
    const provider = createSkillsProvider({ registry });
    const out = await provider.provide(makeEvent());
    expect(out).toBeNull();
  });

  it("emits one block per applicable skill, in priority order", async () => {
    const registry = createSkillRegistry();
    registry.register("alpha", skill("alpha-skill", "alpha body", 200));
    registry.register("beta", skill("beta-skill", "beta body", 50));
    registry.register("gamma", skill("gamma-skill", "gamma body"));

    const provider = createSkillsProvider({ registry });
    const out = await provider.provide(makeEvent());

    expect(out).toContain("## Skills");
    expect(out).toContain("### beta-skill");
    expect(out).toContain("### gamma-skill");
    expect(out).toContain("### alpha-skill");
    // Order: beta (50) → gamma (default 100) → alpha (200)
    const idx = (s: string) => out!.indexOf(s);
    expect(idx("### beta-skill")).toBeLessThan(idx("### gamma-skill"));
    expect(idx("### gamma-skill")).toBeLessThan(idx("### alpha-skill"));
  });

  it("respects appliesTo gating (role-based)", async () => {
    const registry = createSkillRegistry();
    registry.register("everywhere", skill("any", "any body"));
    registry.register("cto-only", skill("cto", "cto body", undefined, "cto"));

    const provider = createSkillsProvider({ registry });

    const ctoOut = await provider.provide(makeEvent({
      agent: { ...makeEvent().agent, role: "cto" } as unknown as ContextBuildEvent["agent"],
    }));
    expect(ctoOut).toContain("### cto");

    const engineerOut = await provider.provide(makeEvent({
      agent: { ...makeEvent().agent, role: "engineer" } as unknown as ContextBuildEvent["agent"],
    }));
    expect(engineerOut).toContain("### any");
    expect(engineerOut).not.toContain("### cto");
  });
});

const tool = (name: string, description: string): Tool => ({
  name,
  description,
  inputs: z.object({}),
  async handler() {
    return { ok: true, result: {} };
  },
});

describe("v2 — tool-catalog provider", () => {
  it("returns null when registry is empty", async () => {
    const registry = createToolRegistry();
    const provider = createToolCatalogProvider({ registry });
    const out = await provider.provide(makeEvent());
    expect(out).toBeNull();
  });

  it("groups by module and emits one entry per tool", async () => {
    const registry = createToolRegistry();
    registry.register("framework", tool("tasks.read", "Read a task"));
    registry.register("framework", tool("tasks.patch", "Update a task"));
    registry.register("crm", tool("create_deal", "Create a deal"));

    const provider = createToolCatalogProvider({ registry });
    const out = await provider.provide(makeEvent());

    expect(out).toContain("## Available tools");
    expect(out).toContain("### framework");
    expect(out).toContain("### crm");
    expect(out).toContain("`framework.tasks.read`");
    expect(out).toContain("`framework.tasks.patch`");
    expect(out).toContain("`crm.create_deal`");
    expect(out).toContain("Read a task");
    expect(out).toContain("Create a deal");
  });

  it("includes the calling-convention preamble", async () => {
    const registry = createToolRegistry();
    registry.register("framework", tool("ping", "Ping"));

    const provider = createToolCatalogProvider({ registry });
    const out = await provider.provide(makeEvent());

    expect(out).toContain("POST $BORINGOS_CALLBACK_URL/api/tools/<name>");
    expect(out).toContain("Authorization: Bearer $BORINGOS_CALLBACK_TOKEN");
  });
});
