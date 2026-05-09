/**
 * v2 SKILL.md disk-loading tests — Chunk B of the final session.
 *
 * Verifies the module registry's string-form skill ref handler:
 *  - reads files relative to __moduleDir
 *  - parses YAML frontmatter (id, priority, roles, requires)
 *  - returns inline Skill objects from the registry as before
 *  - missing files log + skip (don't crash registration)
 */
import { describe, it, expect } from "vitest";

describe("v2 — SKILL.md disk loading", () => {
  it("loads a SKILL.md file via string ref + parses frontmatter", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const {
      createToolRegistry,
      createSkillRegistry,
      createModuleRegistry,
    } = await import("@boringos/agent");

    const moduleDir = await mkdtemp(join(tmpdir(), "boringos-skill-load-"));
    const skillPath = join(moduleDir, "SKILL.md");
    await writeFile(
      skillPath,
      `---
id: test-skill
priority: 42
roles: [cto, engineer]
requires: [framework.tasks.create]
---

# Test skill body

This is the body. Paragraph two.
`,
    );

    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register({
      id: "test-mod",
      name: "Test",
      version: "0.1.0",
      description: "...",
      __moduleDir: moduleDir,
      skills: ["./SKILL.md"],
    });

    const all = skills.list();
    expect(all).toHaveLength(1);
    expect(all[0].skill.id).toBe("test-skill");
    expect(all[0].skill.priority).toBe(42);
    expect(all[0].skill.body).toContain("Test skill body");
    expect(all[0].skill.body).toContain("Paragraph two");
    expect(all[0].skill.requires).toEqual(["framework.tasks.create"]);

    // Role gating works.
    expect(
      all[0].skill.appliesTo!({
        tenantId: "t",
        agentId: "a",
        agentRole: "cto",
      }),
    ).toBe(true);
    expect(
      all[0].skill.appliesTo!({
        tenantId: "t",
        agentId: "a",
        agentRole: "designer",
      }),
    ).toBe(false);
  });

  it("loads a SKILL.md without frontmatter — entire body is content", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createToolRegistry, createSkillRegistry, createModuleRegistry } =
      await import("@boringos/agent");

    const moduleDir = await mkdtemp(join(tmpdir(), "boringos-skill-noframe-"));
    await writeFile(join(moduleDir, "SKILL.md"), "Plain markdown, no frontmatter.");

    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register({
      id: "plain",
      name: "Plain",
      version: "0.1.0",
      description: "...",
      __moduleDir: moduleDir,
      skills: ["./SKILL.md"],
    });

    const all = skills.list();
    expect(all).toHaveLength(1);
    expect(all[0].skill.id).toBe("plain.skill"); // fallback
    expect(all[0].skill.body).toBe("Plain markdown, no frontmatter.");
    expect(all[0].skill.priority).toBeUndefined();
  });

  it("missing SKILL.md file logs + skips (registration still succeeds)", async () => {
    const { createToolRegistry, createSkillRegistry, createModuleRegistry } =
      await import("@boringos/agent");

    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    expect(() =>
      modules.register({
        id: "missing-file",
        name: "Missing",
        version: "0.1.0",
        description: "...",
        __moduleDir: "/this/path/does/not/exist",
        skills: ["./SKILL.md"],
      }),
    ).not.toThrow();

    expect(skills.list()).toHaveLength(0);
    expect(modules.list()).toHaveLength(1);
  });

  it("inline Skill objects coexist with file-loaded ones in the same module", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createToolRegistry, createSkillRegistry, createModuleRegistry } =
      await import("@boringos/agent");

    const moduleDir = await mkdtemp(join(tmpdir(), "boringos-skill-mix-"));
    await writeFile(
      join(moduleDir, "FROM_DISK.md"),
      `---
id: from-disk
priority: 100
---
disk body`,
    );

    const tools = createToolRegistry();
    const skills = createSkillRegistry();
    const modules = createModuleRegistry({ tools, skills });

    modules.register({
      id: "mixed",
      name: "Mixed",
      version: "0.1.0",
      description: "...",
      __moduleDir: moduleDir,
      skills: [
        "./FROM_DISK.md",
        {
          id: "inline",
          source: "module",
          body: "inline body",
          priority: 50,
        },
      ],
    });

    const all = skills.list();
    expect(all).toHaveLength(2);
    // Sorted by priority asc → inline (50) before from-disk (100).
    expect(all.map((s) => s.skill.id)).toEqual(["inline", "from-disk"]);
  });
});
