#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// pack-hebbsmod — bundles a Module package into a single `.hebbsmod`
// archive, the upload artifact for the `/api/admin/modules/upload`
// flow (see docs/install-flow.md §1.1).
//
// Usage:
//   pack-hebbsmod                 # defaults to cwd
//   pack-hebbsmod --pkg <path>    # explicit package path
//   pack-hebbsmod --help          # print usage
//
// The CLI:
//   1. Reads `<pkg>/package.json` for name/version.
//   2. Reads `<pkg>/module.json` — the static manifest. Required.
//   3. esbuild-bundles `<pkg>/src/module.ts` (or `src/index.ts` as
//      fallback) into `<pkg>/dist/index.mjs`, with all
//      `@boringos/*` packages marked external.
//   4. Zips `{module.json, index.mjs, skills/, migrations/, ui/}`
//      into `<pkg>/dist/<id>-<version>.hebbsmod`.
//   5. SHA-256s the result and prints a summary to stdout.
//
// Exits non-zero on validation failure (missing module.json,
// invalid id, non-semver version, missing entrypoint, …).

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import archiver from "archiver";
import * as esbuild from "esbuild";

import { parseManifest } from "../manifest.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ID_RE = /^[a-z][a-z0-9-]*$/;
// Permissive semver: MAJOR.MINOR.PATCH with optional -prerelease and +build.
const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

interface CliArgs {
  pkg: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { pkg: process.cwd(), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a === "--pkg") {
      const next = argv[i + 1];
      if (!next) throw new Error("--pkg requires a path argument");
      args.pkg = resolvePath(next);
      i++;
    } else if (a && a.startsWith("--pkg=")) {
      args.pkg = resolvePath(a.slice("--pkg=".length));
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      "pack-hebbsmod — bundle a Module package into a .hebbsmod archive",
      "",
      "Usage:",
      "  pack-hebbsmod [--pkg <path>]",
      "",
      "Options:",
      "  --pkg <path>   Package directory to pack (default: cwd)",
      "  -h, --help     Show this help",
      "",
      "Required files in <pkg>:",
      "  package.json   for name + version",
      "  module.json    static manifest (id, version, kind, ...)",
      "  src/module.ts  or src/index.ts (entrypoint)",
      "",
      "Optional directories copied into the bundle:",
      "  src/skills/, src/migrations/, dist/ui/ (or ui/dist/)",
      "",
      "Output: <pkg>/dist/<id>-<version>.hebbsmod",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Manifest types (loose — only what we read)
// ---------------------------------------------------------------------------

interface PackageJson {
  name?: string;
  version?: string;
}

interface ModuleManifestStatic {
  id: string;
  version: string;
  kind?: "connector" | "module" | "hybrid";
  name?: string;
  description?: string;
  entry?: string;
  /**
   * Optional UI block.
   *
   * - `entry` — relative path inside the bundled `ui/` directory the
   *   shell dynamic-imports (e.g. `./ui/index.mjs`).
   * - `sourcePath` — path RELATIVE to the package directory pointing
   *   at the prebuilt UI assets to copy into the bundle. Use this
   *   when your UI build output lives in a sibling package (the
   *   Vite-monorepo pattern), e.g. `"../web/dist"`. If absent the
   *   CLI falls back to `<pkg>/dist/ui/` then `<pkg>/ui/dist/`.
   */
  ui?: { entry?: string; sourcePath?: string };
  dependsOn?: unknown;
  provides?: unknown;
  permissions?: unknown;
  publisher?: { id?: string; name?: string };
  license?: string;
  minFrameworkVersion?: string;
  // Allow arbitrary extension without losing typing.
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function readJson<T>(path: string): T {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as T;
}

function isDirSync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFileSync(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Build steps
// ---------------------------------------------------------------------------

interface ResolvedPaths {
  pkgDir: string;
  packageJson: string;
  moduleJson: string;
  entryPoint: string;
  distDir: string;
  bundleOut: string;
  skillsDir: string | null;
  migrationsDir: string | null;
  uiDir: string | null;
}

function resolvePaths(
  pkgDir: string,
  manifest?: ModuleManifestStatic,
): ResolvedPaths {
  if (!isDirSync(pkgDir)) {
    throw new Error(`Package directory not found: ${pkgDir}`);
  }

  const packageJson = resolvePath(pkgDir, "package.json");
  if (!isFileSync(packageJson)) {
    throw new Error(`Missing package.json in ${pkgDir}`);
  }

  const moduleJson = resolvePath(pkgDir, "module.json");
  if (!isFileSync(moduleJson)) {
    throw new Error(
      `Missing module.json in ${pkgDir}.\n` +
        `pack-hebbsmod requires a static module.json at the package root ` +
        `(see docs/install-flow.md §1.2). Generate one alongside src/module.ts ` +
        `with at least { "id": "...", "version": "...", "kind": "..." }.`,
    );
  }

  const moduleTs = resolvePath(pkgDir, "src/module.ts");
  const indexTs = resolvePath(pkgDir, "src/index.ts");
  let entryPoint: string;
  if (isFileSync(moduleTs)) {
    entryPoint = moduleTs;
  } else if (isFileSync(indexTs)) {
    entryPoint = indexTs;
  } else {
    throw new Error(
      `No entrypoint found. Expected one of:\n` +
        `  ${moduleTs}\n` +
        `  ${indexTs}`,
    );
  }

  const distDir = resolvePath(pkgDir, "dist");
  const bundleOut = resolvePath(distDir, "index.mjs");

  const skillsDir = resolvePath(pkgDir, "src/skills");
  const migrationsDir = resolvePath(pkgDir, "src/migrations");

  // UI prebuilt assets — resolution order:
  //   1. `module.json` → `ui.sourcePath` (relative to pkgDir). The
  //      Vite-monorepo pattern: the web build lives in a sibling
  //      package (`"../web/dist"`), not inside the server pkg itself.
  //   2. `<pkg>/dist/ui/`  (in-pkg "post-build assembly" pattern)
  //   3. `<pkg>/ui/dist/`  (in-pkg "co-located vite" pattern)
  let uiDir: string | null = null;
  const sourcePath = manifest?.ui?.sourcePath;
  if (typeof sourcePath === "string" && sourcePath.length > 0) {
    if (isAbsolute(sourcePath)) {
      throw new Error(
        `module.json: ui.sourcePath must be relative to the package directory ` +
          `(got absolute path "${sourcePath}").`,
      );
    }
    // Sanity guard: reject paths that escape the workspace by more
    // than 3 levels. A monorepo `../web/dist` is one `..`; the limit
    // gives breathing room for nested layouts without letting a
    // malformed manifest point at /etc.
    const upHops = (sourcePath.match(/(^|[\\/])\.\.(?=[\\/]|$)/g) ?? []).length;
    if (upHops > 3) {
      throw new Error(
        `module.json: ui.sourcePath escapes the workspace (${upHops} '..' segments). ` +
          `Limit is 3.`,
      );
    }
    const candidate = resolvePath(pkgDir, sourcePath);
    if (!isDirSync(candidate)) {
      // The manifest explicitly opted in — fail loud so the operator
      // notices that their build didn't produce the expected output.
      throw new Error(
        `module.json: ui.sourcePath "${sourcePath}" resolves to ${candidate}, ` +
          `which does not exist or is not a directory. Did the UI package ` +
          `build before pack-hebbsmod ran?`,
      );
    }
    uiDir = candidate;
  } else {
    const uiCandidates = [
      resolvePath(pkgDir, "dist/ui"),
      resolvePath(pkgDir, "ui/dist"),
    ];
    uiDir = uiCandidates.find((p) => isDirSync(p)) ?? null;
  }

  return {
    pkgDir,
    packageJson,
    moduleJson,
    entryPoint,
    distDir,
    bundleOut,
    skillsDir: isDirSync(skillsDir) ? skillsDir : null,
    migrationsDir: isDirSync(migrationsDir) ? migrationsDir : null,
    uiDir,
  };
}

/**
 * Recursively count files under `dir` for the post-pack summary.
 */
function countFilesRecursive(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolvePath(dir, entry.name);
    if (entry.isDirectory()) {
      n += countFilesRecursive(full);
    } else if (entry.isFile()) {
      n += 1;
    }
  }
  return n;
}

// MDK T2.2 — id/version shape validation now lives in `manifest.ts`
// via `parseManifest()`. This stub keeps the package.json-vs-manifest
// version cross-check (a soft warning, not a hard fail).
function warnOnPackageVersionDrift(
  manifest: ModuleManifestStatic,
  pkg: PackageJson,
): void {
  if (pkg.version && pkg.version !== manifest.version) {
    process.stderr.write(
      `[pack-hebbsmod] warning: package.json version "${pkg.version}" ` +
        `does not match module.json version "${manifest.version}". ` +
        `Using module.json.\n`,
    );
  }
}

async function bundleEntry(
  entryPoint: string,
  outFile: string,
): Promise<void> {
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    // Every framework package is provided by the host at runtime.
    external: ["@boringos/*"],
    // CJS deps that get pulled into ESM bundles (e.g. @grpc/grpc-js
    // via @google-cloud/...) use the runtime `require()` to load
    // their internal submodules. Pure ESM doesn't define `require`,
    // so esbuild's CJS-in-ESM shim throws
    // `Dynamic require of "process" is not supported` at load time.
    // The standard fix is to inject a `createRequire(import.meta.url)`
    // banner so those internal `require()` calls resolve normally.
    // Surfaced by task_22 U2 PoC — without this banner, the runtime
    // dynamic-import of a packed CRM bundle dies before reaching the
    // factory call.
    banner: {
      js: "import { createRequire as __hebbsCreateRequire } from \"node:module\";\nconst require = __hebbsCreateRequire(import.meta.url);",
    },
    // Keep readable JS — the bundle is < 2MB and inspected during
    // signature verification; minification gains nothing here.
    minify: false,
    sourcemap: false,
    legalComments: "inline",
    logLevel: "warning",
  });
}

interface ZipPlan {
  bundleOut: string;
  moduleJson: string;
  skillsDir: string | null;
  migrationsDir: string | null;
  uiDir: string | null;
  outZip: string;
}

// ---------------------------------------------------------------------------
// Manifest derivation — MDK T2.1
// ---------------------------------------------------------------------------
//
// Source of truth for runtime fields (id, name, version, description, kind,
// dependsOn, provides, defaultInstall) is the Module factory itself. The
// on-disk module.json carries pack-time-only fields (entry, ui, publisher,
// license, minFrameworkVersion). At pack time we dynamic-import the bundle,
// call the factory with a stub deps object, read the resulting Module, and
// produce a merged manifest where runtime fields win.
//
// A factory that throws on stub deps (real production modules sometimes do)
// degrades gracefully: a warning is printed and the on-disk manifest is used
// verbatim. CI can opt into strict mode via --strict (future work) but for
// now the design is "warn and proceed" so existing packagings keep working.
//
// Author-facing impact: drift between `src/module.ts`'s `version` and
// `module.json`'s `version` is no longer silently shipped — the .hebbsmod
// will carry the runtime version, and the drift is announced on stdout.

interface RuntimeManifestFields {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  kind?: unknown;
  dependsOn?: unknown;
  provides?: unknown;
  defaultInstall?: unknown;
}

/**
 * Merge a static (on-disk) manifest with the runtime Module's manifest fields.
 * Runtime fields override; pack-time-only fields (entry, ui, publisher,
 * license, minFrameworkVersion) come from the static manifest unchanged.
 * Returns the merged manifest plus a list of drifted fields for reporting.
 *
 * Exported for unit testing.
 */
export function mergeManifest(
  staticManifest: ModuleManifestStatic,
  runtime: RuntimeManifestFields | undefined,
): { manifest: ModuleManifestStatic; drift: string[] } {
  if (!runtime) {
    return { manifest: staticManifest, drift: [] };
  }
  const drift: string[] = [];
  const merged: ModuleManifestStatic = { ...staticManifest };

  function applyString<K extends "id" | "version" | "name" | "description">(
    key: K,
    rawRuntime: unknown,
  ): void {
    if (typeof rawRuntime !== "string" || rawRuntime.length === 0) return;
    const existing = staticManifest[key];
    if (existing !== undefined && existing !== rawRuntime) {
      drift.push(`${key}: "${String(existing)}" → "${rawRuntime}"`);
    }
    (merged as Record<string, unknown>)[key] = rawRuntime;
  }
  applyString("id", runtime.id);
  applyString("version", runtime.version);
  applyString("name", runtime.name);
  applyString("description", runtime.description);

  if (typeof runtime.kind === "string") {
    if (
      staticManifest.kind !== undefined &&
      staticManifest.kind !== runtime.kind
    ) {
      drift.push(`kind: "${staticManifest.kind}" → "${runtime.kind}"`);
    }
    merged.kind = runtime.kind as ModuleManifestStatic["kind"];
  }
  if (runtime.dependsOn !== undefined) merged.dependsOn = runtime.dependsOn;
  if (runtime.provides !== undefined) merged.provides = runtime.provides;
  if (runtime.defaultInstall !== undefined) {
    merged.defaultInstall = runtime.defaultInstall;
  }

  return { manifest: merged, drift };
}

/**
 * Dynamic-import the bundled entry, call the factory with a stub deps
 * object, and pull the resulting Module's manifest fields out for merging.
 * Never throws — failure to introspect logs a warning and returns undefined.
 */
async function readRuntimeManifest(
  bundlePath: string,
  manifestId: string,
): Promise<RuntimeManifestFields | undefined> {
  try {
    const bundleUrl = pathToFileURL(bundlePath).href;
    const mod = (await import(bundleUrl)) as Record<string, unknown>;
    const candidates = [
      mod.default,
      mod[`create${capitalizeId(manifestId)}Module`],
      ...Object.values(mod).filter((v) => typeof v === "function"),
    ];
    const factory = candidates.find((v) => typeof v === "function") as
      | ((deps: Record<string, unknown>) => unknown)
      | undefined;
    if (!factory) return undefined;
    const result = await factory({});
    if (result && typeof result === "object") {
      return result as RuntimeManifestFields;
    }
    return undefined;
  } catch (err) {
    process.stderr.write(
      `[pack-hebbsmod] factory introspection skipped — could not call the ` +
        `factory with stub deps (${(err as Error).message}). The bundled ` +
        `module.json will use the on-disk static manifest verbatim.\n`,
    );
    return undefined;
  }
}

function capitalizeId(s: string): string {
  // crm-tools → CrmTools
  return s
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

async function writeZip(plan: ZipPlan): Promise<void> {
  await new Promise<void>((resolveP, rejectP) => {
    const output = createWriteStream(plan.outZip);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolveP());
    output.on("error", rejectP);
    archive.on("warning", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        process.stderr.write(`[pack-hebbsmod] archiver warning: ${err.message}\n`);
      } else {
        rejectP(err);
      }
    });
    archive.on("error", rejectP);

    archive.pipe(output);

    archive.file(plan.moduleJson, { name: "module.json" });
    archive.file(plan.bundleOut, { name: "index.mjs" });
    if (plan.skillsDir) {
      archive.directory(plan.skillsDir, "skills");
    }
    if (plan.migrationsDir) {
      archive.directory(plan.migrationsDir, "migrations");
    }
    if (plan.uiDir) {
      archive.directory(plan.uiDir, "ui");
    }

    archive.finalize().catch(rejectP);
  });
}

function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const h = createHash("sha256");
    const s = createReadStream(path);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => resolveP(h.digest("hex")));
    s.on("error", rejectP);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`pack-hebbsmod: ${(err as Error).message}\n\n`);
    printHelp();
    process.exit(2);
  }

  if (args.help) {
    printHelp();
    return;
  }

  // Read the manifest first so `resolvePaths` can honour
  // `ui.sourcePath`. The manifest path itself is computed by
  // resolvePaths, but for that one read we just hard-code the
  // conventional location — resolvePaths verifies it exists.
  const manifestPath = resolvePath(args.pkg, "module.json");
  const earlyManifest = isFileSync(manifestPath)
    ? readJson<ModuleManifestStatic>(manifestPath)
    : undefined;

  const paths = resolvePaths(args.pkg, earlyManifest);
  const pkg = readJson<PackageJson>(paths.packageJson);
  const rawManifest =
    earlyManifest ?? readJson<unknown>(paths.moduleJson);
  // MDK T2.2 — single zod-validated parse. Replaces the pre-T2.2
  // ad-hoc field-by-field validateManifest(). Throws on shape errors.
  const parsedManifest = parseManifest(rawManifest);
  // ModuleManifestStatic predates the zod schema; treat the parsed
  // value as compatible since the zod shape is a superset.
  const manifest = parsedManifest as ModuleManifestStatic;
  warnOnPackageVersionDrift(manifest, pkg);

  if (!existsSync(paths.distDir)) {
    mkdirSync(paths.distDir, { recursive: true });
  }

  process.stdout.write(
    `[pack-hebbsmod] bundling ${paths.entryPoint}\n`,
  );
  await bundleEntry(paths.entryPoint, paths.bundleOut);

  const outZip = resolvePath(
    paths.distDir,
    `__placeholder__.hebbsmod`,
  );

  // MDK T2.1 — pull the runtime Module's manifest fields out of the
  // bundle and use them as the source of truth for id/version/name/
  // description/kind/dependsOn/provides/defaultInstall. The merged
  // manifest is what lands in the archive; the on-disk module.json
  // stays untouched.
  const runtime = await readRuntimeManifest(paths.bundleOut, manifest.id);
  const { manifest: mergedManifest, drift } = mergeManifest(manifest, runtime);
  if (drift.length > 0) {
    process.stdout.write(
      `[pack-hebbsmod] manifest drift detected (runtime factory wins):\n` +
        drift.map((d) => `  ${d}\n`).join("") +
        `  Source of truth: src/module.ts. Update module.json to match (or delete it once T2.1's generator-from-package.json lands).\n`,
    );
  }

  // Write the merged manifest to a side path inside dist/ so the
  // user's on-disk module.json is preserved. The archive renames it
  // to module.json at the bundle root.
  const mergedManifestPath = resolvePath(paths.distDir, "module.derived.json");
  writeFileSync(
    mergedManifestPath,
    JSON.stringify(mergedManifest, null, 2) + "\n",
  );

  // Recompute outZip using the merged manifest's id+version so the
  // file name matches what the bundle actually claims to be.
  const finalOutZip = resolvePath(
    paths.distDir,
    `${mergedManifest.id}-${mergedManifest.version}.hebbsmod`,
  );

  process.stdout.write(`[pack-hebbsmod] zipping → ${finalOutZip}\n`);
  await writeZip({
    bundleOut: paths.bundleOut,
    moduleJson: mergedManifestPath,
    skillsDir: paths.skillsDir,
    migrationsDir: paths.migrationsDir,
    uiDir: paths.uiDir,
    outZip: finalOutZip,
  });

  const size = statSync(finalOutZip).size;
  const hash = await sha256OfFile(finalOutZip);

  let uiSummary = "none";
  if (paths.uiDir) {
    const fileCount = countFilesRecursive(paths.uiDir);
    const rel = relative(paths.pkgDir, paths.uiDir) || paths.uiDir;
    uiSummary = `copied ${fileCount} file(s) from ${rel}`;
  }

  process.stdout.write(
    [
      "",
      "  packed .hebbsmod",
      `    id:      ${mergedManifest.id}`,
      `    version: ${mergedManifest.version}`,
      `    kind:    ${mergedManifest.kind ?? "(unset)"}`,
      `    size:    ${formatBytes(size)} (${size} bytes)`,
      `    sha256:  ${hash}`,
      `    ui:      ${uiSummary}`,
      `    output:  ${finalOutZip}`,
      "",
    ].join("\n"),
  );

  // outZip used outside the await block above (linter dead-code guard).
  void outZip;
}

// Only run when invoked as a CLI (not when imported for testing).
// Under pnpm, argv[1] is the symlink path inside .bin/, while
// import.meta.url is the realpath-resolved location. Compare via
// realpath on both sides so the binary recognizes itself.
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolvePath(p);
  }
}
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  safeRealpath(process.argv[1]) === safeRealpath(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`pack-hebbsmod: ${msg}\n`);
    process.exit(1);
  });
}
