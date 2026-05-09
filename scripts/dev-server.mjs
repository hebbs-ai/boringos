// SPDX-License-Identifier: MIT
//
// Minimal Phase 1 dev server. Boots @boringos/core on port 3000 with
// embedded Postgres so the @boringos/shell SPA (port 5174) has a real
// /api/* backend to sign up + admin against.
//
// Phase 2's K-workstream replaces this with a proper @boringos/server
// package that wires the install pipeline + default-app provisioning
// into the boot path.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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
  createHebbsCrmModule,
  createTriageModule,
} from "@boringos/core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const port = Number(process.env.PORT ?? 3030);
const pgPort = Number(process.env.PG_PORT ?? 5436);
const shellOrigin = process.env.BORINGOS_SHELL_URL ?? "http://localhost:5174";

// v2 is the default. Set BORINGOS_KEEP_V1=true if you specifically
// want v1 routes mounted alongside (rare — useful for porting
// debugging where you want both surfaces reachable).
const v2Only = process.env.BORINGOS_KEEP_V1 !== "true";

const app = new BoringOS({
  database: { embedded: true, port: pgPort },
  shellOrigin,
  // Auto-install generic-triage + generic-replier on every fresh signup
  // (Phase 2 K8 + K9 wiring).
  defaultAppsDir: resolve(repoRoot, "apps"),
  // Drain the wakeup queue faster in dev — each slot spawns its own
  // claude subprocess, so 5 = ~5x the burst throughput. Tuned for a
  // dev box; production should profile before bumping.
  queue: { concurrency: 5 },
  v2Only,
});

// v2 modules — registered in both parallel and v2-only modes so
// /api/tools/* + the Settings v2 panels are always available in
// dev. v1 routes coexist when v2Only=false.
app.module(createFrameworkModule);
app.module(createMemoryModule);
app.module(createDriveModule);
app.module(createInboxModule);
app.module(createWorkflowModule);
app.module(createCopilotModule);
app.module(createSlackModule);
app.module(createGoogleModule);
app.module(createHebbsCrmModule);
app.module(createTriageModule);

const server = await app.listen(port);

console.log(`[dev-server] BoringOS listening at ${server.url}`);
console.log(`[dev-server] Health: ${server.url}/health`);
console.log(`[dev-server] v2 mode: ${v2Only ? "v2-only" : "parallel (v1 + v2)"}`);
console.log(`[dev-server] Press Ctrl+C to stop`);
