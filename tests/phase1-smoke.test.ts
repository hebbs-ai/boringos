/**
 * Phase 1 Smoke Tests
 *
 * These tests validate the core framework functionality added in Phase 1.
 * Each phase adds tests — they accumulate and never get removed.
 */
import { describe, it, expect } from "vitest";
import { testDbConfig } from "./_helpers.js";

// ── Step 1: @boringos/shared ──────────────────────────────────────────────

describe("@boringos/shared", () => {
  it("createHook — register, fire, and remove handlers", async () => {
    const { createHook } = await import("@boringos/shared");
    const hook = createHook<string>();
    const calls: string[] = [];

    const handler = (event: string) => { calls.push(event); };
    hook.use(handler);

    await hook.run("first");
    expect(calls).toEqual(["first"]);

    hook.remove(handler);
    await hook.run("second");
    expect(calls).toEqual(["first"]); // handler was removed
  });

  it("createHook — error in one handler does not kill others", async () => {
    const { createHook } = await import("@boringos/shared");
    const hook = createHook<string>();
    const calls: string[] = [];

    hook.use(() => { throw new Error("boom"); });
    hook.use((event) => { calls.push(event); });

    await hook.run("test");
    expect(calls).toEqual(["test"]); // second handler still ran
  });

  it("generateId — returns a UUID", async () => {
    const { generateId } = await import("@boringos/shared");
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("slugify — converts text to url-safe slug", async () => {
    const { slugify } = await import("@boringos/shared");
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("  Multiple   Spaces  ")).toBe("multiple-spaces");
    expect(slugify("Special @#$ chars")).toBe("special-chars");
  });

  it("sanitizePath — blocks path traversal", async () => {
    const { sanitizePath } = await import("@boringos/shared");
    expect(() => sanitizePath("/root", "../etc/passwd")).toThrow("Path traversal");
    expect(sanitizePath("/root", "subdir/file.txt")).toBe("/root/subdir/file.txt");
  });
});

// ── Step 2: @boringos/memory ──────────────────────────────────────────────

describe("@boringos/memory", () => {
  it("nullMemory — all methods are no-ops", async () => {
    const { nullMemory } = await import("@boringos/memory");
    expect(nullMemory.name).toBe("null");
    expect(nullMemory.skillMarkdown()).toBeNull();
    expect(await nullMemory.remember("test")).toBe("");
    expect(await nullMemory.recall("test")).toEqual([]);
    expect(await nullMemory.prime("test")).toBeNull();
    expect(await nullMemory.ping()).toBe(true);
  });

  it("createHebbsMemory — returns a MemoryProvider with skill markdown", async () => {
    const { createHebbsMemory } = await import("@boringos/memory");
    const provider = createHebbsMemory({
      endpoint: "http://localhost:9999",
      apiKey: "test-key",
    });
    expect(provider.name).toBe("hebbs");
    expect(provider.skillMarkdown()).toContain("Memory Skill");
  });

  it("createHebbsMemory — ping returns false for unreachable server", async () => {
    const { createHebbsMemory } = await import("@boringos/memory");
    const provider = createHebbsMemory({
      endpoint: "http://localhost:1",
      apiKey: "test",
      timeout: 500,
    });
    expect(await provider.ping()).toBe(false);
  });
});

// ── Step 3: @boringos/runtime ─────────────────────────────────────────────

describe("@boringos/runtime", () => {
  it("createRuntimeRegistry — register and retrieve runtimes", async () => {
    const { createRuntimeRegistry, claudeRuntime, commandRuntime } = await import("@boringos/runtime");
    const registry = createRuntimeRegistry();

    registry.register(claudeRuntime);
    registry.register(commandRuntime);

    expect(registry.has("claude")).toBe(true);
    expect(registry.has("command")).toBe(true);
    expect(registry.has("unknown")).toBe(false);
    expect(registry.list()).toHaveLength(2);
  });

  it("createRuntimeRegistry — resolves aliases", async () => {
    const { createRuntimeRegistry, claudeRuntime } = await import("@boringos/runtime");
    const registry = createRuntimeRegistry();
    registry.register(claudeRuntime);

    // Legacy aliases should resolve
    const resolved = registry.get("claude_local");
    expect(resolved?.type).toBe("claude");
  });

  it("all 6 runtimes have skillMarkdown", async () => {
    const { claudeRuntime, chatgptRuntime, geminiRuntime, ollamaRuntime, commandRuntime, webhookRuntime } = await import("@boringos/runtime");
    for (const rt of [claudeRuntime, chatgptRuntime, geminiRuntime, ollamaRuntime, commandRuntime, webhookRuntime]) {
      expect(rt.skillMarkdown()).toBeTruthy();
    }
  });

  it("commandRuntime.testEnvironment — fails without command config", async () => {
    const { commandRuntime } = await import("@boringos/runtime");
    const result = await commandRuntime.testEnvironment({});
    expect(result.status).toBe("fail");
    expect(result.checks[0].code).toBe("command_not_configured");
  });
});

// ── Step 4: @boringos/drive ───────────────────────────────────────────────

describe("@boringos/drive", () => {
  it("createLocalStorage — write, read, exists, stat, delete", async () => {
    const { createLocalStorage } = await import("@boringos/drive");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const root = await mkdtemp(join(tmpdir(), "boringos-test-"));
    const storage = createLocalStorage({ root });

    // Write
    await storage.write("test.txt", "hello world");
    expect(await storage.exists("test.txt")).toBe(true);

    // Read
    const content = await storage.readText("test.txt");
    expect(content).toBe("hello world");

    // Stat
    const s = await storage.stat("test.txt");
    expect(s).not.toBeNull();
    expect(s!.size).toBe(11);

    // List
    const entries = await storage.list();
    expect(entries.some((e) => e.name === "test.txt")).toBe(true);

    // Delete
    await storage.delete("test.txt");
    expect(await storage.exists("test.txt")).toBe(false);
  });

  it("createLocalStorage — blocks path traversal", async () => {
    const { createLocalStorage } = await import("@boringos/drive");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const root = await mkdtemp(join(tmpdir(), "boringos-test-"));
    const storage = createLocalStorage({ root });

    await expect(storage.readText("../../../etc/passwd")).rejects.toThrow("Path traversal");
  });

  it("createLocalStorage — has skillMarkdown", async () => {
    const { createLocalStorage } = await import("@boringos/drive");
    const storage = createLocalStorage({ root: "/tmp/test" });
    expect(storage.skillMarkdown()).toContain("Drive");
  });

  it("scaffoldDrive — creates default folders", async () => {
    const { scaffoldDrive } = await import("@boringos/drive");
    const { mkdtemp, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const root = await mkdtemp(join(tmpdir(), "boringos-test-"));
    await scaffoldDrive(root, "test-tenant");

    const entries = await readdir(join(root, "test-tenant"));
    expect(entries).toContain("projects");
    expect(entries).toContain("agents");
    expect(entries).toContain("tasks");
    expect(entries).toContain("shared");
    expect(entries).toContain("inbox");
  });
});

// ── Step 5: @boringos/db ──────────────────────────────────────────────────

describe("@boringos/db", () => {
  it("FRAMEWORK_TABLES — lists expected tables", async () => {
    const { FRAMEWORK_TABLES } = await import("@boringos/db");
    expect(FRAMEWORK_TABLES).toContain("agents");
    expect(FRAMEWORK_TABLES).toContain("tasks");
    expect(FRAMEWORK_TABLES).toContain("agent_runs");
    expect(FRAMEWORK_TABLES).toContain("workflows");
    expect(FRAMEWORK_TABLES.length).toBeGreaterThan(15);
  });

  it("createDatabase — boots embedded Postgres and creates schema", async () => {
    const { createDatabase, createMigrationManager, tenants } = await import("@boringos/db");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-pg-"));
    const conn = await createDatabase(testDbConfig(dataDir, 5599));

    try {
      // Apply migrations
      const migrator = createMigrationManager(conn.db);
      await migrator.apply();

      // Insert a tenant
      await conn.db.insert(tenants).values({
        name: "Test Tenant",
        slug: "test-tenant",
      });

      // Query it back
      const rows = await conn.db.select().from(tenants);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Test Tenant");
      expect(rows[0].slug).toBe("test-tenant");
    } finally {
      await conn.close();
    }
  }, 30000);
});

// ── Step 6: @boringos/agent ───────────────────────────────────────────────

describe("@boringos/agent", () => {
  it("ContextPipeline — sorts by phase then priority", async () => {
    const { ContextPipeline } = await import("@boringos/agent");
    const pipeline = new ContextPipeline();

    pipeline.add({
      name: "context-second",
      phase: "context",
      priority: 20,
      async provide() { return "context-20"; },
    });
    pipeline.add({
      name: "system-first",
      phase: "system",
      priority: 10,
      async provide() { return "system-10"; },
    });
    pipeline.add({
      name: "context-first",
      phase: "context",
      priority: 10,
      async provide() { return "context-10"; },
    });

    const result = await pipeline.build({} as any);
    expect(result.systemInstructions).toBe("system-10");
    expect(result.contextMarkdown).toBe("context-10\n\ncontext-20");
  });

  it("ContextPipeline — skips null results", async () => {
    const { ContextPipeline } = await import("@boringos/agent");
    const pipeline = new ContextPipeline();

    pipeline.add({
      name: "present",
      phase: "system",
      priority: 1,
      async provide() { return "hello"; },
    });
    pipeline.add({
      name: "absent",
      phase: "system",
      priority: 2,
      async provide() { return null; },
    });

    const result = await pipeline.build({} as any);
    expect(result.systemInstructions).toBe("hello");
  });
});

// ── Step 7: @boringos/core ────────────────────────────────────────────────

describe("@boringos/core", () => {
  it("BoringOS — boots with embedded Postgres and responds to /health", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-smoke-"));

    const app = new BoringOS({
      database: testDbConfig(dataDir, 5598),
      drive: { root: join(dataDir, "drive") },
    });

    const server = await app.listen(0);

    try {
      // Health check
      const res = await fetch(`${server.url}/health`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe("ok");
    } finally {
      await server.close();
    }
  }, 30000);
});
