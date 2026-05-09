// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import {
  initials,
  roleBadge,
  formatJoined,
  ROLE_OPTIONS,
} from "@boringos/shell/screens/Team/presenter.js";

describe("Team presenter", () => {
  it("ROLE_OPTIONS has admin/staff/member", () => {
    expect(ROLE_OPTIONS.map((r) => r.value)).toEqual(["admin", "staff", "member"]);
  });

  it("initials handle single + multi-word names + empty", () => {
    expect(initials("Maya")).toBe("MA");
    expect(initials("Maya Patel")).toBe("MP");
    expect(initials("")).toBe("?");
  });

  it("roleBadge maps known roles to distinct palettes", () => {
    expect(roleBadge("admin")).toContain("violet");
    expect(roleBadge("staff")).toContain("accent");
    expect(roleBadge("member")).toContain("muted-strong");
    expect(roleBadge("anything-else")).toContain("muted-strong"); // fallback
  });

  it("formatJoined produces relative strings", () => {
    const today = new Date().toISOString();
    expect(formatJoined(today)).toBe("today");

    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(formatJoined(yesterday)).toBe("yesterday");

    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(formatJoined(tenDaysAgo)).toBe("10d ago");

    expect(formatJoined("")).toBe("—");
  });
});
