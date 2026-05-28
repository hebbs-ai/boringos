// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T4.3 — bootstrap an MDK-shape module + `hebbs test` against
// it green, end to end.
//
// Today the "scaffolded" module is a hand-crafted minimum-viable
// fixture (`tests/fixtures/hello-module/`) — one tool, one skill,
// no schema. Once `create-hebbs-module` lands in T5.1, this test
// retargets at the scaffolder's output directly. The flow exercised
// is unchanged either way: an empty directory → a module that
// `hebbs test` can boot and dispatch.
//
// The fixture lives inside the workspace so the dynamic-import of
// `@boringos/module-sdk` from `index.mjs` resolves via the
// framework's node_modules (same constraint createDevHost
// documents).

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { runTest } from "@boringos/hebbs-cli";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "hello-module",
);

describe("MDK T4.3 — hebbs test against a minimum-viable module", () => {
  it("boots, installs, dispatches greet — all green", async () => {
    process.env.HEBBS_DEV_MODULES = "true";

    const result = await runTest({
      modulePath: fixturePath,
      smokeToolName: "hello.greet",
      smokeToolInputs: { name: "Ada" },
    });

    expect(result.ok).toBe(true);
    expect(result.moduleId).toBe("hello");
    expect(result.moduleVersion).toBe("0.1.0");
    expect(result.bootMs).toBeGreaterThan(0);

    const resp = result.smoke?.response as {
      ok: boolean;
      result: { greeting: string };
    };
    expect(resp.ok).toBe(true);
    expect(resp.result.greeting).toBe("Hello, Ada!");
  }, 120_000);
});
