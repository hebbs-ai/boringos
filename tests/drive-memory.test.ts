// task_24 E — drive-backed MemoryProvider tests.
//
// Exercises createDriveMemory against a real local-FS backend.
// Confirms scope routing (user vs tenant), remember-recall-forget
// round-trip, that recall greps the right files, and that user-
// scope writes require ownerUserId.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStorage } from "@boringos/drive";
import { createDriveMemory } from "@boringos/memory";

describe("createDriveMemory", () => {
  let tmp: string;
  let drive: ReturnType<typeof createLocalStorage>;
  let memory: ReturnType<typeof createDriveMemory>;
  const T = "tenant-X";
  const U = "user-U";

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "drive-memory-"));
    drive = createLocalStorage({ root: tmp });
    memory = createDriveMemory({ drive });
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("user-scope remember routes to users/<owner>/memory/notes/", async () => {
    const id = await memory.remember("the user prefers terse responses", {
      tenantId: T,
      scope: "user",
      ownerUserId: U,
    });
    expect(id).toMatch(/^users\/user-U\/memory\/notes\/.*\.md$/);
    // Confirm bytes landed on disk.
    expect(await drive.exists(`${T}/${id}`)).toBe(true);
  });

  it("tenant-scope remember routes to shared/memory/notes/", async () => {
    const id = await memory.remember("vendor X invoices monthly net-30", {
      tenantId: T,
      scope: "tenant",
    });
    expect(id).toMatch(/^shared\/memory\/notes\/.*\.md$/);
    expect(await drive.exists(`${T}/${id}`)).toBe(true);
  });

  it("auto-scopes to user when ownerUserId is set + no explicit scope", async () => {
    const id = await memory.remember("auto-user fact", {
      tenantId: T,
      ownerUserId: U,
    });
    expect(id).toMatch(/^users\/user-U\/memory\/notes\//);
  });

  it("auto-scopes to tenant when no ownerUserId", async () => {
    const id = await memory.remember("auto-tenant fact", { tenantId: T });
    expect(id).toMatch(/^shared\/memory\/notes\//);
  });

  it("rejects user-scope write when ownerUserId is missing", async () => {
    await expect(
      memory.remember("orphan", { tenantId: T, scope: "user" }),
    ).rejects.toThrow(/ownerUserId/);
  });

  it("recall finds matches across both scopes by default", async () => {
    // Prior writes seeded the corpus. "terse" is in U's notes;
    // "net-30" is in shared notes.
    const userResults = await memory.recall("terse", {
      tenantId: T,
      ownerUserId: U,
    });
    expect(userResults.length).toBeGreaterThan(0);
    expect(userResults[0].content).toContain("terse");

    const tenantResults = await memory.recall("net-30", { tenantId: T });
    expect(tenantResults.length).toBeGreaterThan(0);
    expect(tenantResults[0].content).toContain("net-30");

    // Both should be reachable from a user-context recall with no
    // explicit scope (default behaviour: search user first, then
    // shared).
    const both = await memory.recall("terse|net-30", {
      tenantId: T,
      ownerUserId: U,
    });
    const blob = both.map((r) => r.content).join("\n");
    expect(blob).toContain("terse");
    expect(blob).toContain("net-30");
  });

  it("recall respects scope filter — user-only excludes shared hits", async () => {
    const results = await memory.recall("net-30", {
      tenantId: T,
      scope: "user",
      ownerUserId: U,
    });
    expect(results.length).toBe(0);
  });

  it("forget removes a memory by id", async () => {
    const id = await memory.remember("ephemeral fact", {
      tenantId: T,
      ownerUserId: U,
    });
    expect(await drive.exists(`${T}/${id}`)).toBe(true);
    await memory.forget(`${T}/${id}`);
    expect(await drive.exists(`${T}/${id}`)).toBe(false);
  });

  it("recall returns content without YAML frontmatter", async () => {
    const id = await memory.remember("plain content", {
      tenantId: T,
      scope: "tenant",
    });
    const results = await memory.recall("plain content", { tenantId: T });
    const hit = results.find((r) => r.id === id);
    expect(hit).toBeDefined();
    // Content should not start with "---" (frontmatter stripped).
    expect(hit?.content.startsWith("---")).toBe(false);
    expect(hit?.content).toContain("plain content");
  });

  it("requires tenantId on all calls", async () => {
    await expect(memory.remember("x", {})).rejects.toThrow(/tenantId/);
    await expect(memory.recall("x", {})).rejects.toThrow(/tenantId/);
  });
});
