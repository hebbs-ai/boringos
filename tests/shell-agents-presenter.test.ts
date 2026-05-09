// SPDX-License-Identifier: BUSL-1.1
//
// Pure-helper coverage for Agents/presenter.ts. These render on every
// card and on every fleet refetch — keep behaviour locked down.

import { describe, it, expect } from "vitest";
import {
  fleetStats,
  formatCents,
  initials,
  avatarColor,
  avatarMark,
  roleIcon,
  statusPill,
  activitySeries,
} from "@boringos/shell/screens/Agents/presenter.js";
import type { Agent } from "@boringos/ui";

function mkAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: over.id ?? "a1",
    tenantId: "t1",
    name: over.name ?? "Maya",
    role: over.role ?? "chief-of-staff",
    title: null,
    icon: null,
    status: over.status ?? "idle",
    reportsTo: null,
    instructions: null,
    runtimeId: null,
    fallbackRuntimeId: null,
    budgetMonthlyCents: over.budgetMonthlyCents ?? 0,
    spentMonthlyCents: over.spentMonthlyCents ?? 0,
    pauseReason: null,
    pausedAt: null,
    permissions: {},
    metadata: null,
    lastHeartbeatAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Agent;
}

describe("fleetStats", () => {
  it("counts running / paused / idle and sums spend", () => {
    const stats = fleetStats([
      mkAgent({ status: "running", spentMonthlyCents: 200 }),
      mkAgent({ id: "a2", status: "paused", spentMonthlyCents: 50 }),
      mkAgent({ id: "a3", status: "idle", spentMonthlyCents: 0 }),
      mkAgent({ id: "a4", status: "idle", spentMonthlyCents: 75 }),
    ]);
    expect(stats.total).toBe(4);
    expect(stats.running).toBe(1);
    expect(stats.paused).toBe(1);
    expect(stats.idle).toBe(2);
    expect(stats.spentTodayCents).toBe(325);
  });

  it("handles empty list", () => {
    expect(fleetStats([])).toEqual({
      total: 0,
      running: 0,
      paused: 0,
      idle: 0,
      spentTodayCents: 0,
    });
  });
});

describe("formatCents", () => {
  it("renders zero as $0", () => {
    expect(formatCents(0)).toBe("$0");
  });
  it("uses 2 decimals under $10", () => {
    expect(formatCents(142)).toBe("$1.42");
    expect(formatCents(999)).toBe("$9.99");
  });
  it("rounds to whole dollars at or above $10", () => {
    expect(formatCents(1000)).toBe("$10");
    expect(formatCents(12345)).toBe("$123");
  });
});

describe("initials", () => {
  it("uses first two chars of single-word names", () => {
    expect(initials("Maya")).toBe("MA");
  });
  it("uses first letter of first + last for multi-word names", () => {
    expect(initials("Maya Patel")).toBe("MP");
    expect(initials("Chief of Staff")).toBe("CS");
  });
  it("falls back to '?' for empty names", () => {
    expect(initials("")).toBe("?");
  });
});

describe("avatarColor", () => {
  it("returns the same color for the same role", () => {
    expect(avatarColor("triage")).toBe(avatarColor("triage"));
  });
  it("uses palette entries for known roles", () => {
    expect(avatarColor("ceo")).toContain("violet");
    expect(avatarColor("triage")).toContain("amber");
  });
  it("falls back deterministically for unknown roles", () => {
    expect(avatarColor("xyz-custom")).toBe(avatarColor("xyz-custom"));
  });
});

describe("roleIcon + avatarMark", () => {
  it("roleIcon returns hand-picked glyphs for known roles", () => {
    expect(roleIcon("ceo")).toBe("♚");
    expect(roleIcon("triage")).toBe("⚐");
    expect(roleIcon("CHIEF-OF-STAFF")).toBe("✦"); // case-insensitive
    expect(roleIcon("nonexistent-role")).toBeNull();
  });

  it("avatarMark prefers custom icon, then role icon, then initials", () => {
    expect(avatarMark({ icon: "🐱", role: "engineer", name: "Maya" })).toBe("🐱");
    expect(avatarMark({ icon: null, role: "triage", name: "Maya" })).toBe("⚐");
    expect(avatarMark({ icon: "", role: "unknown-role", name: "Maya Patel" })).toBe("MP");
  });

  it("avatarMark trims whitespace-only custom icon", () => {
    expect(avatarMark({ icon: "   ", role: "ceo", name: "Maya" })).toBe("♚");
  });
});

describe("activitySeries", () => {
  const NOW = new Date("2026-05-09T12:00:00Z");

  it("zero-fills missing days, ordered oldest → today", () => {
    const series = activitySeries({ "2026-05-09": 3, "2026-05-07": 1 }, 7, NOW);
    // 7 days ending 2026-05-09: 03, 04, 05, 06, 07, 08, 09
    expect(series).toHaveLength(7);
    expect(series[6]).toBe(3); // today
    expect(series[4]).toBe(1); // 2 days ago = 2026-05-07
    expect(series[0]).toBe(0); // 6 days ago = 2026-05-03
  });

  it("returns all zeros when input is empty", () => {
    expect(activitySeries(undefined, 7, NOW)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(activitySeries({}, 5, NOW)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("statusPill", () => {
  it("maps known statuses", () => {
    expect(statusPill("running").label).toBe("Running");
    expect(statusPill("paused").label).toBe("Paused");
    expect(statusPill("error").label).toBe("Error");
  });
  it("falls back to Idle for unknown statuses", () => {
    expect(statusPill("anything-else").label).toBe("Idle");
    expect(statusPill("idle").label).toBe("Idle");
  });
});
