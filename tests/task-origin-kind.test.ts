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
