// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import {
  groupByDay,
  formatDay,
  actorBadge,
  actionLabel,
  uniq,
} from "@boringos/shell/screens/Activity/presenter.js";
import type { ActivityRow } from "@boringos/ui";

function row(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: over.id ?? "r1",
    tenantId: "t1",
    action: over.action ?? "agent.created",
    entityType: over.entityType ?? "agent",
    entityId: "x",
    actorType: over.actorType ?? "user",
    actorId: "u1",
    metadata: over.metadata ?? null,
    createdAt: over.createdAt ?? new Date().toISOString(),
  };
}

describe("groupByDay", () => {
  it("buckets rows by YYYY-MM-DD, newest day first", () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const grouped = groupByDay([
      row({ id: "a", createdAt: today }),
      row({ id: "b", createdAt: yesterday }),
      row({ id: "c", createdAt: today }),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.rows.map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect(grouped[1]!.rows[0]!.id).toBe("b");
  });

  it("returns empty array for empty input", () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe("formatDay", () => {
  it("renders today and yesterday with friendly labels", () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(formatDay(today)).toBe("Today");
    expect(formatDay(yesterday)).toBe("Yesterday");
  });

  it("falls back to a localised short date for older days", () => {
    const old = "2025-01-05";
    expect(formatDay(old)).not.toBe("Today");
    expect(formatDay(old)).not.toBe("Yesterday");
    expect(formatDay(old).length).toBeGreaterThan(0);
  });
});

describe("actorBadge / actionLabel / uniq", () => {
  it("actorBadge maps known + unknown actors", () => {
    expect(actorBadge("user")).toContain("accent");
    expect(actorBadge("agent")).toContain("violet");
    expect(actorBadge("system")).toContain("muted-strong");
    expect(actorBadge(null)).toContain("muted");
  });

  it("actionLabel humanises separators", () => {
    expect(actionLabel("agent.created")).toBe("agent created");
    expect(actionLabel("tenant_app:installed")).toBe("tenant app installed");
  });

  it("uniq dedupes preserving first occurrence", () => {
    expect(uniq(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });
});
