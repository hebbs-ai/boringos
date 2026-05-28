// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T4.1 — `@boringos/dev-host` reproduces the
// `try-runtime-install.mjs` flow as a single function call.
// Exercises against the CRM .hebbsmod fixture.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDevHost } from "@boringos/dev-host";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "crm-0.3.0.hebbsmod",
);

describe("MDK T4.1 — @boringos/dev-host smoke (CRM fixture)", () => {
  it("createDevHost boots, installs, signs a JWT, dispatches a tool, and asserts the DB row", async () => {
    if (!existsSync(fixturePath)) {
      console.warn(
        `[dev-host smoke] skipping — fixture not found at ${fixturePath}`,
      );
      return;
    }
    process.env.HEBBS_DEV_MODULES = "true";

    const host = await createDevHost({ modulePath: fixturePath });
    try {
      expect(host.moduleId).toBe("crm");
      expect(host.moduleVersion).toBe("0.3.0");
      expect(host.url).toMatch(/^http:\/\//);
      expect(host.tenantId).toMatch(/^[0-9a-f-]+$/);

      const result = await host.dispatch<{
        ok: boolean;
        result: { data: { id: string; firstName: string; email: string } };
      }>("crm.contacts.create", {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      });

      expect(result.ok).toBe(true);
      expect(result.result.data.firstName).toBe("Ada");

      // Direct DB assertion via the exposed handle.
      const { sql } = await import("drizzle-orm");
      const rows = (await host.db.execute(sql`
        SELECT id, email FROM crm__contacts
        WHERE id = ${result.result.data.id}::uuid
          AND tenant_id = ${host.tenantId}::uuid
      `)) as unknown as Array<{ id: string; email: string }>;
      const rowList = Array.isArray(rows) ? rows : ((rows as unknown) as { rows: typeof rows }).rows ?? [];
      expect(rowList).toHaveLength(1);
      expect(rowList[0].email).toBe("ada@example.com");
    } finally {
      await host.close();
    }
  }, 120_000);
});
