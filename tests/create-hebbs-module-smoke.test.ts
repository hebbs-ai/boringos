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
      // Postgres unquoted identifiers can't contain hyphens.
      expect(sql).toContain("lead_router__demo");
      expect(sql).not.toContain("lead-router__demo");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
