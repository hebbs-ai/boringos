// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T2.2 — `module.json` zod schema + helpers.

import { describe, it, expect } from "vitest";
import {
  ManifestSchema,
  parseManifest,
  compareSemver,
  checkMinFrameworkVersion,
} from "../packages/@boringos/module-sdk/src/manifest.js";

describe("ManifestSchema — T2.2", () => {
  const minimal = { id: "crm", version: "0.3.0" };

  it("accepts the minimal manifest (id + version only)", () => {
    expect(() => parseManifest(minimal)).not.toThrow();
  });

  it("accepts the full CRM manifest shape", () => {
    const full = {
      id: "crm",
      version: "0.3.0",
      name: "CRM",
      description: "Sales CRM",
      kind: "module" as const,
      entry: "./index.mjs",
      ui: { entry: "./ui/index.mjs", sourcePath: "../web/dist" },
      dependsOn: [
        { capability: "email-send", optional: true },
        { capability: "file-storage", optional: true },
      ],
      provides: ["crm-source", "crm-actions"],
      publisher: { id: "hebbs", name: "Hebbs" },
      license: "GPL-3.0-or-later",
      minFrameworkVersion: "0.1.0",
    };
    expect(parseManifest(full)).toMatchObject(full);
  });

  it("rejects an invalid id", () => {
    expect(() => parseManifest({ id: "BadID", version: "1.0.0" })).toThrow(
      /id: must be lowercase/i,
    );
  });

  it("rejects a non-semver version", () => {
    expect(() => parseManifest({ id: "crm", version: "v1" })).toThrow(
      /version: must be semver-shaped/i,
    );
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      parseManifest({ id: "crm", version: "1.0.0", kind: "addon" }),
    ).toThrow(/kind/i);
  });

  it("rejects a `dependsOn` entry that's neither capability nor module", () => {
    expect(() =>
      parseManifest({
        id: "crm",
        version: "1.0.0",
        dependsOn: [{ foo: "bar" }],
      }),
    ).toThrow();
  });

  it("preserves extra fields via passthrough", () => {
    const m = parseManifest({
      ...minimal,
      // Hypothetical extension future scaffolders might write
      experimental: { feature: "x" },
    });
    expect((m as { experimental?: unknown }).experimental).toEqual({
      feature: "x",
    });
  });

  it("exposes the raw zod schema for direct use", () => {
    const result = ManifestSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});

describe("compareSemver — T2.2", () => {
  it("returns 0 on equal", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });
  it("returns -1 / 1 on ordering", () => {
    expect(compareSemver("0.1.8", "0.1.9")).toBe(-1);
    expect(compareSemver("0.2.0", "0.1.99")).toBe(1);
    expect(compareSemver("1.0.0", "0.99.0")).toBe(1);
  });
  it("ignores prerelease/build metadata", () => {
    expect(compareSemver("1.0.0-beta", "1.0.0")).toBe(0);
  });
  it("returns null on malformed input", () => {
    expect(compareSemver("v1", "1.0.0")).toBeNull();
  });
});

describe("checkMinFrameworkVersion — T2.2", () => {
  it("passes when minFrameworkVersion is absent", () => {
    expect(checkMinFrameworkVersion({}, "0.0.1")).toEqual({ ok: true });
  });
  it("passes when host >= minimum", () => {
    expect(
      checkMinFrameworkVersion({ minFrameworkVersion: "0.1.0" }, "0.1.0"),
    ).toEqual({ ok: true });
    expect(
      checkMinFrameworkVersion({ minFrameworkVersion: "0.1.0" }, "0.2.5"),
    ).toEqual({ ok: true });
  });
  it("fails when host < minimum", () => {
    const result = checkMinFrameworkVersion(
      { minFrameworkVersion: "0.2.0" },
      "0.1.9",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/0\.2\.0/);
      expect(result.reason).toMatch(/0\.1\.9/);
    }
  });
  it("fails when host version is malformed", () => {
    const result = checkMinFrameworkVersion(
      { minFrameworkVersion: "0.1.0" },
      "not-a-version",
    );
    expect(result.ok).toBe(false);
  });
});
