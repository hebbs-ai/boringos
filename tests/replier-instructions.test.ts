// SPDX-License-Identifier: AGPL-3.0-or-later
//
// RC6 — contract test for REPLIER_AGENT_INSTRUCTIONS.
//
// This file tests the INSTRUCTION STRING as a document. It parses
// the instructions and asserts structural invariants so a future
// edit can't accidentally reintroduce the unconditional inbox.read
// call before the noise/fyi skip check.

import { describe, it, expect } from "vitest";

import { REPLIER_AGENT_INSTRUCTIONS_FOR_TEST } from "../packages/@boringos/core/src/modules/inbox-replier.js";

describe("RC6 — replier instructions: label-first skip logic", () => {
  it("Step 1 parses both inbox-item-id and triage-label from the task description", () => {
    expect(REPLIER_AGENT_INSTRUCTIONS_FOR_TEST).toMatch(/Step 1/);
    expect(REPLIER_AGENT_INSTRUCTIONS_FOR_TEST).toMatch(/inbox-item-id/);
    expect(REPLIER_AGENT_INSTRUCTIONS_FOR_TEST).toMatch(/triage-label/);
  });

  it("the noise/fyi skip check appears BEFORE framework.inbox.read", () => {
    const skipIdx = REPLIER_AGENT_INSTRUCTIONS_FOR_TEST.search(/noise.*fyi|fyi.*noise/i);
    const readIdx = REPLIER_AGENT_INSTRUCTIONS_FOR_TEST.indexOf(
      "framework.inbox.read",
    );
    expect(skipIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeLessThan(readIdx);
  });

  it("framework.inbox.read is guarded by 'only if drafting' language", () => {
    // Find the actual curl call (not the 'do not call' mention).
    const curlIdx = REPLIER_AGENT_INSTRUCTIONS_FOR_TEST.indexOf(
      "/api/tools/framework.inbox.read",
    );
    expect(curlIdx).toBeGreaterThan(-1);
    // Within ~300 chars before the curl there must be qualifying
    // language so the agent knows it's conditional, not unconditional.
    const context = REPLIER_AGENT_INSTRUCTIONS_FOR_TEST.slice(
      Math.max(0, curlIdx - 300),
      curlIdx,
    );
    expect(context).toMatch(/draft|only if|not skip|going to draft/i);
  });

  it("does not contain the stale 'wake on every inbox.item_created' phrasing", () => {
    expect(REPLIER_AGENT_INSTRUCTIONS_FOR_TEST).not.toMatch(
      /wake on every .inbox\.item_created/,
    );
  });
});
