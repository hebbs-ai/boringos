// SPDX-License-Identifier: GPL-3.0-or-later
//
// Coverage for the deterministic automated-mail prefilter. The
// classifier is a pure function; if these signals stop matching,
// the inbox-fanout starts paying for LLM triage on clear newsletters
// again — which is the exact bug this ships to fix.

import { describe, it, expect } from "vitest";

import { classifyAutomatedMail, extractEmailAddress } from "@boringos/core";
import type { EmailHeaders } from "@boringos/connector-google";

function emptyHeaders(overrides: Partial<EmailHeaders> = {}): EmailHeaders {
  return {
    listUnsubscribe: null,
    listUnsubscribePost: null,
    listId: null,
    autoSubmitted: null,
    precedence: null,
    returnPath: null,
    replyTo: null,
    messageId: null,
    inReplyTo: null,
    references: null,
    ...overrides,
  };
}

describe("extractEmailAddress", () => {
  it("returns null for missing input", () => {
    expect(extractEmailAddress(null)).toBeNull();
    expect(extractEmailAddress(undefined)).toBeNull();
    expect(extractEmailAddress("")).toBeNull();
    expect(extractEmailAddress("not an email")).toBeNull();
  });

  it("strips display name + angle brackets", () => {
    expect(extractEmailAddress('"Acme Inc" <noreply@acme.com>')).toBe("noreply@acme.com");
    expect(extractEmailAddress("Acme <ops@acme.com>")).toBe("ops@acme.com");
  });

  it("lowercases the address for comparison", () => {
    expect(extractEmailAddress("NoReply@ACME.com")).toBe("noreply@acme.com");
  });

  it("falls through when there is no angle bracket", () => {
    expect(extractEmailAddress("ops@acme.com")).toBe("ops@acme.com");
  });
});

describe("classifyAutomatedMail", () => {
  it("returns automated=false for a plain human email", () => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders(),
      from: "Jane Doe <jane@example.com>",
    });
    expect(result.automated).toBe(false);
    expect(result.kind).toBeNull();
    expect(result.reasons).toEqual([]);
  });

  it("classifies as newsletter on List-Unsubscribe", () => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders({
        listUnsubscribe: "<https://example.com/unsubscribe?id=abc>",
      }),
      from: "Updates <updates@example.com>",
    });
    expect(result.automated).toBe(true);
    expect(result.kind).toBe("newsletter");
    expect(result.reasons).toContain("has List-Unsubscribe");
  });

  it("classifies as newsletter on List-Id", () => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders({ listId: "<weekly.example.com>" }),
      from: "Weekly <weekly@example.com>",
    });
    expect(result.automated).toBe(true);
    expect(result.kind).toBe("newsletter");
    expect(result.reasons.some((r) => r.startsWith("list-id:"))).toBe(true);
  });

  it("classifies as newsletter on Precedence: bulk / list / junk", () => {
    for (const precedence of ["bulk", "list", "junk", "BULK"]) {
      const result = classifyAutomatedMail({
        headers: emptyHeaders({ precedence }),
        from: "ops@example.com",
      });
      expect(result.automated, `precedence=${precedence}`).toBe(true);
      expect(result.kind, `precedence=${precedence}`).toBe("newsletter");
    }
  });

  it("ignores Precedence: anything-else", () => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders({ precedence: "first-class" }),
      from: "ops@example.com",
    });
    expect(result.automated).toBe(false);
  });

  it("classifies as automated on Auto-Submitted ≠ no", () => {
    for (const value of ["auto-replied", "auto-generated", "AUTO-REPLIED"]) {
      const result = classifyAutomatedMail({
        headers: emptyHeaders({ autoSubmitted: value }),
        from: "Vacation <jane@example.com>",
      });
      expect(result.automated, `value=${value}`).toBe(true);
      expect(result.kind, `value=${value}`).toBe("automated");
    }
  });

  it("ignores Auto-Submitted: no (RFC default for human mail)", () => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders({ autoSubmitted: "no" }),
      from: "jane@example.com",
    });
    expect(result.automated).toBe(false);
  });

  it("classifies a noreply@ sender as automated", () => {
    for (const local of [
      "noreply",
      "no-reply",
      "no.reply",
      "donotreply",
      "do-not-reply",
      "notifications",
      "alerts",
      "mailer-daemon",
      "postmaster",
      "bounces",
    ]) {
      const result = classifyAutomatedMail({
        headers: emptyHeaders(),
        from: `${local}@vendor.com`,
      });
      expect(result.automated, `local=${local}`).toBe(true);
      expect(result.kind, `local=${local}`).toBe("automated");
    }
  });

  it("does not flag legitimate names that merely contain 'reply'", () => {
    for (const local of ["replies-to-paul", "replyguy"]) {
      const result = classifyAutomatedMail({
        headers: emptyHeaders(),
        from: `${local}@example.com`,
      });
      expect(result.automated, `local=${local}`).toBe(false);
    }
  });

  it("flags Reply-To: noreply@ even when From is human", () => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders({ replyTo: "no-reply@vendor.com" }),
      from: "Acme Sales <sales@vendor.com>",
    });
    expect(result.automated).toBe(true);
    expect(result.kind).toBe("automated");
    expect(result.reasons.join(",")).toContain("no-reply Reply-To");
  });

  it("records every matching signal in reasons", () => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders({
        listUnsubscribe: "<...>",
        precedence: "bulk",
        autoSubmitted: "auto-generated",
      }),
      from: "noreply@vendor.com",
    });
    expect(result.automated).toBe(true);
    // first signal wins for kind (auto-submitted is checked before
    // list-unsubscribe in the priority order)
    expect(result.kind).toBe("automated");
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  // ─── Vendor-domain allowlist (issue #18) ───────────────────────
  it.each([
    ["receipts@stripe.com", "stripe.com"],
    ["notifications@github.com", "github.com"],
    ["weird-prefix-noreply@notifications.github.com", "github.com"],
    ["alerts@linear.app", "linear.app"],
    ["receipts@vercel.com", "vercel.com"],
    ["invites@calendly.com", "calendly.com"],
  ])("flags %s as automated (transactional vendor domain)", (from, _vendor) => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders(),
      from,
    });
    expect(result.automated).toBe(true);
    expect(result.kind).toBe("automated");
    // Either the vendor-domain signal or the local-part signal
    // can fire for these — both are valid; we just want at least
    // one reason that mentions the domain.
    const joined = result.reasons.join(" ");
    expect(joined).toMatch(/stripe\.com|github\.com|linear\.app|vercel\.com|calendly\.com|no-reply/);
  });

  it("does not flag mail from non-allowlisted domains by domain alone", () => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders(),
      from: "alex@stripemate.com", // similar TLD, NOT stripe.com
    });
    expect(result.automated).toBe(false);
  });

  // ─── Transactional subject regex (issue #18) ───────────────────
  it.each([
    "Receipt for your order",
    "Order confirmation",
    "Payment received",
    "Invoice 12345",
    "Your verification code is 123456",
    "Sign-in code",
    "Password reset",
    "New sign-in to your account",
    "Action required: verify your email",
    "Re: Receipt for last month",
    "Fwd: Your invoice from last week",
  ])("flags %s as automated (transactional subject)", (subject) => {
    const result = classifyAutomatedMail({
      headers: emptyHeaders(),
      from: "ops@unknown-vendor.example",
      subject,
    });
    expect(result.automated).toBe(true);
    expect(result.kind).toBe("automated");
    expect(result.reasons.join(" ")).toMatch(/transactional subject/);
  });

  it("does not flag non-transactional subjects from unknown senders", () => {
    for (const subject of [
      "Hey can we chat tomorrow?",
      "Thanks for the call",
      "Following up on our conversation",
      "Re: project status",
    ]) {
      const result = classifyAutomatedMail({
        headers: emptyHeaders(),
        from: "alex@example.com",
        subject,
      });
      expect(result.automated, `subject=${subject}`).toBe(false);
    }
  });

  it("works without a subject (back-compat with older callers)", () => {
    // Old callers passed only { headers, from }; the function must
    // still classify correctly with subject undefined.
    const result = classifyAutomatedMail({
      headers: emptyHeaders({ listUnsubscribe: "<...>" }),
      from: "weekly@example.com",
    });
    expect(result.automated).toBe(true);
    expect(result.kind).toBe("newsletter");
  });
});
