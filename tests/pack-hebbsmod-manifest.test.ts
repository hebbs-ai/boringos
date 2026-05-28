// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T2.1 — pack-hebbsmod manifest derivation.
//
// `pack-hebbsmod` reads a static `module.json` AND dynamic-imports the
// bundled entry to pull the Module factory's runtime manifest fields out.
// `mergeManifest()` is the pure function that decides which fields win.
// Runtime fields (id/name/version/description/kind/dependsOn/provides/
// defaultInstall) override; pack-time-only fields (entry, ui, publisher,
// license, minFrameworkVersion) come from the static manifest unchanged.

import { describe, it, expect } from "vitest";
import { mergeManifest } from "../packages/@boringos/module-sdk/src/cli/pack-hebbsmod.js";

describe("pack-hebbsmod / mergeManifest — T2.1", () => {
  const staticManifest = {
    id: "crm",
    version: "0.3.0",
    kind: "module" as const,
    name: "CRM",
    description: "Sales CRM",
    entry: "./index.mjs",
    ui: { entry: "./ui/index.mjs", sourcePath: "../web/dist" },
    publisher: { id: "hebbs", name: "Hebbs" },
    license: "GPL-3.0-or-later",
    minFrameworkVersion: "0.1.0",
  };

  it("returns the static manifest unchanged when there's no runtime input", () => {
    const result = mergeManifest(staticManifest, undefined);
    expect(result.drift).toEqual([]);
    expect(result.manifest).toEqual(staticManifest);
  });

  it("overrides id/version/name/description from the runtime Module", () => {
    const runtime = {
      id: "crm",
      version: "0.2.0", // ← drift! src/module.ts says 0.2.0, module.json says 0.3.0
      name: "CRM",
      description: "Sales CRM",
    };
    const result = mergeManifest(staticManifest, runtime);
    expect(result.manifest.version).toBe("0.2.0"); // factory wins
    expect(result.drift).toContain('version: "0.3.0" → "0.2.0"');
  });

  it("preserves pack-time-only fields (entry/ui/publisher/license/minFrameworkVersion)", () => {
    const runtime = { id: "crm", version: "0.2.0" };
    const result = mergeManifest(staticManifest, runtime);
    expect(result.manifest.entry).toBe("./index.mjs");
    expect(result.manifest.ui).toEqual({
      entry: "./ui/index.mjs",
      sourcePath: "../web/dist",
    });
    expect(result.manifest.publisher).toEqual({ id: "hebbs", name: "Hebbs" });
    expect(result.manifest.license).toBe("GPL-3.0-or-later");
    expect(result.manifest.minFrameworkVersion).toBe("0.1.0");
  });

  it("ignores non-string or empty runtime values for required string fields", () => {
    const runtime = {
      id: "",
      version: 0.2 as unknown,
      name: null,
      description: undefined,
    };
    const result = mergeManifest(staticManifest, runtime);
    expect(result.manifest.id).toBe("crm");
    expect(result.manifest.version).toBe("0.3.0");
    expect(result.manifest.name).toBe("CRM");
    expect(result.manifest.description).toBe("Sales CRM");
    expect(result.drift).toEqual([]);
  });

  it("overrides kind / dependsOn / provides / defaultInstall when the runtime sets them", () => {
    const runtime = {
      kind: "hybrid",
      dependsOn: [{ capability: "email-send", optional: true }],
      provides: ["crm-source"],
      defaultInstall: false,
    };
    const result = mergeManifest(staticManifest, runtime);
    expect(result.manifest.kind).toBe("hybrid");
    expect(result.manifest.dependsOn).toEqual([
      { capability: "email-send", optional: true },
    ]);
    expect(result.manifest.provides).toEqual(["crm-source"]);
    expect(result.manifest.defaultInstall).toBe(false);
    expect(result.drift).toContain('kind: "module" → "hybrid"');
  });

  it("does not report drift when runtime matches static", () => {
    const runtime = {
      id: "crm",
      version: "0.3.0",
      name: "CRM",
      description: "Sales CRM",
      kind: "module",
    };
    const result = mergeManifest(staticManifest, runtime);
    expect(result.drift).toEqual([]);
  });

  it("populates the merged manifest even when the static one is missing optional fields", () => {
    const minimalStatic = { id: "demo", version: "0.0.1" };
    const runtime = {
      id: "demo",
      version: "0.0.2",
      name: "Demo",
      description: "Demo module",
      kind: "module",
    };
    const result = mergeManifest(minimalStatic, runtime);
    expect(result.manifest.name).toBe("Demo");
    expect(result.manifest.description).toBe("Demo module");
    expect(result.manifest.kind).toBe("module");
    expect(result.drift).toContain('version: "0.0.1" → "0.0.2"');
  });
});
