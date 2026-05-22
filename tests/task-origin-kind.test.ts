// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tests for the `taskOriginKind` pipeline (RC4) and the
// `appliesTo` predicates it enables (RC1, RC2, RC3, RC5).
//
// The runtime test in this file (`skills-provider forwards
// taskOriginKind to listApplicable`) is the true RED test:
// without RC4's fix in skills-provider.ts, the field is dropped
// when building the registry filter, so an `appliesTo` predicate
// that keys on it can never match.

import { describe, it, expect } from "vitest";
import {
  createSkillRegistry,
  createSkillsProvider,
} from "@boringos/agent";
import type { ContextBuildEvent } from "@boringos/agent";

function makeEvent(
  overrides: Partial<ContextBuildEvent> = {},
): ContextBuildEvent {
  return {
    agent: {
      id: "agent-1",
      tenantId: "tenant-1",
      name: "Test Agent",
      role: "operations",
      title: null,
      icon: null,
      status: "idle",
      reportsTo: null,
      instructions: "",
      runtimeId: null,
      fallbackRuntimeId: null,
      model: null,
      budgetMonthlyCents: null,
      spentMonthlyCents: 0,
      pauseReason: null,
      pausedAt: null,
      permissions: {},
      metadata: null,
      lastHeartbeatAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    tenantId: "tenant-1",
    runId: "run-1",
    wakeReason: "task",
    memory: null,
    callbackUrl: "http://localhost",
    callbackToken: "tok",
    ...overrides,
  };
}

describe("RC4 — taskOriginKind threading", () => {
  it("ContextBuildEvent type accepts taskOriginKind", () => {
    // Compile-time check — if ContextBuildEvent doesn't have
    // taskOriginKind, tsc fails on this assignment.
    const event: ContextBuildEvent = makeEvent({
      taskOriginKind: "inbox.item_created",
    });
    expect(event.taskOriginKind).toBe("inbox.item_created");
  });

  it("skills-provider forwards taskOriginKind to listApplicable", async () => {
    // The bug: skills-provider.ts builds a filter object with
    // tenantId/agentId/agentRole/taskId but DOES NOT include
    // taskOriginKind. Predicates keying on it see `undefined`
    // and never match — even when the event carries the value.

    const registry = createSkillRegistry();
    registry.register("test-mod", {
      id: "marker",
      source: "module",
      body: "MARKER_BODY",
      priority: 50,
      appliesTo: (e) => e.taskOriginKind === "inbox.item_created",
    });

    const provider = createSkillsProvider({ registry });

    // Matching event — skill MUST be in the output
    const matchResult = await provider.provide(
      makeEvent({ taskOriginKind: "inbox.item_created" }),
    );
    expect(matchResult).toContain("MARKER_BODY");

    // Non-matching event — skill MUST NOT be in the output
    const noMatchResult = await provider.provide(
      makeEvent({ taskOriginKind: "manual" }),
    );
    expect(noMatchResult ?? "").not.toContain("MARKER_BODY");

    // Undefined originKind — skill MUST NOT be in the output
    const undefResult = await provider.provide(makeEvent());
    expect(undefResult ?? "").not.toContain("MARKER_BODY");
  });
});

describe("RC1 — replier workflow + skill targeting", () => {
  it("inbox-replier workflow triggers on triage.classified with noise/fyi skip conditions", async () => {
    // The bug: workflow trigger is "inbox.item_created", which
    // fires concurrently with triage. Fix: trigger on the event
    // triage emits AFTER classifying, then skip noise/fyi via
    // condition blocks so the LLM only runs for actionable mail.
    const { buildReplierWorkflowBlocks } = await import(
      "../packages/@boringos/core/src/modules/inbox-replier.js"
    );

    const { blocks, edges } = buildReplierWorkflowBlocks("agent-id");

    const trigger = blocks.find((b) => b.type === "trigger");
    expect(trigger?.config?.eventType).toBe("triage.classified");

    // Two condition blocks present, skipping noise and fyi
    const conditions = blocks.filter((b) => b.type === "condition");
    expect(conditions.length).toBe(2);
    const values = conditions
      .map((c) => (c.config as { value?: string }).value)
      .sort();
    expect(values).toEqual(["fyi", "noise"]);
    for (const c of conditions) {
      const cfg = c.config as {
        operator?: string;
        field?: string;
      };
      expect(cfg.operator).toBe("not_equals");
      expect(cfg.field).toContain("trigger.label");
    }

    // The task creation block should come only on the true edge
    // of the second condition — and set originKind for the replier.
    const taskBlock = blocks.find((b) => b.type === "tool");
    expect(taskBlock?.tool).toBe("framework.tasks.create");
    const inputs = (taskBlock?.inputs ?? {}) as { originKind?: string; description?: string };
    expect(inputs.originKind).toBe("inbox.draft_reply");
    expect(inputs.description).toContain("triage-label");

    // Edges: trigger → cond1 → cond2 → task (on true handle).
    expect(edges.length).toBe(3);
    const triggerEdge = edges.find(
      (e) => e.sourceBlockId === trigger?.id,
    );
    expect(triggerEdge).toBeDefined();
    const taskEdge = edges.find(
      (e) => e.targetBlockId === taskBlock?.id,
    );
    expect(taskEdge?.sourceHandle).toBe("true");
  });

  it("inbox-replier skill appliesTo matches taskOriginKind, not agentRole", async () => {
    const { createInboxReplierModule } = await import("@boringos/core");
    const mod = createInboxReplierModule({ db: null as never });
    const skill = mod.skills?.[0];
    if (!skill?.appliesTo) {
      throw new Error("inbox-replier module missing skill.appliesTo");
    }

    // Matches when taskOriginKind is inbox.draft_reply
    expect(
      skill.appliesTo({
        tenantId: "t",
        agentId: "a",
        agentRole: "operations",
        taskOriginKind: "inbox.draft_reply",
      }),
    ).toBe(true);

    // Does NOT match when the role is "operations" but the originKind
    // is something else (e.g. a triage task, which the broken predicate
    // used to match).
    expect(
      skill.appliesTo({
        tenantId: "t",
        agentId: "a",
        agentRole: "operations",
        taskOriginKind: "inbox.item_created",
      }),
    ).toBe(false);
    expect(
      skill.appliesTo({
        tenantId: "t",
        agentId: "a",
        agentRole: "operations",
        taskOriginKind: undefined,
      }),
    ).toBe(false);
  });
});

describe("framework.tasks.create — auto-attribute system inbox tasks to tenant admin", () => {
  it("sets createdByUserId from user_tenants when originKind is inbox.* and ctx has no user", async () => {
    // System inbox tasks (created via internal workflow dispatch)
    // have no user in ctx. Without an attribution, they don't show
    // in the Done tab. We auto-resolve to the tenant's primary
    // admin so completed inbox runs surface in the owner's Done.
    const { BoringOS, createFrameworkModule } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-tasks-attrib-"));
    const port = 15800 + Math.floor(Math.random() * 100);

    const app = new BoringOS({
      database: { embedded: true, dataDir, port },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: "test-secret" },
    });
    app.module(createFrameworkModule);

    const server = await app.listen(0);
    try {
      const { tenants, tasks: tasksTable } = await import("@boringos/db");
      const { sql: drizzleSql, eq: drizzleEq } = await import("drizzle-orm");
      const { dispatch, createToolRegistry, createSkillRegistry, createModuleRegistry } =
        await import("@boringos/agent");

      const db = (server as unknown as {
        context: { db: import("@boringos/db").Db };
      }).context.db;

      const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const adminUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

      await db
        .insert(tenants)
        .values({ id: tenantId, name: "Attr", slug: "attr" })
        .onConflictDoNothing();

      // auth_users + user_tenants are bootstrapped by BoringOS auth
      // setup at listen() time. Insert a row directly so the
      // auto-resolve lookup has a target.
      await db.execute(drizzleSql`
        INSERT INTO auth_users (id, name, email)
        VALUES (${adminUserId}, 'Test Admin', ${`admin-${adminUserId}@test`})
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(drizzleSql`
        INSERT INTO user_tenants (id, user_id, tenant_id, role)
        VALUES (gen_random_uuid()::text, ${adminUserId}, ${tenantId}, 'admin')
        ON CONFLICT DO NOTHING
      `);

      // Build a registry containing the framework module so dispatch
      // can find framework.tasks.create.
      const tools = createToolRegistry();
      const skills = createSkillRegistry();
      const modules = createModuleRegistry({ tools, skills });
      modules.register(createFrameworkModule({ db, engine: null } as never));

      // Dispatch framework.tasks.create with no agentId / no
      // assigneeUserId / no createdByUserId — simulates a workflow
      // dispatch where the task is for an inbox flow.
      const result = await dispatch(
        { registry: tools, db },
        "framework.tasks.create",
        {
          title: "Triage inbox item",
          description: "test",
          originKind: "inbox.item_created",
          originId: "item-1",
        },
        { tenantId, invokedBy: "workflow" },
      );
      expect(result.result.ok).toBe(true);

      // Look up the created task and verify createdByUserId was
      // auto-resolved to the admin.
      const taskRows = await db
        .select()
        .from(tasksTable)
        .where(drizzleEq(tasksTable.tenantId, tenantId));
      expect(taskRows.length).toBe(1);
      expect(taskRows[0].createdByUserId).toBe(adminUserId);
      expect(taskRows[0].originKind).toBe("inbox.item_created");
    } finally {
      await server.close();
    }
  });
});

describe("RC8 — inbox-triage workflow shape (Layer 2)", () => {
  it("inbox-triage workflow has an automated-mail skip condition before the task block", async () => {
    // Layer 2 fix: the onIngest direct-fanout in boringos.ts is gone.
    // The inbox-triage workflow is now the only triage-creation
    // path. It must preserve the previous automated-mail skip
    // optimization via a condition block.
    const { buildTriageWorkflowBlocks } = await import(
      "../packages/@boringos/core/src/modules/inbox-triage.js"
    );

    const { blocks, edges } = buildTriageWorkflowBlocks("agent-id");

    const trigger = blocks.find((b) => b.type === "trigger");
    expect(trigger?.config?.eventType).toBe("inbox.item_created");

    // There must be at least one condition block that checks the
    // trigger's automated flag.
    const conditions = blocks.filter((b) => b.type === "condition");
    expect(conditions.length).toBeGreaterThanOrEqual(1);
    const automatedCond = conditions.find((c) => {
      const cfg = (c.config ?? {}) as { field?: string };
      return /automated/i.test(String(cfg.field ?? ""));
    });
    expect(automatedCond).toBeDefined();

    // Task block must be reached only via a "true" handle (not-
    // automated path).
    const taskBlock = blocks.find((b) => b.type === "tool");
    expect(taskBlock?.tool).toBe("framework.tasks.create");
    const edgeIntoTask = edges.find((e) => e.targetBlockId === taskBlock?.id);
    expect(edgeIntoTask?.sourceHandle).toBe("true");
  });
});

describe("RC2 — triage agent skill targeting", () => {
  it("inbox-triage skill appliesTo matches taskOriginKind, not agentRole", async () => {
    // The bug: both inbox modules use agentRole="operations" so
    // `agentRole === TRIAGE_AGENT_ROLE` matches both agents,
    // causing skill cross-injection. Fix: filter by taskOriginKind.
    const { createInboxTriageModule } = await import("@boringos/core");
    const mod = createInboxTriageModule({ db: null as never });
    const skill = mod.skills?.[0];
    if (!skill?.appliesTo) {
      throw new Error("inbox-triage module missing skill.appliesTo");
    }

    // Matches only triage tasks
    expect(
      skill.appliesTo({
        tenantId: "t",
        agentId: "a",
        agentRole: "operations",
        taskOriginKind: "inbox.item_created",
      }),
    ).toBe(true);

    // Does NOT match replier tasks (even though both agents share role)
    expect(
      skill.appliesTo({
        tenantId: "t",
        agentId: "a",
        agentRole: "operations",
        taskOriginKind: "inbox.draft_reply",
      }),
    ).toBe(false);

    // Does NOT match manual or undefined tasks
    expect(
      skill.appliesTo({
        tenantId: "t",
        agentId: "a",
        agentRole: "operations",
        taskOriginKind: "manual",
      }),
    ).toBe(false);
    expect(
      skill.appliesTo({
        tenantId: "t",
        agentId: "a",
        agentRole: "operations",
        taskOriginKind: undefined,
      }),
    ).toBe(false);
  });
});

describe("RC3 — triage module TRIAGE_SKILL targeting", () => {
  it("triage module's TRIAGE_SKILL is gated to triage tasks only", async () => {
    // The bug: triage.ts (separate from inbox-triage.ts) registers
    // TRIAGE_SKILL with no `appliesTo`. ~45 lines of batch-mode
    // triage instructions inject into every agent in every tenant.
    // Fix: filter by taskOriginKind="inbox.item_created".
    const { createTriageModule, createInboxModule } = await import("@boringos/core");
    const { createToolRegistry, createSkillRegistry, createModuleRegistry } =
      await import("@boringos/agent");

    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register(createInboxModule({ db: null as never }));
    modules.register(createTriageModule({ db: null as never }));

    // Triage task — skill MUST apply
    const onTriage = skills.listApplicable({
      tenantId: "t",
      agentId: "a",
      agentRole: "operations",
      taskOriginKind: "inbox.item_created",
    });
    expect(onTriage.find((s) => s.skill.id === "triage")).toBeDefined();

    // Replier task — skill MUST NOT apply
    const onReplier = skills.listApplicable({
      tenantId: "t",
      agentId: "a",
      agentRole: "operations",
      taskOriginKind: "inbox.draft_reply",
    });
    expect(onReplier.find((s) => s.skill.id === "triage")).toBeUndefined();

    // Manual task — skill MUST NOT apply
    const onManual = skills.listApplicable({
      tenantId: "t",
      agentId: "a",
      agentRole: "operations",
      taskOriginKind: "manual",
    });
    expect(onManual.find((s) => s.skill.id === "triage")).toBeUndefined();
  });
});

describe("RC5 — memory SKILL excludes inbox automation", () => {
  it("MEMORY_SKILL does NOT inject for inbox triage or replier tasks", async () => {
    // The bug: memory.ts registers MEMORY_SKILL (~235 lines of
    // cross-run memory instructions) with no `appliesTo`. It loads
    // for every agent run including the short-lived inbox automation
    // agents that never use memory.
    const { createMemoryModule } = await import("@boringos/core");
    const { createToolRegistry, createSkillRegistry, createModuleRegistry } =
      await import("@boringos/agent");

    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register(createMemoryModule({ db: null as never, memory: null }));

    // Inbox triage task — memory skill MUST NOT apply
    const onTriage = skills.listApplicable({
      tenantId: "t",
      agentId: "a",
      agentRole: "operations",
      taskOriginKind: "inbox.item_created",
    });
    expect(onTriage.find((s) => s.skill.id === "memory")).toBeUndefined();

    // Inbox replier task — memory skill MUST NOT apply
    const onReplier = skills.listApplicable({
      tenantId: "t",
      agentId: "a",
      agentRole: "operations",
      taskOriginKind: "inbox.draft_reply",
    });
    expect(onReplier.find((s) => s.skill.id === "memory")).toBeUndefined();

    // Manual task — memory skill MUST apply
    const onManual = skills.listApplicable({
      tenantId: "t",
      agentId: "a",
      agentRole: "operations",
      taskOriginKind: "manual",
    });
    expect(onManual.find((s) => s.skill.id === "memory")).toBeDefined();

    // Undefined originKind — memory skill MUST apply (legacy paths)
    const onUndef = skills.listApplicable({
      tenantId: "t",
      agentId: "a",
      agentRole: "operations",
      taskOriginKind: undefined,
    });
    expect(onUndef.find((s) => s.skill.id === "memory")).toBeDefined();
  });
});
