// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import { createSettingRegistry } from "@boringos/agent";

describe("SettingRegistry", () => {
  it("registers + lists + looks up by key", () => {
    const r = createSettingRegistry();
    r.register("framework", "framework", {
      key: "agents_paused",
      label: "Pause all agents",
      type: "boolean",
      default: false,
    });
    r.register("module", "inbox", {
      key: "inbox.replier.proposeSlots",
      label: "Propose calendar slots",
      type: "boolean",
      default: false,
    });

    expect(r.list()).toHaveLength(2);
    expect(r.get("agents_paused")?.label).toBe("Pause all agents");
    expect(r.get("nonexistent")).toBeUndefined();
  });

  it("byOwner filters and ownerKind/ownerId are populated by registry", () => {
    const r = createSettingRegistry();
    r.register("module", "inbox", { key: "a", label: "A", type: "string" });
    r.register("module", "google", { key: "b", label: "B", type: "string" });
    expect(r.byOwner("module", "inbox")).toHaveLength(1);
    expect(r.byOwner("module", "google")[0]!.ownerId).toBe("google");
    expect(r.byOwner("module", "google")[0]!.ownerKind).toBe("module");
  });

  it("validateValue enforces type discrimination", () => {
    const r = createSettingRegistry();
    r.register("framework", "framework", {
      key: "flag",
      label: "Flag",
      type: "boolean",
    });
    r.register("module", "inbox", {
      key: "mode",
      label: "Mode",
      type: "select",
      options: [
        { value: "off", label: "Off" },
        { value: "on", label: "On" },
      ],
    });
    r.register("module", "ops", {
      key: "n",
      label: "N",
      type: "number",
    });

    expect(r.validateValue("flag", true)).toBeNull();
    expect(r.validateValue("flag", "true")).toBeNull();
    expect(r.validateValue("flag", "yes")).toMatch(/expects boolean/);

    expect(r.validateValue("mode", "off")).toBeNull();
    expect(r.validateValue("mode", "wrong")).toMatch(/expects one of/);

    expect(r.validateValue("n", 5)).toBeNull();
    expect(r.validateValue("n", "5")).toBeNull();
    expect(r.validateValue("n", "x")).toMatch(/expects number/);

    // Permissive on unknown keys
    expect(r.validateValue("anything-else", "garbage")).toBeNull();
  });

  it("defaults() serialises to strings and skips secrets", () => {
    const r = createSettingRegistry();
    r.register("framework", "framework", {
      key: "k1",
      label: "K1",
      type: "boolean",
      default: false,
    });
    r.register("framework", "framework", {
      key: "k2",
      label: "K2",
      type: "number",
      default: 42,
    });
    r.register("framework", "framework", {
      key: "secret_key",
      label: "Secret",
      type: "secret",
      default: "shouldnt-leak",
    });
    r.register("framework", "framework", {
      key: "no_default",
      label: "ND",
      type: "string",
    });

    const d = r.defaults();
    expect(d.k1).toBe("false");
    expect(d.k2).toBe("42");
    expect(d.secret_key).toBeUndefined();
    expect(d.no_default).toBeUndefined();
  });

  it("re-register replaces by key", () => {
    const r = createSettingRegistry();
    r.register("framework", "framework", { key: "x", label: "first", type: "string" });
    r.register("framework", "framework", { key: "x", label: "second", type: "string" });
    expect(r.list()).toHaveLength(1);
    expect(r.get("x")?.label).toBe("second");
  });

  it("unregisterOwner drops only that owner's entries", () => {
    const r = createSettingRegistry();
    r.register("module", "a", { key: "a1", label: "a1", type: "string" });
    r.register("module", "b", { key: "b1", label: "b1", type: "string" });
    r.unregisterOwner("module", "a");
    expect(r.list()).toHaveLength(1);
    expect(r.get("b1")).toBeDefined();
  });
});
