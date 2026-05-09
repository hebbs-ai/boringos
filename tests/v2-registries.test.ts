/**
 * v2 registry smoke tests
 *
 * Phase 1 of task_12. Verifies the in-memory shells of the
 * Tool / Skill / Module registries. No HTTP, no DB, no agent —
 * purely additive scaffolding.
 *
 * These tests are scoped to the v2 surface; they don't touch any
 * v1 path. The v1 phase tests above continue to run unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  createToolRegistry,
  createSkillRegistry,
  createModuleRegistry,
} from "@boringos/agent";
import type { Module, Skill, Tool } from "@boringos/module-sdk";

const noopSchema = {
  safeParse(value: unknown) {
    return { success: true as const, data: value as Record<string, unknown> };
  },
};

const makeTool = (name: string): Tool => ({
  name,
  description: `Test tool ${name}`,
  inputs: noopSchema,
  async handler() {
    return { ok: true, result: { name } };
  },
});

const makeSkill = (
  id: string,
  body: string,
  priority?: number,
): Skill => ({
  id,
  source: "module",
  body,
  priority,
});

describe("v2 — tool registry", () => {
  it("registers and looks up a tool by full name", () => {
    const tools = createToolRegistry();
    tools.register("framework", makeTool("tasks.read"));

    expect(tools.get("framework.tasks.read")?.description).toBe(
      "Test tool tasks.read",
    );
    expect(tools.get("framework.tasks.write")).toBeUndefined();
  });

  it("rejects duplicate registration within the same module", () => {
    const tools = createToolRegistry();
    tools.register("framework", makeTool("tasks.read"));
    expect(() => tools.register("framework", makeTool("tasks.read"))).toThrow(
      /already registered/,
    );
  });

  it("allows the same tool name across different modules", () => {
    const tools = createToolRegistry();
    tools.register("framework", makeTool("send"));
    tools.register("crm", makeTool("send"));
    expect(tools.list()).toHaveLength(2);
    expect(tools.get("framework.send")).toBeDefined();
    expect(tools.get("crm.send")).toBeDefined();
  });

  it("filters by module", () => {
    const tools = createToolRegistry();
    tools.register("framework", makeTool("tasks.read"));
    tools.register("framework", makeTool("tasks.patch"));
    tools.register("crm", makeTool("create_deal"));

    expect(tools.listByModule("framework")).toHaveLength(2);
    expect(tools.listByModule("crm")).toHaveLength(1);
    expect(tools.listByModule("nonexistent")).toHaveLength(0);
  });

  it("unregisterModule drops every tool the module contributed", () => {
    const tools = createToolRegistry();
    tools.register("framework", makeTool("tasks.read"));
    tools.register("framework", makeTool("tasks.patch"));
    tools.register("crm", makeTool("create_deal"));

    tools.unregisterModule("framework");

    expect(tools.list()).toHaveLength(1);
    expect(tools.get("framework.tasks.read")).toBeUndefined();
    expect(tools.get("crm.create_deal")).toBeDefined();
  });

  it("listByCapability is reserved for Phase 5 — throws today", () => {
    const tools = createToolRegistry();
    expect(() => tools.listByCapability("crm-source")).toThrow(/Phase 5/);
  });
});

describe("v2 — skill registry", () => {
  it("returns skills sorted by priority ascending", () => {
    const skills = createSkillRegistry();
    skills.register("a", makeSkill("late", "late body", 200));
    skills.register("b", makeSkill("early", "early body", 50));
    skills.register("c", makeSkill("default", "default body"));

    const ordered = skills.list().map((s) => s.skill.id);
    expect(ordered).toEqual(["early", "default", "late"]);
  });

  it("listApplicable respects the appliesTo predicate", () => {
    const skills = createSkillRegistry();
    skills.register("any-role", makeSkill("any", "any body"));
    skills.register("cto-only", {
      id: "cto",
      source: "module",
      body: "cto body",
      appliesTo: (event) => event.agentRole === "cto",
    });

    const ctoSkills = skills.listApplicable({
      tenantId: "t1",
      agentId: "a1",
      agentRole: "cto",
    });
    const engSkills = skills.listApplicable({
      tenantId: "t1",
      agentId: "a1",
      agentRole: "engineer",
    });

    expect(ctoSkills.map((s) => s.skill.id)).toEqual(["any", "cto"]);
    expect(engSkills.map((s) => s.skill.id)).toEqual(["any"]);
  });

  it("unregisterModule clears that module's skills only", () => {
    const skills = createSkillRegistry();
    skills.register("crm", makeSkill("crm-skill", "crm body"));
    skills.register("memory", makeSkill("memory-skill", "memory body"));

    skills.unregisterModule("crm");

    const remaining = skills.list().map((s) => s.skill.id);
    expect(remaining).toEqual(["memory-skill"]);
  });
});

describe("v2 — module registry", () => {
  const buildModule = (overrides: Partial<Module> = {}): Module => ({
    id: "test-mod",
    name: "Test Module",
    version: "0.1.0",
    description: "test",
    ...overrides,
  });

  it("registers a Module and forwards its tools + inline skills", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    const mod = buildModule({
      id: "framework",
      tools: [makeTool("tasks.read"), makeTool("tasks.patch")],
      skills: [makeSkill("framework", "framework body")],
    });

    modules.register(mod);

    expect(modules.get("framework")?.id).toBe("framework");
    expect(tools.list()).toHaveLength(2);
    expect(skills.list()).toHaveLength(1);
  });

  it("rejects duplicate Module ids", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register(buildModule({ id: "dup" }));
    expect(() => modules.register(buildModule({ id: "dup" }))).toThrow(
      /already registered/,
    );
  });

  it("byCapability resolves on the `provides` field", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register(buildModule({ id: "salesforce", provides: ["crm-source"] }));
    modules.register(buildModule({ id: "hubspot", provides: ["crm-source"] }));
    modules.register(buildModule({ id: "gmail", provides: ["email-send"] }));

    const crmSources = modules.byCapability("crm-source").map((m) => m.id);
    expect(crmSources.sort()).toEqual(["hubspot", "salesforce"]);

    const emailSenders = modules.byCapability("email-send").map((m) => m.id);
    expect(emailSenders).toEqual(["gmail"]);
  });

  it("unregister removes the Module from all registries it touched", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register(buildModule({
      id: "crm",
      tools: [makeTool("create_deal")],
      skills: [makeSkill("crm-skill", "body")],
    }));

    expect(modules.list()).toHaveLength(1);
    expect(tools.list()).toHaveLength(1);
    expect(skills.list()).toHaveLength(1);

    modules.unregister("crm");

    expect(modules.list()).toHaveLength(0);
    expect(tools.list()).toHaveLength(0);
    expect(skills.list()).toHaveLength(0);
  });

  it("rejects registration when a non-optional concrete dep is missing", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    expect(() =>
      modules.register({
        id: "a",
        name: "A",
        version: "0.1.0",
        description: "depends on B",
        dependsOn: [{ moduleId: "b" }],
      }),
    ).toThrow(/requires "b"/);
  });

  it("allows registration when a concrete dep is registered first", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register({ id: "b", name: "B", version: "0.1.0", description: "..." });
    modules.register({
      id: "a",
      name: "A",
      version: "0.1.0",
      description: "...",
      dependsOn: [{ moduleId: "b" }],
    });
    expect(modules.list()).toHaveLength(2);
  });

  it("rejects registration when no module provides the required capability", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    expect(() =>
      modules.register({
        id: "consumer",
        name: "Consumer",
        version: "0.1.0",
        description: "needs email-send",
        dependsOn: [{ capability: "email-send" }],
      }),
    ).toThrow(/email-send/);
  });

  it("resolves capability deps when a provider is registered first", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register({
      id: "smtp",
      name: "SMTP",
      version: "0.1.0",
      description: "...",
      provides: ["email-send"],
    });
    modules.register({
      id: "consumer",
      name: "Consumer",
      version: "0.1.0",
      description: "...",
      dependsOn: [{ capability: "email-send" }],
    });
    expect(modules.list()).toHaveLength(2);
  });

  it("optional deps don't block registration when missing", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register({
      id: "consumer",
      name: "Consumer",
      version: "0.1.0",
      description: "...",
      dependsOn: [{ capability: "email-send", optional: true }],
    });
    expect(modules.list()).toHaveLength(1);
  });

  it("ignores string-form skill refs in Phase 1 (file loading is Phase 3)", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register(buildModule({
      id: "future-mod",
      skills: ["./SKILL.md"],
    }));

    // No skill should have been registered — string refs are
    // a no-op in Phase 1. They become file loaders in Phase 3.
    expect(skills.list()).toHaveLength(0);
  });
});
