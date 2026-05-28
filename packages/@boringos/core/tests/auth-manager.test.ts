// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit tests for AuthManager registry surface and HMAC state helpers.
//
// These tests exercise the in-memory connector registry without requiring a
// real database. Integration tests with DB are deferred to the E2E gate.

import { describe, it, expect } from "vitest";
import { AuthManager } from "../src/auth-manager.js";
import { createState, verifyState } from "../src/auth-manager-state.js";
import { googleConnector } from "@boringos/connector-google";
import { slackConnector } from "@boringos/connector-slack";

describe("AuthManager registry", () => {
  it("registers a connector and lists it", () => {
    const mgr = new AuthManager({} as any, "test-secret", (p) => `http://test/oauth/${p}/callback`);
    mgr.registerConnector(googleConnector);
    expect(mgr.listConnectors()).toHaveLength(1);
    expect(mgr.getConnector("google")?.provider).toBe("google");
  });

  it("throws on duplicate registration", () => {
    const mgr = new AuthManager({} as any, "test-secret", (p) => `http://test/oauth/${p}/callback`);
    mgr.registerConnector(googleConnector);
    expect(() => mgr.registerConnector(googleConnector)).toThrow(
      "Connector 'google' already registered",
    );
  });

  it("registers multiple connectors independently", () => {
    const mgr = new AuthManager({} as any, "test-secret", (p) => `http://test/oauth/${p}/callback`);
    mgr.registerConnector(googleConnector);
    mgr.registerConnector(slackConnector);
    expect(mgr.listConnectors().map((c) => c.provider).sort()).toEqual(["google", "slack"]);
  });

  it("returns null for unknown provider", () => {
    const mgr = new AuthManager({} as any, "test-secret", (p) => `http://test/oauth/${p}/callback`);
    expect(mgr.getConnector("nonexistent")).toBeNull();
  });
});

describe("AuthManager state helpers", () => {
  it("createState round-trips through verifyState with the same secret", () => {
    const state = createState("secret", { tenantId: "t1", provider: "google", scopes: ["openid"] });
    const payload = verifyState("secret", state);
    expect(payload).not.toBeNull();
    expect(payload?.tenantId).toBe("t1");
    expect(payload?.provider).toBe("google");
    expect(payload?.scopes).toEqual(["openid"]);
  });

  it("verifyState returns null on wrong secret", () => {
    const state = createState("secret1", { tenantId: "t1", provider: "google", scopes: [] });
    expect(verifyState("secret2", state)).toBeNull();
  });

  it("verifyState returns null on tampered payload", () => {
    const state = createState("secret", { tenantId: "t1", provider: "google", scopes: [] });
    const tampered = state.slice(0, -2) + "XX";
    expect(verifyState("secret", tampered)).toBeNull();
  });

  it("verifyState returns null on malformed state", () => {
    expect(verifyState("secret", "no-dot-here")).toBeNull();
    expect(verifyState("secret", "")).toBeNull();
  });
});
