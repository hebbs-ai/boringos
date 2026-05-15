/**
 * task_26 — registerBuiltinPlugins() contributes the framework's
 * dashboard tiles via the same pluginHost.register() path as
 * third-party modules.
 *
 * The framework-shipped Home tiles (open work, agents online, etc.)
 * used to live as hardcoded JSX in Home.tsx. After task_26 they
 * ship as PluginUI.dashboardWidgets contributions from the
 * `framework` and `inbox` built-in modules so Home can be a pure
 * registry consumer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { pluginHost } from "@boringos/shell/plugin-host/registry.js";
import { registerBuiltinPlugins } from "@boringos/shell/builtin-plugins/index.js";

describe("task_26 — registerBuiltinPlugins", () => {
  beforeAll(() => {
    for (const m of [...pluginHost.modules]) {
      pluginHost.unregister(m.moduleId);
    }
    registerBuiltinPlugins();
  });

  afterAll(() => {
    for (const m of [...pluginHost.modules]) {
      pluginHost.unregister(m.moduleId);
    }
  });

  it("registers framework + inbox PluginUI contributions", () => {
    const ids = pluginHost.modules.map((m) => m.moduleId).sort();
    expect(ids).toEqual(["framework", "inbox"]);
  });

  it("contributes seven framework-shipped dashboard widgets", () => {
    const widgets = pluginHost.dashboardWidgets;
    const byId = new Map(widgets.map((w) => [`${w.moduleId}:${w.id}`, w]));

    // Primary slot (KPI tiles, slot=primary).
    for (const id of [
      "framework:open-work",
      "framework:agents-online",
      "inbox:unread-inbox",
      "framework:pending-approvals",
    ]) {
      const w = byId.get(id);
      expect(w, `missing widget ${id}`).toBeDefined();
      expect(w!.slot).toBe("primary");
      expect(w!.size).toBe("small");
    }

    // Secondary slot (cost sparkline, operating pulse, watch items).
    for (const id of [
      "framework:cost-sparkline",
      "framework:operating-pulse",
      "framework:watch-items",
    ]) {
      const w = byId.get(id);
      expect(w, `missing widget ${id}`).toBeDefined();
      expect(w!.slot).toBe("secondary");
      expect(w!.size).toBe("medium");
    }
  });

  it("orders primary widgets by declared order field", () => {
    const primary = pluginHost.dashboardWidgets.filter(
      (w) => w.slot === "primary",
    );
    expect(primary.map((w) => w.id)).toEqual([
      "open-work",        // order 10
      "agents-online",    // order 20
      "unread-inbox",     // order 30 (inbox module)
      "pending-approvals", // order 40
    ]);
  });
});
