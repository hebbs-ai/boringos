// Unit tests for drive-acl: pure functions, no server boot.
import { describe, it, expect } from "vitest";
import {
  validatePath,
  matchPrefix,
  resolveAgentPath,
  canAccess,
  KNOWN_PREFIXES,
  type Actor,
} from "../packages/@boringos/core/src/v2-modules/drive-acl.js";

describe("validatePath", () => {
  it("accepts simple relative paths", () => {
    expect(validatePath("foo.png")).toEqual({ ok: true, path: "foo.png" });
    expect(validatePath("tasks/abc/chart.png")).toEqual({ ok: true, path: "tasks/abc/chart.png" });
    expect(validatePath("a/b/c.txt")).toEqual({ ok: true, path: "a/b/c.txt" });
  });

  it("rejects empty paths", () => {
    expect(validatePath("")).toEqual({ ok: false, reason: "empty path" });
  });

  it("rejects parent-traversal segments", () => {
    expect(validatePath("../etc/passwd").ok).toBe(false);
    expect(validatePath("foo/../../bar").ok).toBe(false);
    expect(validatePath("..").ok).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(validatePath("/etc/passwd").ok).toBe(false);
    expect(validatePath("/").ok).toBe(false);
    expect(validatePath("C:\\Windows\\system32").ok).toBe(false);
  });

  it("rejects percent-encoded traversal variants", () => {
    expect(validatePath("%2e%2e/etc").ok).toBe(false);
    expect(validatePath("foo%2F..%2Fbar").ok).toBe(false);
    expect(validatePath("a%2e%2e/b").ok).toBe(false);
    expect(validatePath("foo%5C..%5Cbar").ok).toBe(false); // backslash encoded
  });

  it("rejects null bytes (raw and encoded)", () => {
    expect(validatePath("foo\0bar").ok).toBe(false);
    expect(validatePath("foo%00bar").ok).toBe(false);
  });

  it("folds backslashes and rejects windows-style traversal", () => {
    expect(validatePath("foo\\..\\bar").ok).toBe(false);
    expect(validatePath("..\\etc").ok).toBe(false);
  });

  it("strips leading ./", () => {
    expect(validatePath("./foo.png")).toEqual({ ok: true, path: "foo.png" });
  });

  it("rejects mid-path empty segments", () => {
    expect(validatePath("foo//bar").ok).toBe(false);
  });

  it("allows trailing slash on directory paths", () => {
    expect(validatePath("foo/").ok).toBe(true);
  });
});

describe("matchPrefix", () => {
  it("matches each known prefix", () => {
    for (const p of KNOWN_PREFIXES) {
      expect(matchPrefix(`${p}/x/y.png`)?.prefix).toBe(p);
    }
  });

  it("extracts scopeId for prefixes that have one", () => {
    expect(matchPrefix("tasks/T-1/foo.png")).toEqual({
      prefix: "tasks",
      scopeId: "T-1",
      rest: "foo.png",
    });
    expect(matchPrefix("users/u-9/note.md")).toEqual({
      prefix: "users",
      scopeId: "u-9",
      rest: "note.md",
    });
  });

  it("treats shared/ as scopeless", () => {
    expect(matchPrefix("shared/team/policy.md")).toEqual({
      prefix: "shared",
      scopeId: null,
      rest: "team/policy.md",
    });
  });

  it("returns null for unrecognized first segment", () => {
    expect(matchPrefix("legacy/file.txt")).toBeNull();
    expect(matchPrefix("artifacts/foo.png")).toBeNull();
  });
});

describe("resolveAgentPath", () => {
  it("honors explicit prefixes", () => {
    expect(resolveAgentPath("tasks/T-1/chart.png", { taskId: "T-2", agentId: "A" }))
      .toEqual({ ok: true, path: "tasks/T-1/chart.png" });
    expect(resolveAgentPath("shared/policy.md", { agentId: "A" }))
      .toEqual({ ok: true, path: "shared/policy.md" });
  });

  it("rewrites relative paths under the agent's task scope when taskId is set", () => {
    expect(resolveAgentPath("chart.png", { taskId: "T-1", agentId: "A" }))
      .toEqual({ ok: true, path: "tasks/T-1/chart.png" });
  });

  it("rewrites under the agent's own folder when no taskId is set", () => {
    expect(resolveAgentPath("scratch.json", { agentId: "A-1" }))
      .toEqual({ ok: true, path: "agents/A-1/scratch.json" });
  });

  it("rejects relative paths with no scope", () => {
    expect(resolveAgentPath("scratch.json", {}).ok).toBe(false);
  });

  it("propagates path validation errors", () => {
    expect(resolveAgentPath("../etc/passwd", { taskId: "T" }).ok).toBe(false);
    expect(resolveAgentPath("%2e%2e/x", { taskId: "T" }).ok).toBe(false);
  });
});

describe("canAccess — UserActor", () => {
  const alice: Actor = { kind: "user", userId: "u-alice", role: "member" };
  const admin: Actor = { kind: "user", userId: "u-admin", role: "admin" };

  it("allows tenant-wide reads + writes on shared/projects/tasks/agents", () => {
    for (const path of [
      "shared/team/policy.md",
      "projects/p1/spec.md",
      "tasks/T-1/chart.png",
      "agents/A-1/scratch.json",
    ]) {
      expect(canAccess(alice, "read", path).ok).toBe(true);
      expect(canAccess(alice, "write", path).ok).toBe(true);
    }
  });

  it("allows the user to access their own users/<id>/ folder", () => {
    expect(canAccess(alice, "read", "users/u-alice/contract.pdf").ok).toBe(true);
    expect(canAccess(alice, "write", "users/u-alice/contract.pdf").ok).toBe(true);
  });

  it("denies cross-user access to users/<other>/", () => {
    expect(canAccess(alice, "read", "users/u-bob/secret.pdf").ok).toBe(false);
    expect(canAccess(alice, "write", "users/u-bob/secret.pdf").ok).toBe(false);
  });

  it("admins can access any users/<id>/ folder", () => {
    expect(canAccess(admin, "read", "users/u-bob/secret.pdf").ok).toBe(true);
  });

  it("treats unrecognized prefixes as tenant-shared", () => {
    expect(canAccess(alice, "read", "legacy/file.txt").ok).toBe(true);
  });
});

describe("canAccess — AgentActor", () => {
  const agent: Actor = { kind: "agent", agentId: "A-1", taskId: "T-1" };
  const orphan: Actor = { kind: "agent" };

  it("allows full access on shared/ and projects/", () => {
    for (const path of ["shared/x.md", "projects/p1/x.md"]) {
      expect(canAccess(agent, "read", path).ok).toBe(true);
      expect(canAccess(agent, "write", path).ok).toBe(true);
    }
  });

  it("allows reads + writes on any tasks/<X>/ within tenant", () => {
    // Tasks are tenant-shared in v1: any agent can deliver into
    // any task's folder. Stricter per-task ACL would be a follow-up.
    expect(canAccess(agent, "read", "tasks/T-9/foo").ok).toBe(true);
    expect(canAccess(agent, "write", "tasks/T-1/foo.png").ok).toBe(true);
    expect(canAccess(agent, "write", "tasks/T-9/foo.png").ok).toBe(true);
    expect(canAccess(orphan, "write", "tasks/T-1/foo.png").ok).toBe(true);
  });

  it("allows agents/ reads broadly, writes only to own folder", () => {
    expect(canAccess(agent, "read", "agents/A-2/scratch").ok).toBe(true);
    expect(canAccess(agent, "write", "agents/A-1/scratch").ok).toBe(true);
    expect(canAccess(agent, "write", "agents/A-2/scratch").ok).toBe(false);
  });

  it("denies any access to users/", () => {
    expect(canAccess(agent, "read", "users/u-alice/x").ok).toBe(false);
    expect(canAccess(agent, "write", "users/u-alice/x").ok).toBe(false);
  });
});
