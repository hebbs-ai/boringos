/**
 * K8 — load DEFAULT_APPS_CATALOG entries from disk.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  loadCatalogFromDisk,
  loadCatalogStrict,
  CatalogLoaderError,
} from "@boringos/control-plane";

function fixtureApps(): string {
  const root = mkdtempSync(join(tmpdir(), "bos-k8-apps-"));

  // app A
  const aDir = join(root, "alpha");
  mkdirSync(join(aDir, "dist"), { recursive: true });
  writeFileSync(
    join(aDir, "boringos.json"),
    JSON.stringify({
      kind: "app",
      id: "alpha",
      version: "1.0.0",
      name: "Alpha",
      description: "First default app",
      publisher: { name: "BoringOS", verified: true },
      minRuntime: "1.0.0",
      license: "BUSL-1.1",
      hosting: "in-process",
      entityTypes: [],
      ui: { entry: "dist/ui.js" },
      capabilities: ["slots:nav"],
    }),
    "utf8",
  );
  writeFileSync(join(aDir, "dist", "ui.js"), "/* alpha bundle */", "utf8");

  // app B
  const bDir = join(root, "beta");
  mkdirSync(join(bDir, "dist"), { recursive: true });
  writeFileSync(
    join(bDir, "boringos.json"),
    JSON.stringify({
      kind: "app",
      id: "beta",
      version: "0.1.0",
      name: "Beta",
      description: "Second default app",
      publisher: { name: "BoringOS", verified: true },
      minRuntime: "1.0.0",
      license: "BUSL-1.1",
      hosting: "in-process",
      entityTypes: [],
      ui: { entry: "dist/ui.js" },
      capabilities: [],
    }),
    "utf8",
  );
  writeFileSync(join(bDir, "dist", "ui.js"), "/* beta bundle */", "utf8");

  // connector — must be skipped (not a default app)
  const cDir = join(root, "connector-slack");
  mkdirSync(join(cDir, "dist"), { recursive: true });
  writeFileSync(
    join(cDir, "boringos.json"),
    JSON.stringify({
      kind: "connector",
      id: "slack",
      version: "1.0.0",
      name: "Slack",
      description: "Slack connector",
      publisher: { name: "BoringOS", verified: true },
      minRuntime: "1.0.0",
      license: "MIT",
      entry: "dist/index.js",
      auth: { type: "oauth2", provider: "slack", scopes: [] },
      events: [],
      actions: [],
      capabilities: [],
    }),
    "utf8",
  );

  // directory without boringos.json — must be ignored
  mkdirSync(join(root, "garbage"), { recursive: true });

  return root;
}

describe("loadCatalogFromDisk", () => {
  it("returns a DefaultAppEntry for every app directory", () => {
    const dir = fixtureApps();
    try {
      const result = loadCatalogFromDisk(dir);
      expect(result.errors).toEqual([]);
      expect(result.entries.map((e) => e.id).sort()).toEqual(["alpha", "beta"]);

      const alpha = result.entries.find((e) => e.id === "alpha")!;
      expect(alpha.bundleText).toContain("alpha bundle");
      expect(alpha.manifest.name).toBe("Alpha");
      // SHA-256 over the manifest text.
      expect(alpha.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("manifest hash is deterministic for the same manifest and bundle", () => {
    const dir = fixtureApps();
    try {
      const result = loadCatalogFromDisk(dir);
      const alpha = result.entries.find((e) => e.id === "alpha")!;

      // Hash must exist and be a valid hex string
      expect(alpha.manifestHash).toMatch(/^[0-9a-f]{64}$/);

      // Loading the same catalog again should produce the same hash
      const result2 = loadCatalogFromDisk(dir);
      const alpha2 = result2.entries.find((e) => e.id === "alpha")!;
      expect(alpha2.manifestHash).toBe(alpha.manifestHash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("connector manifests are silently excluded from the catalog", () => {
    const dir = fixtureApps();
    try {
      const result = loadCatalogFromDisk(dir);
      expect(result.entries.find((e) => e.id === "slack")).toBeUndefined();
      expect(result.errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on a malformed manifest by default; collects in skip mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "bos-k8-bad-"));
    try {
      const badDir = join(dir, "broken");
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, "boringos.json"), "{ not json", "utf8");

      expect(() => loadCatalogFromDisk(dir)).toThrow(CatalogLoaderError);

      const skipped = loadCatalogFromDisk(dir, { skipMalformed: true });
      expect(skipped.entries).toEqual([]);
      expect(skipped.errors).toHaveLength(1);
      expect(skipped.errors[0]?.message).toMatch(/JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when the apps directory does not exist", () => {
    expect(() => loadCatalogFromDisk("/this/path/does/not/exist/k8")).toThrow(
      CatalogLoaderError,
    );
  });

  it("loadCatalogStrict returns the entries directly", () => {
    const dir = fixtureApps();
    try {
      const entries = loadCatalogStrict(dir);
      expect(entries.map((e) => e.id).sort()).toEqual(["alpha", "beta"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("works against the real apps/ directory used by the framework", async () => {
    // Smoke check: the actual apps/ directory in the repo has at least
    // generic-triage and generic-replier; both should load cleanly.
    const here = new URL(".", import.meta.url).pathname;
    // Tests live under repoRoot/tests; apps/ is sibling.
    const appsDir = join(here, "..", "apps");
    const result = loadCatalogFromDisk(appsDir, { skipMalformed: true });
    const ids = result.entries.map((e) => e.id);
    expect(ids).toContain("generic-triage");
    expect(ids).toContain("generic-replier");
  });
});
