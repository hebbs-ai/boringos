// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MDK T2.3 — install-time `minFrameworkVersion` enforcement.
//
// The full upload route plumbing (Postgres + multipart + signature
// verification) lives in `module-package-upload.test.ts`. This test
// covers the version-check logic in isolation against the public
// helper from `@boringos/module-sdk` — it's the path the route uses
// after `validateManifest` accepts the bundle. Acceptance for T2.3
// is "a too-new manifest fails cleanly" — we assert the helper's
// envelope and reason text are stable so any caller (route, install
// manager, scaffolder) can rely on them.

import { describe, it, expect } from "vitest";
import { checkMinFrameworkVersion } from "@boringos/module-sdk";

describe("MDK T2.3 — install-time minFrameworkVersion enforcement", () => {
  it("accepts a manifest that omits minFrameworkVersion", () => {
    const result = checkMinFrameworkVersion({}, "0.1.9");
    expect(result).toEqual({ ok: true });
  });

  it("accepts a manifest whose minFrameworkVersion equals the host", () => {
    const result = checkMinFrameworkVersion(
      { minFrameworkVersion: "0.1.9" },
      "0.1.9",
    );
    expect(result).toEqual({ ok: true });
  });

  it("accepts a manifest whose minFrameworkVersion is below the host", () => {
    const result = checkMinFrameworkVersion(
      { minFrameworkVersion: "0.1.0" },
      "0.2.5",
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a manifest demanding a too-new framework, with a stable reason", () => {
    const result = checkMinFrameworkVersion(
      { minFrameworkVersion: "99.0.0" },
      "0.1.9",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The shape route-layer code surfaces to the caller — exact reason
      // text is checked so the message stays useful for module authors.
      expect(result.reason).toMatch(/requires framework >= 99\.0\.0/);
      expect(result.reason).toMatch(/host is 0\.1\.9/);
    }
  });

  it("rejects when the host version itself is malformed", () => {
    const result = checkMinFrameworkVersion(
      { minFrameworkVersion: "0.1.0" },
      "not-a-version",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not semver-shaped/);
    }
  });

  it("compares major.minor.patch correctly across boundaries", () => {
    // 0.1.10 > 0.1.9 (numeric compare, not lexicographic).
    expect(
      checkMinFrameworkVersion({ minFrameworkVersion: "0.1.10" }, "0.1.9"),
    ).toEqual({
      ok: false,
      reason: expect.stringMatching(/0\.1\.10/),
    });
    // 0.2.0 > 0.1.99
    expect(
      checkMinFrameworkVersion({ minFrameworkVersion: "0.2.0" }, "0.1.99"),
    ).toEqual({
      ok: false,
      reason: expect.stringMatching(/0\.2\.0/),
    });
  });
});
