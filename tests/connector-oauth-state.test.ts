// SPDX-License-Identifier: MIT
//
// N2 — OAuth state token sign/verify and returnTo allowlist. The new
// authorize/callback round-trip relies on these helpers staying tight;
// regression here is a security regression.

import { describe, it, expect } from "vitest";
import {
  createState,
  verifyState,
  isSafeReturnTo,
} from "../packages/@boringos/core/src/oauth.js";

const SECRET = "phase-3-test-secret";
const NOW = new Date("2026-05-06T12:00:00Z");

describe("OAuth state — createState / verifyState", () => {
  it("round-trips a valid payload", () => {
    const token = createState(
      { tenantId: "t-1", returnTo: "http://localhost:5174/connectors" },
      SECRET,
      NOW,
    );
    const result = verifyState(token, SECRET, NOW);
    expect(result.ok).toBe(true);
    expect(result.payload?.tenantId).toBe("t-1");
    expect(result.payload?.returnTo).toBe("http://localhost:5174/connectors");
    expect(typeof result.payload?.nonce).toBe("string");
    expect(result.payload?.iat).toBe(NOW.getTime());
  });

  it("rejects malformed tokens", () => {
    expect(verifyState("", SECRET, NOW).reason).toBe("malformed");
    expect(verifyState("noseparator", SECRET, NOW).reason).toBe("malformed");
    expect(verifyState(".sigwithoutpayload", SECRET, NOW).reason).toBe("malformed");
    expect(verifyState("payloadwithoutsig.", SECRET, NOW).reason).toBe("malformed");
  });

  it("rejects bad signature", () => {
    const token = createState(
      { tenantId: "t-1", returnTo: "/connectors" },
      SECRET,
      NOW,
    );
    const tampered = token.slice(0, -2) + "AA";
    expect(verifyState(tampered, SECRET, NOW).reason).toBe("bad_signature");
  });

  it("rejects token signed with a different secret", () => {
    const token = createState(
      { tenantId: "t-1", returnTo: "/connectors" },
      "alpha",
      NOW,
    );
    expect(verifyState(token, "beta", NOW).reason).toBe("bad_signature");
  });

  it("rejects expired tokens", () => {
    const token = createState(
      { tenantId: "t-1", returnTo: "/connectors" },
      SECRET,
      NOW,
    );
    const future = new Date(NOW.getTime() + 11 * 60 * 1000);
    const result = verifyState(token, SECRET, future);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("two tokens for same payload have different nonces", () => {
    const a = createState(
      { tenantId: "t-1", returnTo: "/connectors" },
      SECRET,
      NOW,
    );
    const b = createState(
      { tenantId: "t-1", returnTo: "/connectors" },
      SECRET,
      NOW,
    );
    expect(a).not.toBe(b);
    const aPayload = verifyState(a, SECRET, NOW).payload;
    const bPayload = verifyState(b, SECRET, NOW).payload;
    expect(aPayload?.nonce).not.toBe(bPayload?.nonce);
  });
});

describe("isSafeReturnTo", () => {
  const allowed = [
    "http://localhost:5174",
    "http://localhost:3030",
    "https://app.example.com",
  ];

  it("accepts relative paths starting with /", () => {
    expect(isSafeReturnTo("/connectors", allowed)).toBe(true);
    expect(isSafeReturnTo("/connectors?x=1", allowed)).toBe(true);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isSafeReturnTo("//evil.com/x", allowed)).toBe(false);
  });

  it("accepts absolute URLs whose origin is in the allowlist", () => {
    expect(isSafeReturnTo("http://localhost:5174/foo", allowed)).toBe(true);
    expect(isSafeReturnTo("https://app.example.com/x", allowed)).toBe(true);
  });

  it("rejects absolute URLs to other origins", () => {
    expect(isSafeReturnTo("https://evil.com/x", allowed)).toBe(false);
    expect(isSafeReturnTo("http://localhost:9999/x", allowed)).toBe(false);
  });

  it("rejects empty / non-string", () => {
    expect(isSafeReturnTo("", allowed)).toBe(false);
    expect(isSafeReturnTo(null as unknown as string, allowed)).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isSafeReturnTo("not a url", allowed)).toBe(false);
  });
});
