#!/usr/bin/env node
// SPDX-License-Identifier: MIT
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
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import archiver from "archiver";
import * as esbuild from "esbuild";

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
  ui?: { entry?: string };
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

function resolvePaths(pkgDir: string): ResolvedPaths {
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

  // UI prebuilt assets: prefer dist/ui/ then ui/dist/.
  const uiCandidates = [
    resolvePath(pkgDir, "dist/ui"),
    resolvePath(pkgDir, "ui/dist"),
  ];
  const uiDir = uiCandidates.find((p) => isDirSync(p)) ?? null;

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

function validateManifest(
  manifest: ModuleManifestStatic,
  pkg: PackageJson,
): void {
  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("module.json: missing required string field 'id'");
  }
  if (!ID_RE.test(manifest.id)) {
    throw new Error(
      `module.json: invalid 'id' "${manifest.id}". ` +
        `Must match /^[a-z][a-z0-9-]*$/ (lowercase, hyphenated).`,
    );
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    throw new Error("module.json: missing required string field 'version'");
  }
  if (!SEMVER_RE.test(manifest.version)) {
    throw new Error(
      `module.json: invalid 'version' "${manifest.version}". ` +
        `Must be semver-shaped (e.g. 1.2.3 or 1.2.3-beta.1).`,
    );
  }
  if (
    pkg.version &&
    pkg.version !== manifest.version
  ) {
    // Not fatal — package.json can lag — but warn loudly.
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

  const paths = resolvePaths(args.pkg);
  const pkg = readJson<PackageJson>(paths.packageJson);
  const manifest = readJson<ModuleManifestStatic>(paths.moduleJson);
  validateManifest(manifest, pkg);

  if (!existsSync(paths.distDir)) {
    mkdirSync(paths.distDir, { recursive: true });
  }

  process.stdout.write(
    `[pack-hebbsmod] bundling ${paths.entryPoint}\n`,
  );
  await bundleEntry(paths.entryPoint, paths.bundleOut);

  const outZip = resolvePath(
    paths.distDir,
    `${manifest.id}-${manifest.version}.hebbsmod`,
  );

  process.stdout.write(`[pack-hebbsmod] zipping → ${outZip}\n`);
  await writeZip({
    bundleOut: paths.bundleOut,
    moduleJson: paths.moduleJson,
    skillsDir: paths.skillsDir,
    migrationsDir: paths.migrationsDir,
    uiDir: paths.uiDir,
    outZip,
  });

  const size = statSync(outZip).size;
  const hash = await sha256OfFile(outZip);

  process.stdout.write(
    [
      "",
      "  packed .hebbsmod",
      `    id:      ${manifest.id}`,
      `    version: ${manifest.version}`,
      `    kind:    ${manifest.kind ?? "(unset)"}`,
      `    size:    ${formatBytes(size)} (${size} bytes)`,
      `    sha256:  ${hash}`,
      `    output:  ${outZip}`,
      "",
    ].join("\n"),
  );
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
