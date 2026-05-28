// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T4.2 — `hebbs test <module>` smoke. Drives the programmatic
// `runTest` entry against the CRM fixture (which is the same path
// `cli.ts` calls internally), so the test covers the surface a CLI
// invocation would exercise without spawning a subprocess.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runTest } from "@boringos/hebbs-cli";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "crm-0.3.0.hebbsmod",
);

describe("MDK T4.2 — hebbs test <module>", () => {
  it("returns ok with module id/version and bootMs after a successful install", async () => {
    if (!existsSync(fixturePath)) {
      console.warn("[hebbs-cli] skipping — CRM fixture missing");
      return;
    }
    process.env.HEBBS_DEV_MODULES = "true";

    const result = await runTest({ modulePath: fixturePath });
    expect(result.ok).toBe(true);
    expect(result.moduleId).toBe("crm");
    expect(result.moduleVersion).toBe("0.3.0");
    expect(result.bootMs).toBeGreaterThan(0);
  }, 120_000);

  it("returns ok with smoke output when a smoke tool is supplied", async () => {
    if (!existsSync(fixturePath)) return;
    process.env.HEBBS_DEV_MODULES = "true";

    const result = await runTest({
      modulePath: fixturePath,
      smokeToolName: "crm.contacts.create",
      smokeToolInputs: {
        firstName: "Grace",
        lastName: "Hopper",
        email: "grace@example.com",
      },
    });
    expect(result.ok).toBe(true);
    expect(result.smoke?.toolName).toBe("crm.contacts.create");
    const resp = result.smoke?.response as {
      ok: boolean;
      result: { data: { firstName: string } };
    };
    expect(resp.ok).toBe(true);
    expect(resp.result.data.firstName).toBe("Grace");
  }, 120_000);

  it("returns { ok: false, error } when the module path does not exist", async () => {
    const result = await runTest({
      modulePath: "/tmp/definitely-not-a-real-path.hebbsmod",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }, 60_000);
});
