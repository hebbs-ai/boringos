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
