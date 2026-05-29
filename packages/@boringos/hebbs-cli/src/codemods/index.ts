// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T7.5 — codemod runner foundation.
//
// Intentionally small: regex-based transforms over source files, no
// ts-morph / jscodeshift / babel dep. Authors get migration help
// without the CLI taking on a ~3MB AST library.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";

export interface CodemodContext {
  /** Relative path under the module root, for diagnostics. */
  file: string;
}

export interface Codemod {
  /** Stable identifier (used by --codemod flag + by doctor's
   *  auto-fix path). */
  id: string;
  /** One-line summary printed by the runner. */
  description: string;
  /** Glob-free extension filter — apply to files with these extensions only. */
  extensions: readonly string[];
  /** Transform a source string. Return the input unchanged when
   *  nothing matched. */
  transform: (source: string, ctx: CodemodContext) => string;
}

export interface CodemodRunResult {
  codemodId: string;
  /** Files the codemod modified. */
  changedFiles: string[];
  /** Files scanned regardless of change. */
  scannedFiles: number;
}

export interface RunOptions {
  /** Module root. Codemod walks `src/**` under it. */
  modulePath: string;
  /** If true, write changes back. Default `false` — dry-run. */
  write?: boolean;
}

/** Apply one codemod to every source file under `modulePath/src`. */
export async function runCodemod(
  codemod: Codemod,
  opts: RunOptions,
): Promise<CodemodRunResult> {
  const srcDir = join(opts.modulePath, "src");
  const changedFiles: string[] = [];
  const files: string[] = [];
  await walk(srcDir, codemod.extensions, files);
  for (const f of files) {
    const before = await readFile(f, "utf8");
    const after = codemod.transform(before, { file: f });
    if (after !== before) {
      changedFiles.push(f);
      if (opts.write) {
        await writeFile(f, after);
      }
    }
  }
  return {
    codemodId: codemod.id,
    changedFiles,
    scannedFiles: files.length,
  };
}

async function walk(
  dir: string,
  extensions: readonly string[],
  out: string[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      await walk(full, extensions, out);
      continue;
    }
    if (extensions.includes(extname(name))) out.push(full);
  }
}

// ── Bundled codemods ──────────────────────────────────────────────

/**
 * Ships with the SDK. Rewrites the deprecated `ModuleUI` import to
 * `PluginUI` so the source compiles against the post-T3.2 surface.
 * The structural change (moving slots from a `ui` field to a
 * separate web bundle) still needs a manual pass — see
 * BUILD-A-MODULE.md — but this codemod handles the rename.
 */
export const moduleUiToPluginUi: Codemod = {
  id: "module-ui-to-plugin-ui",
  description:
    "Rename deprecated `ModuleUI` import to `PluginUI` (MDK T3.2 migration).",
  extensions: [".ts", ".tsx", ".mts"],
  transform(source) {
    let out = source;
    // import { ModuleUI } from "@boringos/module-sdk"
    out = out.replace(
      /(import\s*(?:type\s+)?\{[^}]*?\b)ModuleUI(\b[^}]*?\}\s*from\s*["']@boringos\/module-sdk["'])/g,
      "$1PluginUI$2",
    );
    // Any remaining bare `ModuleUI` type reference (post-import-rename).
    out = out.replace(/\bModuleUI\b/g, "PluginUI");
    return out;
  },
};

export const bundledCodemods: readonly Codemod[] = [moduleUiToPluginUi];
