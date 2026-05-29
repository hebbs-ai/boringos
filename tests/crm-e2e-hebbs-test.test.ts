// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T8.5 — CRM E2E via `hebbs test`. Replaces
// `scripts/try-runtime-install.mjs` (kept for now as a manual
// fallback; T8.6 will retire it).
//
// What this test proves end-to-end:
//   1. The packed `crm-0.3.0.hebbsmod` archive boots inside the
//      dev-host's `BoringOS` instance + every built-in.
//   2. Module registration + install runs (incl. CRM's MDK T8.3
//      Lifecycle.seed agent path).
//   3. `crm.contacts.create` dispatches and writes a row.
//   4. `crm.calendar.sync_prep` soft no-ops (no Google connector
//      account in the dev tenant) — the connector-token path
//      survives missing credentials.
//
// If any step fails, the framework's MDK contract is broken — this
// is the merge-blocker. CI runs it as part of `pnpm test:run`.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runTest } from "@boringos/hebbs-cli";

const bundlePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "crm-0.3.0.hebbsmod",
);

describe("MDK T8.5 — CRM E2E via hebbs test", () => {
  it("hebbs test boots CRM, installs it, dispatches contacts.create + calendar.sync_prep", async () => {
    if (!existsSync(bundlePath)) {
      throw new Error(
        `CRM fixture missing: ${bundlePath}. Re-pack via the CRM monorepo's pnpm build.`,
      );
    }
    process.env.HEBBS_DEV_MODULES = "true";

    // First: contacts.create — proves the schema migration ran +
    // the CRUD tool path works against the bundled host.
    const create = await runTest({
      modulePath: bundlePath,
      smokeToolName: "crm.contacts.create",
      smokeToolInputs: {
        firstName: "MDK",
        lastName: "T8.5",
        emails: [
          { email: `mdk-t8-5-${Date.now()}@hebbs.test`, isPrimary: true },
        ],
      },
    });
    expect(create.ok).toBe(true);
    expect(create.moduleId).toBe("crm");
    expect(create.moduleVersion).toBe("0.3.0");
    expect(create.smoke).toBeDefined();
    expect(create.smoke?.toolName).toBe("crm.contacts.create");
    const createPayload = create.smoke?.response as Record<string, unknown>;
    expect(createPayload?.ok).toBe(true);
    // The CRM bundle returns the created row in `result`; we don't
    // hard-code the shape — just assert there's a uuid somewhere in
    // the response string. Avoids drift if the tool shape evolves.
    const jsonStr = JSON.stringify(createPayload);
    expect(jsonStr).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);

    // Second: calendar.sync_prep — must soft no-op when no Google
    // account is connected (MDK T0.3 → T0.5 contract). A throw
    // would indicate the connector-token path is brittle.
    const cal = await runTest({
      modulePath: bundlePath,
      smokeToolName: "crm.calendar.sync_prep",
      smokeToolInputs: {},
    });
    expect(cal.ok).toBe(true);
    const calPayload = cal.smoke?.response as {
      ok?: boolean;
      result?: { eventsFetched?: number };
    };
    expect(calPayload?.ok).toBe(true);
    expect(calPayload?.result?.eventsFetched).toBe(0);
  }, 180_000);
});
