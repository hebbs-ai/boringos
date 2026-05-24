/**
 * Phase 2 — runtime-scoped session resume gate.
 *
 * The engine only resumes a stored session when it was created by the
 * agent's CURRENT runtime. This is what makes a runtime switch a
 * zero-migration operation (keep all data, drop only session continuity).
 */
import { describe, it, expect } from "vitest";
import { resolveResumableSessionId } from "@boringos/agent";

describe("runtime-scoped sessions — resolveResumableSessionId", () => {
  it("resumes when the stored runtime matches the current runtime (claude)", () => {
    expect(resolveResumableSessionId("sess-c", "claude", "claude")).toBe("sess-c");
  });

  it("resumes a pi session on a pi agent", () => {
    expect(resolveResumableSessionId("019e-pi", "pi", "pi")).toBe("019e-pi");
  });

  it("legacy null runtime type is treated as claude → still resumes for claude", () => {
    // Pre-existing tasks predate the column; they must keep resuming.
    expect(resolveResumableSessionId("legacy-sess", null, "claude")).toBe("legacy-sess");
    expect(resolveResumableSessionId("legacy-sess", undefined, "claude")).toBe("legacy-sess");
  });

  it("IGNORES a foreign session: claude session on a pi agent → fresh start", () => {
    // The core no-migration guarantee: no false-resume after a switch.
    expect(resolveResumableSessionId("claude-sess", "claude", "pi")).toBeUndefined();
    // Legacy null (claude) on a pi agent is also foreign → ignored.
    expect(resolveResumableSessionId("legacy-sess", null, "pi")).toBeUndefined();
  });

  it("IGNORES a pi session on a claude agent (the reverse direction)", () => {
    expect(resolveResumableSessionId("pi-sess", "pi", "claude")).toBeUndefined();
  });

  it("returns undefined when there is no stored session (first run)", () => {
    expect(resolveResumableSessionId(undefined, "pi", "pi")).toBeUndefined();
    expect(resolveResumableSessionId(null, null, "claude")).toBeUndefined();
    expect(resolveResumableSessionId("", "claude", "claude")).toBeUndefined();
  });

  it("models the switch→resume lifecycle: ignore once, then resume own", () => {
    // 1. Agent moved claude→pi. First pi wake sees the old claude session.
    const firstWake = resolveResumableSessionId("claude-sess", "claude", "pi");
    expect(firstWake).toBeUndefined(); // fresh pi session

    // 2. pi run completed → engine stamped { sessionId: "pi-sess", type: "pi" }.
    // 3. Next pi wake resumes the pi session normally.
    const secondWake = resolveResumableSessionId("pi-sess", "pi", "pi");
    expect(secondWake).toBe("pi-sess");
  });
});
