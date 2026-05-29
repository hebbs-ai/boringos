// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T7.5 — codemod runner + bundled `module-ui-to-plugin-ui` codemod.

import { afterAll, describe, it, expect } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runCodemod,
  bundledCodemods,
  moduleUiToPluginUi,
} from "@boringos/hebbs-cli";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

async function makeSource(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hebbs-codemod-"));
  dirs.push(dir);
  await mkdir(join(dir, "src"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, "src", name), body);
  }
  return dir;
}

describe("MDK T7.5 — codemod runner", () => {
  it("bundles at least one codemod by stable id", () => {
    expect(bundledCodemods.length).toBeGreaterThan(0);
    expect(bundledCodemods.some((c) => c.id === "module-ui-to-plugin-ui")).toBe(true);
  });

  it("dry-run reports which files would change without touching them", async () => {
    const dir = await makeSource({
      "module.ts": `import { ModuleUI } from "@boringos/module-sdk";\nexport const ui: ModuleUI = { screens: [] };\n`,
      "noop.ts": `export const x = 1;\n`,
    });
    const result = await runCodemod(moduleUiToPluginUi, { modulePath: dir });
    expect(result.scannedFiles).toBe(2);
    expect(result.changedFiles.length).toBe(1);
    // On-disk content is unchanged in dry-run.
    const onDisk = await readFile(join(dir, "src", "module.ts"), "utf8");
    expect(onDisk).toContain("ModuleUI");
  });

  it("--write applies the rename for ModuleUI → PluginUI", async () => {
    const dir = await makeSource({
      "module.ts": `import { ModuleUI, z } from "@boringos/module-sdk";\nexport const ui: ModuleUI = { screens: [] };\n`,
    });
    const result = await runCodemod(moduleUiToPluginUi, { modulePath: dir, write: true });
    expect(result.changedFiles.length).toBe(1);
    const updated = await readFile(join(dir, "src", "module.ts"), "utf8");
    expect(updated).not.toContain("ModuleUI");
    expect(updated).toContain("PluginUI");
    // The non-renamed import (z) is preserved.
    expect(updated).toContain("z");
  });

  it("leaves files without the deprecated import unchanged", async () => {
    const dir = await makeSource({
      "clean.ts": `import { z } from "@boringos/module-sdk";\nexport const inputs = z.object({});\n`,
    });
    const result = await runCodemod(moduleUiToPluginUi, { modulePath: dir, write: true });
    expect(result.changedFiles.length).toBe(0);
  });
});
