// SPDX-License-Identifier: AGPL-3.0-or-later
//
// task_22 U3.1 / U3.3 / U3.5 — `.hebbsmod` package upload + delete +
// list routes. Mounts under `/api/admin/modules`.
//
// Three concerns:
//
//  - POST /upload          — multipart upload of a `.hebbsmod` zip,
//                            extract → validate → signature-verify →
//                            atomic-move to MODULES_STORE_DIR →
//                            dynamic-import → registerModule().
//
//  - DELETE /:id           — remove the host-global package record.
//                            Refuses while any tenant still has it
//                            installed unless `?force=true`. Calls
//                            installManager.uninstall(...) for each
//                            tenant when forcing.
//
//  - GET /packages         — list every uploaded `module_packages` row
//                            for the UI Apps screen.
//
// Activity log entries are written for upload + delete (task_22 U3.5).
// `activity_log.entity_id` is a UUID column; since module packages
// have a string id ("crm"), we derive a deterministic v5-style UUID
// from (module-id, version) so subsequent queries by entity_id are
// stable across runs.

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir, readFile, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import AdmZip from "adm-zip";
import type { Db } from "@boringos/db";
import { activityLog, modulePackages, moduleInstalls } from "@boringos/db";
import { generateId } from "@boringos/shared";
import type { InstallManager } from "@boringos/agent";
import {
  checkMinFrameworkVersion,
  inferModuleKind,
  type Module,
  type ModuleFactory,
  type ModuleFactoryDeps,
  type ModuleKind,
} from "@boringos/module-sdk";

interface PackageRoutesEnv {
  Variables: {
    tenantId?: string;
  };
}

/**
 * Minimal surface of the host the routes need. Passed in rather than
 * importing the BoringOS class to avoid a self-import; tests can stub
 * it cheaply.
 */
export interface ModulePackageRoutesHost {
  registerModule(
    mod: Module | ModuleFactory,
    factoryDeps?: ModuleFactoryDeps,
  ): Promise<{ moduleId: string; toolsAdded: number; skillsAdded: number }>;
  unregisterModule(id: string): Promise<{
    moduleId: string;
    toolsRemoved: number;
    skillsRemoved: number;
    restartRecommended: true;
  }>;
  readonly factoryDeps: ModuleFactoryDeps | null;
}

export interface ModulePackageRoutesDeps {
  db: Db;
  host: ModulePackageRoutesHost;
  installManager: InstallManager;
  /** Optional override for the on-disk extract root. Defaults to
   *  `<cwd>/.data/module-store/` or `$MODULES_STORE_DIR`. */
  modulesStoreDir?: string;
  /**
   * Host framework version, used to evaluate each uploaded bundle's
   * `module.json.minFrameworkVersion`. When undefined, the
   * `minFrameworkVersion` field is ignored at upload time (back-compat
   * fallback). Set this in production so too-new bundles fail fast
   * with an `incompatible_framework` error rather than crashing later
   * at registerModule time. MDK T2.3.
   */
  frameworkVersion?: string;
  /** Reads the auth context. Reuses the existing admin pattern
   *  (`X-Tenant-Id` for machine clients; sessions resolved upstream). */
  resolveTenantId: (req: Request) => string | null;
  /** Optional realtime bus for `module:uploaded` / `module:deleted`
   *  SSE events. The shell's Modules screen invalidates its package
   *  + registry queries on each so multi-tab UX stays in sync. */
  realtimeBus?: {
    publish(event: {
      type: string;
      tenantId: string;
      data: Record<string, unknown>;
      timestamp: string;
    }): void;
  };
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const KIND_VALUES: readonly ModuleKind[] = ["connector", "module", "hybrid"];

interface ParsedManifest {
  id: string;
  version: string;
  kind?: ModuleKind;
  /** MDK T2.3 — minimum framework version this bundle requires. */
  minFrameworkVersion?: string;
}

function validateManifest(raw: unknown): { ok: true; manifest: ParsedManifest } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "module.json is not a JSON object" };
  const m = raw as Record<string, unknown>;
  const id = m.id;
  const version = m.version;
  const kind = m.kind;
  const minFrameworkVersion = m.minFrameworkVersion;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    return { ok: false, reason: `module.json.id must match ${ID_PATTERN}` };
  }
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    return { ok: false, reason: `module.json.version must be semver (got ${JSON.stringify(version)})` };
  }
  if (kind !== undefined && kind !== null) {
    if (typeof kind !== "string" || !(KIND_VALUES as readonly string[]).includes(kind)) {
      return { ok: false, reason: `module.json.kind must be one of ${KIND_VALUES.join("|")}` };
    }
  }
  if (minFrameworkVersion !== undefined && minFrameworkVersion !== null) {
    if (typeof minFrameworkVersion !== "string" || !SEMVER_PATTERN.test(minFrameworkVersion)) {
      return {
        ok: false,
        reason: `module.json.minFrameworkVersion must be semver (got ${JSON.stringify(minFrameworkVersion)})`,
      };
    }
  }
  return {
    ok: true,
    manifest: {
      id,
      version,
      kind: (kind ?? undefined) as ModuleKind | undefined,
      minFrameworkVersion:
        typeof minFrameworkVersion === "string" ? minFrameworkVersion : undefined,
    },
  };
}

// Wraps the real Ed25519 verifier from `./module-signature.ts` with
// dev-mode policy: when `HEBBS_DEV_MODULES=true` we pass `allowUnsigned`,
// otherwise the call is fail-closed (any unsigned or invalid signature
// rejects the upload).
import {
  verifyModuleSignature as verifyModuleSignatureCore,
  loadTrustedPublishers,
} from "./module-signature.js";

function verifyModuleSignature(
  extractedDir: string,
  manifestId: string,
): { ok: boolean; reason?: string; publisherId: string | null } {
  const devMode = process.env.HEBBS_DEV_MODULES === "true";
  const result = verifyModuleSignatureCore(extractedDir, {
    allowUnsigned: devMode,
    trustedPublishers: loadTrustedPublishers(),
  });
  if (result.ok && devMode && result.publisherId === null) {
    // eslint-disable-next-line no-console
    console.warn(
      `[module-package] accepting unsigned bundle "${manifestId}" — ` +
        "HEBBS_DEV_MODULES=true. Do NOT run with this flag in production.",
    );
  }
  return result;
}

/**
 * Synthesize a stable UUID for use as `activity_log.entity_id`. The
 * underlying column is a uuid; module packages are keyed by string id
 * + semver. We hash (id|version) into a v4-shaped UUID so distinct
 * versions of the same module get distinct entity ids.
 */
function packageEntityId(id: string, version: string): string {
  const h = createHash("sha1").update(`${id}@${version}`).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `${(parseInt(h.charAt(16), 16) & 0x3 | 0x8).toString(16)}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
}

function defaultStoreDir(): string {
  return (
    process.env.MODULES_STORE_DIR ??
    pathResolve(process.cwd(), ".data", "module-store")
  );
}

async function logActivity(
  db: Db,
  tenantId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  // activity_log.tenant_id is notNull + FK to tenants.id. Module
  // package events are host-global, but the uploading admin always
  // belongs to some tenant — record that tenant for traceability. If
  // no tenant id is on the request, skip the log entry (we can't
  // satisfy the FK).
  if (!tenantId) return;
  try {
    await db.insert(activityLog).values({
      id: generateId(),
      tenantId,
      action,
      entityType,
      entityId,
      actorType: "user",
      metadata,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[module-package] activity_log insert failed for ${action}:`, err);
  }
}

export function createModulePackageRoutes(
  deps: ModulePackageRoutesDeps,
): Hono<PackageRoutesEnv> {
  const app = new Hono<PackageRoutesEnv>();
  const storeRoot = deps.modulesStoreDir ?? defaultStoreDir();

  // ── GET /packages ─────────────────────────────────────────────────
  app.get("/packages", async (c) => {
    const rows = await deps.db.select().from(modulePackages);
    return c.json({
      packages: rows.map((r) => ({
        id: r.id,
        version: r.version,
        kind: r.kind,
        storePath: r.storePath,
        contentHash: r.contentHash,
        signaturePublisherId: r.signaturePublisherId,
        uploadedAt: r.uploadedAt,
      })),
    });
  });

  // ── POST /upload ──────────────────────────────────────────────────
  app.post("/upload", async (c) => {
    const tenantIdHeader = deps.resolveTenantId(c.req.raw);
    const force = c.req.query("force") === "true";

    // 1. Read the multipart body. We only accept `file` field.
    let parsed: Record<string, unknown>;
    try {
      parsed = (await c.req.parseBody()) as Record<string, unknown>;
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: {
            code: "invalid_input",
            message:
              "Expected multipart/form-data with a 'file' field; could not parse the request body.",
            detail: err instanceof Error ? err.message : String(err),
          },
        },
        400,
      );
    }
    const fileEntry = parsed["file"];
    if (!(fileEntry instanceof File) && !(fileEntry instanceof Blob)) {
      return c.json(
        {
          ok: false,
          error: {
            code: "invalid_input",
            message: "Multipart 'file' field is required and must be a file blob.",
          },
        },
        400,
      );
    }

    const buf = Buffer.from(await (fileEntry as Blob).arrayBuffer());
    const contentHash = createHash("sha256").update(buf).digest("hex");

    // 2. Duplicate content-hash short-circuit.
    const existingByHash = await deps.db
      .select()
      .from(modulePackages)
      .where(eq(modulePackages.contentHash, contentHash))
      .limit(1);
    if (existingByHash.length > 0 && !force) {
      const row = existingByHash[0];
      return c.json(
        {
          ok: false,
          error: {
            code: "duplicate",
            message: `An identical bundle is already uploaded for ${row.id}@${row.version}. Pass ?force=true to overwrite.`,
            existing: {
              id: row.id,
              version: row.version,
              kind: row.kind,
              storePath: row.storePath,
            },
          },
        },
        409,
      );
    }

    // 3. Extract to a tmp dir; validate manifest.
    const extractRoot = await mkdtemp(join(tmpdir(), "hebbsmod-"));
    let manifest: ParsedManifest;
    try {
      try {
        const zip = new AdmZip(buf);
        zip.extractAllTo(extractRoot, /* overwrite */ true);
      } catch (err) {
        await rm(extractRoot, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: {
              code: "invalid_bundle",
              message: "Failed to read .hebbsmod zip.",
              detail: err instanceof Error ? err.message : String(err),
            },
          },
          400,
        );
      }

      const manifestPath = join(extractRoot, "module.json");
      if (!existsSync(manifestPath)) {
        await rm(extractRoot, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: {
              code: "invalid_bundle",
              message: "module.json missing at the root of the .hebbsmod bundle.",
            },
          },
          400,
        );
      }

      let manifestRaw: unknown;
      try {
        const text = await readFile(manifestPath, "utf8");
        manifestRaw = JSON.parse(text);
      } catch (err) {
        await rm(extractRoot, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: {
              code: "invalid_bundle",
              message: "module.json could not be parsed as JSON.",
              detail: err instanceof Error ? err.message : String(err),
            },
          },
          400,
        );
      }

      const validation = validateManifest(manifestRaw);
      if (!validation.ok) {
        await rm(extractRoot, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: { code: "invalid_manifest", message: validation.reason },
          },
          400,
        );
      }
      manifest = validation.manifest;

      // MDK T2.3 — enforce minFrameworkVersion before any side-effect.
      if (deps.frameworkVersion && manifest.minFrameworkVersion) {
        const compat = checkMinFrameworkVersion(
          { minFrameworkVersion: manifest.minFrameworkVersion },
          deps.frameworkVersion,
        );
        if (!compat.ok) {
          await rm(extractRoot, { recursive: true, force: true });
          return c.json(
            {
              ok: false,
              error: {
                code: "incompatible_framework",
                message: `${manifest.id}@${manifest.version}: ${compat.reason}`,
              },
            },
            400,
          );
        }
      }

      // 4. Version-exists check.
      const existingByVersion = await deps.db
        .select()
        .from(modulePackages)
        .where(
          and(
            eq(modulePackages.id, manifest.id),
            eq(modulePackages.version, manifest.version),
          ),
        )
        .limit(1);
      if (existingByVersion.length > 0 && !force) {
        await rm(extractRoot, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: {
              code: "version_exists",
              message: `${manifest.id}@${manifest.version} is already uploaded. Pass ?force=true to overwrite.`,
              existing: {
                id: existingByVersion[0].id,
                version: existingByVersion[0].version,
                storePath: existingByVersion[0].storePath,
              },
            },
          },
          409,
        );
      }

      // 5. Signature verify (stubbed — see TODO above).
      const sig = verifyModuleSignature(extractRoot, manifest.id);
      if (!sig.ok) {
        await rm(extractRoot, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: { code: "signature_invalid", message: sig.reason ?? "Signature invalid." },
          },
          403,
        );
      }

      // 6. Atomic move into the store dir.
      const finalDir = join(storeRoot, `${manifest.id}@${manifest.version}`);
      // If force=true: tear down any prior copy + the in-memory
      // registration before swapping bits.
      if (existsSync(finalDir)) {
        if (!force) {
          await rm(extractRoot, { recursive: true, force: true });
          return c.json(
            {
              ok: false,
              error: {
                code: "store_path_exists",
                message: `Store directory ${finalDir} already exists for ${manifest.id}@${manifest.version}. Pass ?force=true to overwrite.`,
              },
            },
            409,
          );
        }
        await rm(finalDir, { recursive: true, force: true });
      }
      if (force) {
        try {
          await deps.host.unregisterModule(manifest.id);
        } catch {
          // No prior in-memory registration is fine.
        }
      }
      await mkdir(storeRoot, { recursive: true });
      try {
        await rename(extractRoot, finalDir);
      } catch (err) {
        // Cross-device rename — fall back to recursive copy.
        await mkdir(finalDir, { recursive: true });
        const zip = new AdmZip(buf);
        zip.extractAllTo(finalDir, true);
        await rm(extractRoot, { recursive: true, force: true });
        void err;
      }

      // 7. Dynamic import + register.
      const entryUrl = new URL(`file://${finalDir}/index.mjs`);
      let imported: Record<string, unknown> | null = null;
      try {
        imported = (await import(entryUrl.href)) as Record<string, unknown>;
      } catch (err) {
        await rm(finalDir, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: {
              code: "import_failed",
              message: "Bundled index.mjs failed to import.",
              detail: err instanceof Error ? err.message : String(err),
            },
          },
          400,
        );
      }
      // Resolve the entry: prefer `default`, then the conventional
      // `create<Id>Module` factory name pack-hebbsmod emits. This
      // matches the U2 demo's `try-runtime-install.mjs` resolver.
      const factoryName = `create${manifest.id.charAt(0).toUpperCase()}${manifest.id.slice(1)}Module`;
      const entry =
        (imported?.["default"] as Module | ModuleFactory | undefined) ??
        (imported?.[factoryName] as Module | ModuleFactory | undefined);
      if (!entry || (typeof entry !== "function" && typeof entry !== "object")) {
        await rm(finalDir, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: {
              code: "invalid_bundle",
              message:
                "Bundled index.mjs must export the Module / ModuleFactory as `default` " +
                `or as the conventional \`${factoryName}\` named export.`,
              detail: `keys=${Object.keys(imported ?? {}).join(",")}`,
            },
          },
          400,
        );
      }

      const factoryDeps = deps.host.factoryDeps ?? undefined;
      let registerResult;
      try {
        registerResult = await deps.host.registerModule(entry, factoryDeps);
      } catch (err) {
        await rm(finalDir, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: {
              code: "register_failed",
              message: "registerModule() threw.",
              detail: err instanceof Error ? err.message : String(err),
            },
          },
          400,
        );
      }

      // 8. Sanity-check: runtime export's id/version must match the manifest.
      // We re-resolve the registered module shape by id from the host's
      // bound list via the install manager (it sees the boundModules
      // array). Cheap: just re-import-side-effect-free check via the
      // entry object when it's a static Module.
      const resolvedId =
        typeof entry === "function" ? registerResult.moduleId : entry.id;
      const resolvedVersion =
        typeof entry === "function" ? null : entry.version;
      if (resolvedId !== manifest.id) {
        await deps.host.unregisterModule(resolvedId).catch(() => {});
        await rm(finalDir, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: {
              code: "manifest_mismatch",
              message: `Bundled module id "${resolvedId}" does not match module.json id "${manifest.id}".`,
            },
          },
          400,
        );
      }
      if (resolvedVersion !== null && resolvedVersion !== manifest.version) {
        await deps.host.unregisterModule(resolvedId).catch(() => {});
        await rm(finalDir, { recursive: true, force: true });
        return c.json(
          {
            ok: false,
            error: {
              code: "manifest_mismatch",
              message: `Bundled module version "${resolvedVersion}" does not match module.json version "${manifest.version}".`,
            },
          },
          400,
        );
      }

      // 9. Persist the row. Use onConflict so force=true overwrites cleanly.
      const inferredKind =
        manifest.kind ??
        (typeof entry === "function" ? "module" : inferModuleKind(entry));

      await deps.db
        .insert(modulePackages)
        .values({
          id: manifest.id,
          version: manifest.version,
          kind: inferredKind,
          storePath: finalDir,
          contentHash,
          signaturePublisherId: sig.publisherId,
        })
        .onConflictDoUpdate({
          target: [modulePackages.id, modulePackages.version],
          set: {
            kind: inferredKind,
            storePath: finalDir,
            contentHash,
            signaturePublisherId: sig.publisherId,
            uploadedAt: new Date(),
          },
        });

      // 10. Activity log (host-global action recorded against the
      // uploader's tenant for traceability).
      await logActivity(
        deps.db,
        tenantIdHeader,
        "module.uploaded",
        "module_package",
        packageEntityId(manifest.id, manifest.version),
        {
          moduleId: manifest.id,
          version: manifest.version,
          kind: inferredKind,
          contentHash,
          toolsAdded: registerResult.toolsAdded,
          skillsAdded: registerResult.skillsAdded,
          force,
        },
      );

      // 11. Realtime bus — shell Modules screen invalidates queries.
      deps.realtimeBus?.publish({
        type: "module:uploaded",
        tenantId: tenantIdHeader ?? "host",
        data: {
          moduleId: manifest.id,
          version: manifest.version,
          kind: inferredKind,
          contentHash,
          toolsAdded: registerResult.toolsAdded,
          skillsAdded: registerResult.skillsAdded,
        },
        timestamp: new Date().toISOString(),
      });

      return c.json(
        {
          ok: true,
          id: manifest.id,
          version: manifest.version,
          kind: inferredKind,
          contentHash,
          toolsAdded: registerResult.toolsAdded,
          skillsAdded: registerResult.skillsAdded,
          storePath: finalDir,
        },
        201,
      );
    } catch (err) {
      await rm(extractRoot, { recursive: true, force: true }).catch(() => {});
      // eslint-disable-next-line no-console
      console.error("[module-package] /upload failed:", err);
      return c.json(
        {
          ok: false,
          error: {
            code: "internal_error",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        500,
      );
    }
  });

  // ── DELETE /:id ───────────────────────────────────────────────────
  app.delete("/:id", async (c) => {
    const tenantIdHeader = deps.resolveTenantId(c.req.raw);
    const id = c.req.param("id");
    const version = c.req.query("version");
    const force = c.req.query("force") === "true";

    if (!version) {
      return c.json(
        {
          ok: false,
          error: {
            code: "invalid_input",
            message: "?version=<semver> is required (no implicit 'latest').",
          },
        },
        400,
      );
    }

    const rows = await deps.db
      .select()
      .from(modulePackages)
      .where(
        and(eq(modulePackages.id, id), eq(modulePackages.version, version)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json(
        {
          ok: false,
          error: { code: "not_found", message: `${id}@${version} is not uploaded.` },
        },
        404,
      );
    }

    // Tenants with this module still installed.
    const installRows = await deps.db
      .select({ tenantId: moduleInstalls.tenantId })
      .from(moduleInstalls)
      .where(eq(moduleInstalls.moduleId, id));

    if (installRows.length > 0 && !force) {
      return c.json(
        {
          ok: false,
          error: {
            code: "installed",
            message: `${id} is installed for ${installRows.length} tenant(s). Pass ?force=true to uninstall + delete.`,
            tenants: installRows.map((r) => r.tenantId),
          },
        },
        409,
      );
    }

    // Force path: walk tenants + uninstall each. Collect failures
    // but don't abort — leaving the package half-removed is worse.
    const uninstallFailures: Array<{ tenantId: string; reason: string }> = [];
    if (force && installRows.length > 0) {
      for (const ir of installRows) {
        try {
          const res = await deps.installManager.uninstall(id, ir.tenantId);
          if (!res.ok && res.hookError) {
            uninstallFailures.push({ tenantId: ir.tenantId, reason: res.hookError });
          }
        } catch (err) {
          uninstallFailures.push({
            tenantId: ir.tenantId,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    let unregResult: Awaited<ReturnType<ModulePackageRoutesHost["unregisterModule"]>> = {
      moduleId: id,
      toolsRemoved: 0,
      skillsRemoved: 0,
      restartRecommended: true,
    };
    try {
      unregResult = await deps.host.unregisterModule(id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[module-package] unregisterModule(${id}) threw:`, err);
    }

    await deps.db
      .delete(modulePackages)
      .where(
        and(eq(modulePackages.id, id), eq(modulePackages.version, version)),
      );

    // Remove the extracted store directory. Best-effort.
    try {
      if (existsSync(row.storePath)) {
        const s = await stat(row.storePath);
        if (s.isDirectory()) await rm(row.storePath, { recursive: true, force: true });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[module-package] rm -rf ${row.storePath} failed:`, err);
    }

    await logActivity(
      deps.db,
      tenantIdHeader,
      "module.deleted",
      "module_package",
      packageEntityId(id, version),
      {
        moduleId: id,
        version,
        force,
        toolsRemoved: unregResult.toolsRemoved,
        skillsRemoved: unregResult.skillsRemoved,
        uninstallFailures,
      },
    );

    // Realtime bus — shell Modules screen invalidates queries.
    deps.realtimeBus?.publish({
      type: "module:deleted",
      tenantId: tenantIdHeader ?? "host",
      data: {
        moduleId: id,
        version,
        force,
        toolsRemoved: unregResult.toolsRemoved,
        skillsRemoved: unregResult.skillsRemoved,
      },
      timestamp: new Date().toISOString(),
    });

    return c.json({
      ok: true,
      id,
      version,
      toolsRemoved: unregResult.toolsRemoved,
      skillsRemoved: unregResult.skillsRemoved,
      restartRecommended: true,
      uninstallFailures,
    });
  });

  return app;
}

// Exported for tests + tooling.
export { packageEntityId, validateManifest, defaultStoreDir };

// Suppress unused-randomUUID warning if codepaths shift later.
void randomUUID;
