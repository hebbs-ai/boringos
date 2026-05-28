// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dev server. Boots @boringos/core on port 3030 with embedded
// Postgres so the @boringos/shell SPA (port 5174) has a real
// /api/* backend to sign up + admin against.

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { Hono } from "hono";
import {
  BoringOS,
  createFrameworkModule,
  createMemoryModule,
  createDriveModule,
  createInboxModule,
  createWorkflowModule,
  createCopilotModule,
  createTriageModule,
  createInboxTriageModule,
  createInboxReplierModule,
} from "@boringos/core";

const port = Number(process.env.PORT ?? 3030);
const pgPort = Number(process.env.PG_PORT ?? 5436);
const shellOrigin = process.env.BORINGOS_SHELL_URL ?? "http://localhost:5174";

// Dev convenience: accept unsigned `.hebbsmod` uploads. Production
// rejects unsigned bundles unless a publisher key is allow-listed.
if (!process.env.HEBBS_DEV_MODULES) {
  process.env.HEBBS_DEV_MODULES = "true";
}

const useExternal = process.env.PG_EMBEDDED === "false" && process.env.DATABASE_URL;
const database = useExternal ? undefined : { embedded: true, port: pgPort };

const app = new BoringOS({
  ...(database ? { database } : {}),
  shellOrigin,
  auth: { secret: process.env.AUTH_SECRET ?? "boringos-dev-secret" },
  // Each queue slot spawns its own claude subprocess; 5 = ~5x burst
  // throughput. Tune per-box; production should profile.
  queue: { concurrency: 5 },
});

// Modules — register every BUILT-IN the host ships with. The
// install-manager auto-installs `defaultInstall: true` modules on
// new tenants. Third-party Modules (e.g. CRM) ship as `.hebbsmod`
// bundles and are uploaded at runtime via the Apps screen — they
// do NOT appear in this static list.
app.module(createFrameworkModule);
app.module(createMemoryModule);
app.module(createDriveModule);
app.module(createInboxModule);
app.module(createWorkflowModule);
app.module(createCopilotModule);
// Google + Slack connectors are now SDK packages (@boringos/connector-google,
// @boringos/connector-slack). They register with AuthManager automatically at
// boot. Tool-exposing built-in modules for them have been removed (Path B).
// Third-party modules consume the SDK directly and ship their own tools.
app.module(createTriageModule);
app.module(createInboxTriageModule);
app.module(createInboxReplierModule);

// Debug route used by the shell's runtime-loader to report what the
// browser actually does during plugin hot-load. Helpful when nav items
// fail to appear; prints to stdout so we can read it without DevTools.
const debugApp = new Hono();
debugApp.post("/runtime-loader", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // eslint-disable-next-line no-console
  console.log(`[shell-debug] runtime-loader: ${JSON.stringify(body)}`);
  return c.json({ ok: true });
});
app.route("/api/debug", debugApp);

const server = await app.listen(port);

console.log(`[dev-server] BoringOS listening at ${server.url}`);
console.log(`[dev-server] Health: ${server.url}/health`);
console.log(
  `[dev-server] HEBBS_DEV_MODULES=${process.env.HEBBS_DEV_MODULES} — unsigned .hebbsmod uploads accepted`,
);

// Friendly nudge if no third-party `.hebbsmod` is installed yet.
// MODULES_STORE_DIR defaults to `<cwd>/.data/module-store/`.
const storeDir =
  process.env.MODULES_STORE_DIR ?? resolve(process.cwd(), ".data", "module-store");
let hasThirdPartyModules = false;
try {
  if (existsSync(storeDir)) {
    hasThirdPartyModules = readdirSync(storeDir).some((name) => !name.startsWith("."));
  }
} catch {
  // ignore — if we can't read the store dir we just print the nudge anyway
}
if (!hasThirdPartyModules) {
  console.log("");
  console.log("[dev-server] No third-party modules uploaded. Use the Apps");
  console.log("[dev-server] screen at http://localhost:5174/modules to upload a .hebbsmod");
  console.log("[dev-server] (e.g., ../boringos-crm/packages/server/dist/crm-0.2.0.hebbsmod).");
  console.log("");
}

console.log(`[dev-server] Press Ctrl+C to stop`);
