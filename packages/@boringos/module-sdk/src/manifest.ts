// SPDX-License-Identifier: LGPL-3.0-or-later
//
// MDK T2.2 — Static `module.json` schema.
//
// `module.json` is the manifest the host reads when installing a
// `.hebbsmod` bundle. It carries pack-time-only fields (entry, ui,
// publisher, license, minFrameworkVersion) plus the runtime-mirrored
// identity (id, version, kind, dependsOn, provides) that T2.1's
// derivation step keeps in sync with the Module factory at pack time.
//
// This file is the SINGLE source of truth for the manifest shape — it
// is consumed by:
//
//   - `pack-hebbsmod` (validates the on-disk manifest at pack time)
//   - the host's `install-manager` (validates uploaded `.hebbsmod`
//     bundles before running their migrations)
//   - the `hebbs` CLI (scaffolds + lints module.json)
//   - third-party module authors importing
//     `ManifestSchema` to typecheck their own JSON.

import { z } from "zod";

// Lowercased, hyphen-separated id. Stable across versions; used in
// tool URLs (`/api/tools/<id>.<verb>`) and persisted in audit rows.
export const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;

// Permissive semver: MAJOR.MINOR.PATCH with optional `-prerelease` and
// `+build`. Matches `pack-hebbsmod`'s historical regex so the schema
// upgrade is backward-compatible.
export const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const IdSchema = z
  .string()
  .min(1, "id is required")
  .regex(
    MODULE_ID_RE,
    "must be lowercase, hyphen-separated, start with a letter (e.g. `crm`, `inbox-triage`)",
  );

const SemverSchema = z
  .string()
  .min(1)
  .regex(SEMVER_RE, "must be semver-shaped (e.g. `1.2.3`, `1.2.3-beta.1`)");

const DependencyEntrySchema = z.union([
  // Capability-based — the host brokers whichever connector or module
  // `provides` this capability.
  z.object({
    capability: z.string().min(1),
    optional: z.boolean().optional(),
  }),
  // Module-id-based — pin a specific module, optionally with a
  // version range (npm semver range, e.g. `^0.3.0`).
  z.object({
    module: IdSchema,
    version: z.string().min(1).optional(),
    optional: z.boolean().optional(),
  }),
]);

const UiSchema = z.object({
  entry: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
});

const PublisherSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

/**
 * Zod schema for the `module.json` carried inside every `.hebbsmod` bundle.
 *
 * Required: `id`, `version`. Everything else is optional — the host
 * (and the runtime factory introspection in T2.1) fills in defaults.
 *
 * `unknown`-typed pass-through is allowed via `.passthrough()` so that
 * older bundles with extra fields (e.g. legacy custom metadata) still
 * parse cleanly; the schema enforces shape, not exclusivity.
 */
export const ManifestSchema = z
  .object({
    id: IdSchema,
    version: SemverSchema,

    // Identity / display.
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    kind: z.enum(["connector", "module", "hybrid"]).optional(),

    // Bundle layout.
    entry: z.string().min(1).optional(),
    ui: UiSchema.optional(),

    // Capability/module dependency graph.
    dependsOn: z.array(DependencyEntrySchema).optional(),
    provides: z.array(z.string().min(1)).optional(),

    // Provenance.
    publisher: PublisherSchema.optional(),
    license: z.string().min(1).optional(),

    // Install-time compatibility gate.
    minFrameworkVersion: SemverSchema.optional(),
    sdkVersion: SemverSchema.optional(),

    // Runtime hint (mirrors `Module.defaultInstall`).
    defaultInstall: z.boolean().optional(),
  })
  .passthrough();

/** Parsed manifest type — re-exported as the SDK-blessed shape. */
export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Parse a `module.json` payload into a typed `Manifest`. On failure,
 * throws an Error whose message lists each schema violation with its
 * path, so `pack-hebbsmod` and the install pipeline can surface
 * actionable feedback to module authors.
 *
 * Example error:
 *   module.json invalid:
 *     id: must be lowercase, hyphen-separated, start with a letter
 *     version: must be semver-shaped (e.g. `1.2.3`, ...)
 */
export function parseManifest(raw: unknown): Manifest {
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  ${path}: ${issue.message}`;
    });
    throw new Error(`module.json invalid:\n${lines.join("\n")}`);
  }
  return result.data;
}

/**
 * Lightweight version comparator for `minFrameworkVersion` enforcement.
 * Returns -1 if `a < b`, 0 if equal, 1 if `a > b`. Pre-release tags
 * are stripped (they compare as if equal to the base version) — the
 * host doesn't currently allow prerelease-only matches.
 *
 * Returns null if either argument isn't semver-shaped.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  if (!SEMVER_RE.test(a) || !SEMVER_RE.test(b)) return null;
  const parse = (s: string) =>
    s.replace(/[-+].*$/, "").split(".").map((n) => parseInt(n, 10));
  const [aM, am, ap] = parse(a);
  const [bM, bm, bp] = parse(b);
  if (aM !== bM) return aM < bM ? -1 : 1;
  if (am !== bm) return am < bm ? -1 : 1;
  if (ap !== bp) return ap < bp ? -1 : 1;
  return 0;
}

/**
 * Check that the host's framework version satisfies a manifest's
 * `minFrameworkVersion`. Returns `{ ok: true }` when satisfied (or
 * when the manifest doesn't declare a minimum). Returns
 * `{ ok: false, reason }` otherwise — callers use the reason in error
 * messages.
 */
export function checkMinFrameworkVersion(
  manifest: Pick<Manifest, "minFrameworkVersion">,
  hostVersion: string,
): { ok: true } | { ok: false; reason: string } {
  const min = manifest.minFrameworkVersion;
  if (!min) return { ok: true };
  const cmp = compareSemver(hostVersion, min);
  if (cmp === null) {
    return {
      ok: false,
      reason: `host framework version "${hostVersion}" is not semver-shaped`,
    };
  }
  if (cmp < 0) {
    return {
      ok: false,
      reason: `module requires framework >= ${min}, host is ${hostVersion}`,
    };
  }
  return { ok: true };
}
