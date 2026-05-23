// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit coverage for the `condition` block comparator. The visual
// editor hands non-technical authors plain values, which historically
// arrived as strings — so numeric operators (gt/gte/lt/lte) and `in`
// must be type-tolerant rather than requiring an exact JS type.

import { describe, it, expect } from "vitest";

import { evaluateCondition } from "../packages/@boringos/core/src/modules/workflow.js";

describe("evaluateCondition", () => {
  it("equals/not_equals compare strings", () => {
    expect(evaluateCondition("equals", "fyi", "fyi")).toBe(true);
    expect(evaluateCondition("equals", "fyi", "noise")).toBe(false);
    expect(evaluateCondition("not_equals", "fyi", "noise")).toBe(true);
    expect(evaluateCondition("not_equals", "noise", "noise")).toBe(false);
  });

  it("equals is type-tolerant across number / numeric-string", () => {
    // The form stores config.value as a string; this must still match.
    expect(evaluateCondition("equals", 5, "5")).toBe(true);
    expect(evaluateCondition("equals", "5", 5)).toBe(true);
    expect(evaluateCondition("not_equals", 5, "6")).toBe(true);
  });

  it("contains works on strings", () => {
    expect(evaluateCondition("contains", "hello world", "world")).toBe(true);
    expect(evaluateCondition("contains", "hello", "z")).toBe(false);
  });

  it("numeric operators coerce string-encoded numbers (the bug fix)", () => {
    // Before the fix these all returned false because the RHS was a string.
    expect(evaluateCondition("gt", "5", 3)).toBe(true);
    expect(evaluateCondition("gt", 5, "3")).toBe(true);
    expect(evaluateCondition("gt", "5", "10")).toBe(false);
    expect(evaluateCondition("gte", "5", "5")).toBe(true);
    expect(evaluateCondition("lt", "2", "10")).toBe(true);
    expect(evaluateCondition("lte", "10", "10")).toBe(true);
  });

  it("numeric operators are false when a side is not numeric", () => {
    expect(evaluateCondition("gt", "abc", 3)).toBe(false);
    expect(evaluateCondition("gt", 3, "")).toBe(false);
  });

  it("`in` accepts a comma-separated string or a real array", () => {
    expect(evaluateCondition("in", "fyi", "noise, fyi, urgent")).toBe(true);
    expect(evaluateCondition("in", "spam", "noise, fyi, urgent")).toBe(false);
    expect(evaluateCondition("in", "fyi", ["noise", "fyi"])).toBe(true);
    expect(evaluateCondition("in", 2, "1, 2, 3")).toBe(true);
  });

  it("truthy / falsy evaluate the LHS", () => {
    expect(evaluateCondition("truthy", "x", undefined)).toBe(true);
    expect(evaluateCondition("truthy", "", undefined)).toBe(false);
    expect(evaluateCondition("falsy", 0, undefined)).toBe(true);
    expect(evaluateCondition("falsy", "x", undefined)).toBe(false);
  });

  it("throws on an unknown operator", () => {
    expect(() => evaluateCondition("wat", 1, 2)).toThrow(/unknown condition operator/i);
  });
});
