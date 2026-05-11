// SPDX-License-Identifier: MIT
//
// task_22 / U2.2 — GO/NO-GO gate (kept around as an end-to-end
// regression after U5 cut CRM over to upload-only).
//
// Boots BoringOS with every built-in (CRM is no longer in the static
// list — it's upload-only), extracts `tests/fixtures/crm-0.2.0.hebbsmod`,
// dynamically imports its `index.mjs`, hands the resulting factory to
// `app.registerModule()`, signs up a tenant, installs CRM for that
// tenant, dispatches `crm.contacts.create`, and asserts the DB row.
//
// Exit code 0 means the runtime-register architecture is validated
// (GO). Any failure short-circuits with a NO-GO summary.

import { mkdtemp, rm, readFile, mkdir, symlink, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";

import {
  BoringOS,
  createFrameworkModule,
  createMemoryModule,
  createDriveModule,
  createInboxModule,
  createWorkflowModule,
  createCopilotModule,
  createSlackModule,
  createGoogleModule,
  createTriageModule,
  createInboxTriageModule,
  createInboxReplierModule,
} from "@boringos/core";
import { signCallbackToken } from "@boringos/agent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

// Use a per-run port that's almost certainly free.
const HTTP_PORT = 0; // ephemeral
const PG_PORT = 5500 + Math.floor(Math.random() * 200);

const fixturePath = join(repoRoot, "tests", "fixtures", "crm-0.2.0.hebbsmod");
if (!existsSync(fixturePath)) {
  console.error(`[try-runtime-install] FAIL — fixture not found: ${fixturePath}`);
  process.exit(1);
}

const steps = [];
function step(name, ok, detail) {
  steps.push({ name, ok, detail });
  const mark = ok ? "OK " : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

let dataDir;
let harnessRoot;
let extractDir;
let server;
let exitCode = 0;

try {
  // ── 1. Boot BoringOS with built-ins (NO static CRM wiring) ──────
  dataDir = await mkdtemp(join(tmpdir(), "u2-poc-"));
  // Extract bundle under the workspace tree so Node's resolver
  // can find @boringos/module-sdk / @boringos/connector-google
  // via the monorepo's node_modules — bundles externalise those.
  // Two-level layout: <repoRoot>/.u2-poc-*/<random>/extract holds
  // the bundle, and a sibling proto/ dir gets populated to work
  // around the @hebbs-typescript proto-path bug (see step 3 below).
  harnessRoot = await mkdtemp(join(repoRoot, ".u2-poc-"));
  extractDir = join(harnessRoot, "extract");
  await mkdir(extractDir, { recursive: true });
  console.log(`[try-runtime-install] dataDir=${dataDir} extractDir=${extractDir} pgPort=${PG_PORT}`);

  const app = new BoringOS({
    database: { embedded: true, port: PG_PORT, dataDir: join(dataDir, "pg") },
    drive: { root: join(dataDir, "drive") },
    auth: { secret: "u2-poc-secret" },
    queue: { concurrency: 1 },
  });
  app.module(createFrameworkModule);
  app.module(createMemoryModule);
  app.module(createDriveModule);
  app.module(createInboxModule);
  app.module(createWorkflowModule);
  app.module(createCopilotModule);
  app.module(createSlackModule);
  app.module(createGoogleModule);
  app.module(createTriageModule);
  app.module(createInboxTriageModule);
  app.module(createInboxReplierModule);
  // NOTE: CRM is no longer in the static module list — that's U5.
  // It's loaded below from the .hebbsmod fixture, which is the whole
  // point of this script.

  server = await app.listen(HTTP_PORT);
  step("boot", true, server.url);

  // Sanity: CRM tool should NOT be present yet.
  const healthBefore = await (await fetch(`${server.url}/health`)).json();
  const hasCrmBefore = healthBefore.modules.some((m) => m.id === "crm");
  step("crm absent at boot", !hasCrmBefore, `modules=${healthBefore.modules.map((m) => m.id).join(",")}`);
  if (hasCrmBefore) throw new Error("CRM was statically wired — script precondition failed");

  // ── 2. Extract .hebbsmod fixture ────────────────────────────────
  const fileBytes = await readFile(fixturePath);
  const sha256 = createHash("sha256").update(fileBytes).digest("hex");
  step("read fixture", true, `${fileBytes.length} bytes sha256=${sha256.slice(0, 12)}…`);

  // Shell out to `unzip` — no extra dep, available on macOS+linux dev boxes.
  const unzip = spawnSync("unzip", ["-q", fixturePath, "-d", extractDir]);
  if (unzip.status !== 0) {
    throw new Error(`unzip failed (status=${unzip.status}): ${unzip.stderr?.toString() ?? "no stderr"}`);
  }
  const manifest = JSON.parse(await readFile(join(extractDir, "module.json"), "utf8"));
  step("extract bundle", true, `module.json id=${manifest.id} version=${manifest.version}`);

  // ── 3. Dynamic import index.mjs ────────────────────────────────
  //
  // BUG ENCOUNTERED (and worked around for the gate): the CRM bundle
  // inlines @hebbs-typescript and at module-init time loads its gRPC
  // .proto from `join(__dirname(import.meta.url), "..", "proto",
  // "hebbs.proto")`. Once the bundle is unzipped into <extractDir>,
  // that resolves to <extractDir>/../proto/hebbs.proto — which
  // doesn't exist. We materialise the file there so the import
  // doesn't crash. U3 needs to fix this properly (either bundle the
  // proto as inlined text, externalise @hebbs-typescript and load it
  // from the host, or have the SDK defer proto loading until first
  // call).
  const protoSrc = "/Users/paragarora/Documents/Workspace/research/hebbs-repos/hebbs-typescript/proto/hebbs.proto";
  if (existsSync(protoSrc)) {
    const protoTargetDir = join(dirname(extractDir), "proto");
    try {
      await mkdir(protoTargetDir, { recursive: true });
      await cp(protoSrc, join(protoTargetDir, "hebbs.proto"));
    } catch {}
  }
  const entryUrl = pathToFileURL(join(extractDir, "index.mjs")).href;
  let bundleMod;
  try {
    bundleMod = await import(entryUrl);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    console.error(
      `[try-runtime-install] dynamic import failed (code=${code}). The bundle externalises ` +
        "@boringos/* — extract dir must be inside the workspace so Node can resolve them.\n",
      err,
    );
    throw err;
  }
  // Try default export first, then conventional named exports.
  const factory =
    bundleMod.default ??
    bundleMod.createCrmModule ??
    bundleMod[`create${capitalize(manifest.id)}Module`];
  if (typeof factory !== "function") {
    throw new Error(
      `bundle didn't expose a ModuleFactory. Got keys: ${Object.keys(bundleMod).join(", ")}`,
    );
  }
  step("import bundle", true, `factory=${factory.name || "(anon)"}`);

  // ── 4. registerModule() ─────────────────────────────────────────
  const deps = app.factoryDeps;
  if (!deps) throw new Error("app.factoryDeps was null after listen() — refactor regressed");
  const regResult = await app.registerModule(factory, deps);
  step("registerModule", true, `id=${regResult.moduleId} tools=+${regResult.toolsAdded} skills=+${regResult.skillsAdded}`);

  // Validate registration via /health.
  const healthAfter = await (await fetch(`${server.url}/health`)).json();
  const crmRow = healthAfter.modules.find((m) => m.id === "crm");
  if (!crmRow) throw new Error("/health doesn't list crm after registerModule");
  step("crm visible via /health", true, `tools=${crmRow.tools} skills=${crmRow.skills}`);

  // ── 5. Sign up a tenant via /api/auth/signup ────────────────────
  const signupRes = await fetch(`${server.url}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "U2 Test",
      email: `u2-${Date.now()}@example.com`,
      password: "u2-poc-password",
      tenantName: "U2 PoC Org",
    }),
  });
  if (signupRes.status !== 201) {
    throw new Error(`/api/auth/signup failed status=${signupRes.status} body=${await signupRes.text()}`);
  }
  const signup = await signupRes.json();
  const sessionToken = signup.token;
  // Look up the new tenant's id directly from the DB.
  const db = server.context.db;
  const { tenants } = await import("@boringos/db");
  const tenantRows = await db.select().from(tenants).limit(50);
  const tenant = tenantRows.find((t) => t.name === "U2 PoC Org");
  if (!tenant) throw new Error("freshly-signed-up tenant not found in DB");
  step("signup tenant", true, `tenantId=${tenant.id}`);

  // ── 6. Install CRM for the new tenant ──────────────────────────
  const installRes = await fetch(`${server.url}/api/admin/modules/crm/install`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "X-Tenant-Id": tenant.id,
      "Content-Type": "application/json",
    },
  });
  if (installRes.status !== 200) {
    throw new Error(`install endpoint returned ${installRes.status}: ${await installRes.text()}`);
  }
  const installBody = await installRes.json();
  if (!installBody.ok) {
    throw new Error(`install failed hookError=${installBody.hookError ?? "(none)"}`);
  }
  step("install crm", true, "/api/admin/modules/crm/install → ok");

  // Confirm the CRM schema migration ran — crm__contacts must exist.
  const { sql } = await import("drizzle-orm");
  const tableCheck = await db.execute(sql`SELECT to_regclass('public.crm__contacts') AS t`);
  const tableRow = Array.isArray(tableCheck) ? tableCheck[0] : tableCheck.rows?.[0];
  if (!tableRow || tableRow.t === null) {
    throw new Error("crm__contacts table missing after install — migration didn't run");
  }
  step("migration applied", true, `crm__contacts present`);

  // ── 7. Provision an agent to mint a JWT against ─────────────────
  // Signup already created a root agent (Chief of Staff) for this
  // tenant. The agents table has a partial unique index
  // `agents_tenant_one_root_idx` enforcing ONE row per tenant with
  // `reports_to IS NULL` — so the test agent must report to the
  // existing root agent (any non-null reports_to satisfies the
  // partial index).
  const { agents, runtimes } = await import("@boringos/db");
  const { eq, and, isNull } = await import("drizzle-orm");
  const rtRows = await db.select().from(runtimes).where(eq(runtimes.tenantId, tenant.id));
  const rt = rtRows[0];
  if (!rt) throw new Error("no runtime row seeded for tenant");
  const rootRows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.tenantId, tenant.id), isNull(agents.reportsTo)))
    .limit(1);
  const reportsTo = rootRows[0]?.id ?? null;
  const agentId = randomUUID();
  await db.insert(agents).values({
    id: agentId,
    tenantId: tenant.id,
    name: "U2 PoC Agent",
    role: "general",
    runtimeId: rt.id,
    reportsTo,
  });
  const runId = randomUUID();
  const callbackToken = signCallbackToken({ runId, agentId, tenantId: tenant.id }, "u2-poc-secret");
  step("mint callback JWT", true, `agentId=${agentId} runId=${runId}`);

  // ── 8. Dispatch crm.contacts.create ─────────────────────────────
  const dispatchRes = await fetch(`${server.url}/api/tools/crm.contacts.create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${callbackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
    }),
  });
  const dispatchStatus = dispatchRes.status;
  const dispatchBody = await dispatchRes.json();
  if (dispatchStatus !== 200) {
    throw new Error(`tool dispatch returned ${dispatchStatus}: ${JSON.stringify(dispatchBody)}`);
  }
  if (!dispatchBody.ok) {
    throw new Error(`tool dispatch error: ${JSON.stringify(dispatchBody.error ?? dispatchBody)}`);
  }
  const created = dispatchBody.result?.data;
  if (!created?.id || created.firstName !== "Ada") {
    throw new Error(`unexpected tool response: ${JSON.stringify(dispatchBody)}`);
  }
  step("tool dispatch", true, `crm.contacts.create returned id=${created.id}`);

  // ── 9. Assert DB row exists ────────────────────────────────────
  const rowCheck = await db.execute(sql`
    SELECT id, first_name, last_name, email
      FROM crm__contacts
     WHERE id = ${created.id}::uuid AND tenant_id = ${tenant.id}::uuid
  `);
  const rowList = Array.isArray(rowCheck) ? rowCheck : rowCheck.rows ?? [];
  if (rowList.length !== 1) {
    throw new Error(`row missing after dispatch: rowCheck=${JSON.stringify(rowList)}`);
  }
  step("db row exists", true, `crm__contacts.id=${rowList[0].id} email=${rowList[0].email}`);

  // Summary.
  console.log("");
  console.log("===============================================");
  console.log(" GO — runtime register validated end-to-end.");
  console.log("===============================================");
} catch (err) {
  exitCode = 1;
  console.error("");
  console.error("[try-runtime-install] FAILURE:", err && err.stack ? err.stack : err);
  console.error("");
  console.error("===============================================");
  console.error(" NO-GO — see above. Architecture issue or bug.");
  console.error("===============================================");
} finally {
  try {
    if (server) await server.close();
  } catch (e) {
    console.error("[try-runtime-install] server close failed:", e);
  }
  // Best-effort cleanup; leave the dataDir on failure for postmortem.
  if (extractDir) {
    try {
      await rm(extractDir, { recursive: true, force: true });
    } catch {}
  }
  if (exitCode === 0 && dataDir) {
    try {
      await rm(dataDir, { recursive: true, force: true });
    } catch {}
  } else if (dataDir) {
    console.error(`[try-runtime-install] keeping dataDir for inspection: ${dataDir}`);
  }
}

process.exit(exitCode);

function capitalize(s) {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
