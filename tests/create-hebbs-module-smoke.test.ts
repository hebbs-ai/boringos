// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T5.1 — `create-hebbs-module` scaffolder smoke. Scaffolds a
// brand-new module into a tmp dir, asserts the expected files
// exist + parseManifest accepts the generated module.json.
// (Boot-and-test against a NEW scaffold requires shipping an
// `@boringos/*` resolution path to the tmp dir — covered by T5.5
// once the scaffolder writes a runnable build alongside the
// source.)

import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "create-hebbs-module";
import { parseManifest } from "@boringos/module-sdk";

describe("MDK T5.1 — create-hebbs-module scaffolder", () => {
  it("emits the one-of-each template files (T5.2)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-hebbs-module-"));
    try {
      const result = await scaffold({
        id: "demo",
        targetDir: dir,
        displayName: "Demo Module",
        description: "Smoke-test scaffold.",
      });
      expect(result.id).toBe("demo");
      const expectedFiles = [
        "module.json",
        "package.json",
        "tsconfig.json",
        "src/module.ts",
        "src/index.ts",
        "src/skills/demo.md",
        "src/migrations/001-demo.sql",
        "README.md",
        ".gitignore",
      ];
      for (const f of expectedFiles) {
        expect(existsSync(join(dir, f))).toBe(true);
      }
      expect(result.files).toEqual(expect.arrayContaining(expectedFiles));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("module.ts carries each of the one-of-each surfaces (tool / skill / schema / agent / workflow / routine)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-hebbs-module-"));
    try {
      await scaffold({ id: "demo", targetDir: dir });
      const src = await readFile(join(dir, "src", "module.ts"), "utf8");
      expect(src).toMatch(/tools:\s*\[/);
      expect(src).toMatch(/skills:\s*\[/);
      expect(src).toMatch(/schema:\s*\[/);
      expect(src).toMatch(/agents:\s*\[/);
      expect(src).toMatch(/workflows:\s*\[/);
      expect(src).toMatch(/routines:\s*\[/);
      // Demo table name follows the `<id>__demo` convention.
      expect(src).toContain("demo__demo");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("kebab-case id sanitises the demo table name (underscores, not hyphens)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-hebbs-module-"));
    try {
      await scaffold({ id: "lead-router", targetDir: dir });
      const sql = await readFile(
        join(dir, "src", "migrations", "001-demo.sql"),
        "utf8",
      );
      expect(sql).toContain("lead_router__demo");
      expect(sql).not.toContain("lead-router__demo");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── T5.3 — recipe variants ─────────────────────────────────

  it("--template data emits two tables + items.create/items.list, no agents/workflows/routines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-hebbs-module-data-"));
    try {
      const result = await scaffold({ id: "shop", targetDir: dir, template: "data" });
      expect(result.template).toBe("data");
      const src = await readFile(join(dir, "src", "module.ts"), "utf8");
      expect(src).toContain("items.create");
      expect(src).toContain("items.list");
      expect(src).toContain("shop__demo_items");
      expect(src).toContain("shop__demo_categories");
      expect(src).not.toMatch(/agents:\s*\[/);
      expect(src).not.toMatch(/workflows:\s*\[/);
      expect(src).not.toMatch(/routines:\s*\[/);
      const sql = await readFile(
        join(dir, "src", "migrations", "001-demo.sql"),
        "utf8",
      );
      expect(sql).toContain("shop__demo_items");
      expect(sql).toContain("shop__demo_categories");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--template agent-only emits a seeded agent and no tools/schema/migrations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-hebbs-module-agent-"));
    try {
      const result = await scaffold({ id: "concierge", targetDir: dir, template: "agent-only" });
      expect(result.template).toBe("agent-only");
      const src = await readFile(join(dir, "src", "module.ts"), "utf8");
      expect(src).toMatch(/agents:\s*\[/);
      expect(src).not.toMatch(/tools:\s*\[/);
      expect(src).not.toMatch(/schema:\s*\[/);
      // Skips the migrations dir + file for non-schema templates.
      expect(existsSync(join(dir, "src", "migrations"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--template connector-consumer wires @boringos/connector-google + email-send capability", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-hebbs-module-conn-"));
    try {
      const result = await scaffold({
        id: "inbox-watcher",
        targetDir: dir,
        template: "connector-consumer",
      });
      expect(result.template).toBe("connector-consumer");
      const src = await readFile(join(dir, "src", "module.ts"), "utf8");
      const pkg = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };
      const manifest = JSON.parse(
        await readFile(join(dir, "module.json"), "utf8"),
      ) as { dependsOn?: Array<{ capability: string }> };
      expect(src).toContain('import { GmailClient } from "@boringos/connector-google"');
      expect(src).toContain('deps.getConnectorToken?.("google"');
      expect(pkg.dependencies["@boringos/connector-google"]).toBeTruthy();
      expect(manifest.dependsOn).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ capability: "email-send" }),
        ]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--template <unknown> throws before touching disk", async () => {
    await expect(
      scaffold({
        id: "demo",
        targetDir: "/tmp/never-touched-2",
        // @ts-expect-error — testing runtime guard
        template: "fancy",
      }),
    ).rejects.toThrow(/unknown template/);
  });

  it("generates a module.json that parses against the SDK schema", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-hebbs-module-"));
    try {
      await scaffold({ id: "hello", targetDir: dir });
      const raw = JSON.parse(
        await readFile(join(dir, "module.json"), "utf8"),
      );
      const parsed = parseManifest(raw);
      expect(parsed.id).toBe("hello");
      expect(parsed.version).toBe("0.1.0");
      expect(parsed.kind).toBe("module");
      expect(parsed.minFrameworkVersion).toBe("0.1.0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid ids before touching disk", async () => {
    await expect(
      scaffold({ id: "BadID", targetDir: "/tmp/never-touched" }),
    ).rejects.toThrow(/invalid id/i);
  });

  it("refuses to overwrite an existing module", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-hebbs-module-"));
    try {
      await scaffold({ id: "demo1", targetDir: dir });
      await expect(
        scaffold({ id: "demo2", targetDir: dir }),
      ).rejects.toThrow(/refusing to overwrite/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits a kebab-case id as PascalCase in createXModule", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-hebbs-module-"));
    try {
      await scaffold({ id: "lead-router", targetDir: dir });
      const factorySrc = await readFile(
        join(dir, "src", "module.ts"),
        "utf8",
      );
      expect(factorySrc).toContain("createLeadRouterModule");
      expect(factorySrc).toContain('id: "lead-router"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
