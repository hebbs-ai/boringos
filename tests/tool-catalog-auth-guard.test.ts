// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression: the tool-catalog provider must include the "do not
// introspect env vars" guard. Pi's bash sandbox (and possibly other
// runtimes' sandboxes) redact secrets from `printenv` / `env` while
// keeping them available to shell interpolation; without this guard,
// gpt-class agents sometimes run `printenv BORINGOS_CALLBACK_TOKEN`
// to "verify" auth, see empty, and refuse to call tools — burning a
// run for no reason.
//
// Live debugging session 2026-05-29 caught this on Pi + the CRM
// enrichment-contact persona. Fix lands as a single line in every
// agent's system prompt via the framework's tool-catalog provider.

import { describe, it, expect } from "vitest";
import { createToolRegistry } from "@boringos/agent";
import { createToolCatalogProvider } from "@boringos/agent";
import { z } from "@boringos/module-sdk";

describe("tool-catalog provider — auth-introspection guard", () => {
  it("warns every agent NOT to run printenv on BORINGOS_CALLBACK_TOKEN", async () => {
    const registry = createToolRegistry();
    registry.register("test-mod", {
      name: "noop",
      description: "no-op",
      inputs: z.object({}),
      async handler() {
        return { ok: true as const, result: {} };
      },
    });
    const provider = createToolCatalogProvider({ registry });
    const out = await provider.provide({
      tenantId: "t",
      runId: "r",
      agentId: "a",
    } as Parameters<typeof provider.provide>[0]);
    expect(out).toBeTruthy();
    expect(out).toContain("DO NOT introspect env vars");
    expect(out).toContain("printenv");
    expect(out).toContain("HTTP 401");
  });
});
