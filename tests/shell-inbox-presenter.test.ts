// SPDX-License-Identifier: BUSL-1.1
//
// Pure-helper coverage for Inbox/presenter.ts. The list-row formatting
// is on the user's hot path — every row renders through these on every
// status switch — so we lock the behavior down here.

import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  formatAbsoluteTime,
  parseSenderName,
  snippetFrom,
  readTriage,
  countDrafts,
  readDrafts,
  scoreTier,
  classificationChipClass,
  groupByThread,
  readThreadId,
  threadMatchesQuery,
  buildQuotedReply,
  buildHtmlQuotedReply,
  htmlToPlainText,
  readSentReply,
} from "@boringos/shell/screens/Inbox/presenter.js";

const NOW = new Date("2026-05-07T12:00:00Z");

describe("formatRelativeTime", () => {
  it("returns 'now' when under 60s", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 30_000), NOW)).toBe("now");
  });

  it("formats minutes for sub-hour gaps", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5m");
    expect(formatRelativeTime(new Date(NOW.getTime() - 59 * 60_000), NOW)).toBe("59m");
  });

  it("formats hours for sub-day gaps", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 3 * 3600_000), NOW)).toBe("3h");
    expect(formatRelativeTime(new Date(NOW.getTime() - 23 * 3600_000), NOW)).toBe("23h");
  });

  it("formats days for sub-week gaps", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 2 * 86400_000), NOW)).toBe("2d");
    expect(formatRelativeTime(new Date(NOW.getTime() - 6 * 86400_000), NOW)).toBe("6d");
  });

  it("uses month + day for >=7d in same year", () => {
    const d = new Date("2026-04-15T10:00:00Z");
    expect(formatRelativeTime(d, NOW)).toBe("Apr 15");
  });

  it("includes year for different-year timestamps", () => {
    const d = new Date("2025-12-25T10:00:00Z");
    expect(formatRelativeTime(d, NOW)).toBe("Dec 25 2025");
  });

  it("returns empty string for invalid input", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("formatAbsoluteTime", () => {
  it("renders something non-empty for valid dates", () => {
    expect(formatAbsoluteTime(new Date("2026-05-07T10:00:00Z"), NOW).length).toBeGreaterThan(0);
  });

  it("returns empty string for invalid input", () => {
    expect(formatAbsoluteTime("not-a-date", NOW)).toBe("");
  });
});

describe("parseSenderName", () => {
  it("extracts quoted display name", () => {
    expect(parseSenderName('"Jordan Cohen" <jordan@cohenlee.example>')).toBe("Jordan Cohen");
  });

  it("extracts bare display name", () => {
    expect(parseSenderName("Jordan Cohen <jordan@cohenlee.example>")).toBe("Jordan Cohen");
  });

  it("returns the email when there's no display name", () => {
    expect(parseSenderName("jordan@cohenlee.example")).toBe("jordan@cohenlee.example");
  });

  it("trims whitespace inside the quoted variant", () => {
    expect(parseSenderName('"  Jordan Cohen  " <j@x>')).toBe("Jordan Cohen");
  });

  it("falls back when null/undefined", () => {
    expect(parseSenderName(null)).toBe("(unknown sender)");
    expect(parseSenderName(undefined)).toBe("(unknown sender)");
    expect(parseSenderName("")).toBe("(unknown sender)");
  });
});

describe("readTriage", () => {
  it("returns null when metadata is missing or has no triage", () => {
    expect(readTriage({ metadata: null })).toBeNull();
    expect(readTriage({ metadata: {} })).toBeNull();
    expect(readTriage({ metadata: { other: "thing" } })).toBeNull();
  });

  it("parses a typical triage block", () => {
    const t = readTriage({
      metadata: {
        triage: {
          classification: "lead",
          score: 82,
          rationale: "High-quality lead",
          classifiedAt: "2026-05-07T10:00:00Z",
        },
      },
    });
    expect(t).toEqual({
      classification: "lead",
      score: 82,
      rationale: "High-quality lead",
      classifiedAt: "2026-05-07T10:00:00Z",
    });
  });

  it("normalizes unknown classification values", () => {
    expect(
      readTriage({ metadata: { triage: { classification: "weird-thing" } } })?.classification,
    ).toBe("unknown");
  });

  it("normalizes case-insensitively", () => {
    expect(
      readTriage({ metadata: { triage: { classification: "LEAD" } } })?.classification,
    ).toBe("lead");
  });

  it("defaults missing fields", () => {
    const t = readTriage({ metadata: { triage: { classification: "spam" } } });
    expect(t?.score).toBe(0);
    expect(t?.rationale).toBe("");
    expect(t?.classifiedAt).toBeNull();
  });
});

describe("countDrafts", () => {
  it("returns 0 when no drafts", () => {
    expect(countDrafts({ metadata: null })).toBe(0);
    expect(countDrafts({ metadata: { triage: {} } })).toBe(0);
    expect(countDrafts({ metadata: { replyDrafts: "not-array" } })).toBe(0);
  });

  it("returns the array length", () => {
    expect(countDrafts({ metadata: { replyDrafts: [{ body: "a" }, { body: "b" }] } })).toBe(2);
  });
});

describe("readDrafts", () => {
  it("returns [] when no metadata or no drafts", () => {
    expect(readDrafts({ metadata: null })).toEqual([]);
    expect(readDrafts({ metadata: {} })).toEqual([]);
    expect(readDrafts({ metadata: { replyDrafts: "not-array" } })).toEqual([]);
  });

  it("normalizes well-formed drafts", () => {
    const got = readDrafts({
      metadata: {
        replyDrafts: [
          { author: "generic-replier", draftedAt: "2026-05-07T10:00:00Z", body: "Hi there" },
          { body: "Just body" },
        ],
      },
    });
    expect(got).toHaveLength(2);
    expect(got[0]?.author).toBe("generic-replier");
    expect(got[0]?.draftedAt).toBe("2026-05-07T10:00:00Z");
    expect(got[1]?.author).toBe("unknown");
    expect(got[1]?.draftedAt).toBeNull();
  });

  it("filters drafts that have no body string", () => {
    const got = readDrafts({
      metadata: {
        replyDrafts: [{ body: "" }, { body: 42 }, null, "string-not-object"],
      },
    });
    expect(got).toEqual([]);
  });
});

describe("scoreTier", () => {
  it("90+ → high", () => {
    expect(scoreTier(95)).toBe("high");
  });
  it("70–89 → high", () => {
    expect(scoreTier(82)).toBe("high");
    expect(scoreTier(70)).toBe("high");
  });
  it("40–69 → medium", () => {
    expect(scoreTier(65)).toBe("medium");
    expect(scoreTier(40)).toBe("medium");
  });
  it("20–39 → low", () => {
    expect(scoreTier(25)).toBe("low");
    expect(scoreTier(20)).toBe("low");
  });
  it("<20 → muted", () => {
    expect(scoreTier(5)).toBe("muted");
    expect(scoreTier(0)).toBe("muted");
  });
});

describe("readThreadId", () => {
  it("returns metadata.threadId when present", () => {
    expect(
      readThreadId({ id: "x", createdAt: new Date(), source: "google.gmail",
        metadata: { threadId: "t123" } }),
    ).toBe("t123");
  });

  it("falls back to item.id when threadId missing", () => {
    expect(
      readThreadId({ id: "abc", createdAt: new Date(), source: "google.gmail",
        metadata: { other: "thing" } }),
    ).toBe("abc");
  });
});

describe("groupByThread", () => {
  const mk = (id: string, threadId: string | null, when: string) => ({
    id,
    createdAt: new Date(when),
    source: "google.gmail",
    metadata: threadId ? { threadId } : null,
  });

  it("groups items sharing a threadId", () => {
    const items = [
      mk("a", "t1", "2026-05-01T10:00:00Z"),
      mk("b", "t1", "2026-05-02T10:00:00Z"),
      mk("c", "t1", "2026-05-03T10:00:00Z"),
    ];
    const threads = groupByThread(items);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.threadId).toBe("t1");
    expect(threads[0]?.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(threads[0]?.latest.id).toBe("c");
  });

  it("creates singleton threads for items without threadId", () => {
    const items = [mk("solo1", null, "2026-05-01T10:00:00Z"), mk("solo2", null, "2026-05-02T10:00:00Z")];
    const threads = groupByThread(items);
    expect(threads).toHaveLength(2);
    expect(threads[0]?.items).toHaveLength(1);
    expect(threads[1]?.items).toHaveLength(1);
  });

  it("orders threads newest-first by latest message", () => {
    const items = [
      mk("oldA", "tA", "2026-05-01T10:00:00Z"),
      mk("newB", "tB", "2026-05-05T10:00:00Z"),
      mk("midA", "tA", "2026-05-04T10:00:00Z"),
    ];
    const threads = groupByThread(items);
    expect(threads[0]?.threadId).toBe("tB"); // newest single message
    expect(threads[1]?.threadId).toBe("tA"); // older overall but still after sort
  });
});

describe("readSentReply", () => {
  it("returns null when missing", () => {
    expect(readSentReply({ metadata: null })).toBeNull();
    expect(readSentReply({ metadata: {} })).toBeNull();
    expect(readSentReply({ metadata: { sentReply: "not-an-object" } })).toBeNull();
  });

  it("parses well-formed reply", () => {
    const got = readSentReply({
      metadata: {
        sentReply: { sentAt: "2026-05-07T10:00:00Z", body: "thanks!", via: "google.gmail" },
      },
    });
    expect(got).toEqual({
      sentAt: "2026-05-07T10:00:00Z",
      body: "thanks!",
      via: "google.gmail",
    });
  });

  it("requires both sentAt and body strings", () => {
    expect(
      readSentReply({ metadata: { sentReply: { sentAt: "x" } } }),
    ).toBeNull();
    expect(
      readSentReply({ metadata: { sentReply: { body: "x" } } }),
    ).toBeNull();
  });

  it("defaults via to 'unknown' when missing", () => {
    expect(
      readSentReply({
        metadata: { sentReply: { sentAt: "x", body: "y" } },
      })?.via,
    ).toBe("unknown");
  });
});

describe("buildQuotedReply", () => {
  it("appends a quoted block under the draft", () => {
    const out = buildQuotedReply({
      draft: "Hi Jordan, sounds good.",
      originalSender: "Jordan <jordan@x.com>",
      originalDate: "2026-05-07T10:00:00Z",
      originalBody: "Original line 1\nOriginal line 2",
    });
    expect(out).toContain("Hi Jordan, sounds good.");
    expect(out).toContain("Jordan <jordan@x.com> wrote:");
    expect(out).toContain("> Original line 1");
    expect(out).toContain("> Original line 2");
  });

  it("strips HTML tags from quoted content", () => {
    const out = buildQuotedReply({
      draft: "ack",
      originalSender: "x",
      originalDate: null,
      originalBody: "<p>Hello <b>World</b></p>",
    });
    // No <p> or <b> in the quoted lines.
    expect(out).not.toContain("<p>");
    expect(out).not.toContain("<b>");
    expect(out).toContain("Hello");
    expect(out).toContain("World");
  });

  it("does not double-quote when draft already has a > block", () => {
    const draft = "ack\n\n> previous line\n> another previous";
    const out = buildQuotedReply({
      draft,
      originalSender: "x",
      originalDate: null,
      originalBody: "should not appear",
    });
    expect(out).toBe("ack\n\n> previous line\n> another previous");
  });

  it("returns just the draft when there's no original body", () => {
    expect(
      buildQuotedReply({
        draft: "Just a fresh reply.",
        originalSender: "x",
        originalDate: null,
        originalBody: null,
      }),
    ).toBe("Just a fresh reply.");
  });

  it("uses 'the sender wrote:' fallback when sender missing", () => {
    const out = buildQuotedReply({
      draft: "ack",
      originalSender: null,
      originalDate: null,
      originalBody: "hi",
    });
    expect(out).toContain("the sender wrote:");
  });
});

describe("threadMatchesQuery", () => {
  const thread = {
    threadId: "t1",
    items: [
      {
        id: "a",
        createdAt: new Date("2026-05-01"),
        source: "google.gmail",
        subject: "Hello world",
        from: "Alice <alice@example.com>",
        body: "Discussing the Q2 roadmap",
        metadata: { triage: { classification: "lead", rationale: "interesting prospect" } },
      },
    ],
    latest: {
      id: "a",
      createdAt: new Date("2026-05-01"),
      source: "google.gmail",
      subject: "Hello world",
      from: "Alice <alice@example.com>",
      body: "Discussing the Q2 roadmap",
      metadata: { triage: { classification: "lead", rationale: "interesting prospect" } },
    },
  };

  it("matches against subject", () => {
    expect(threadMatchesQuery(thread, "hello")).toBe(true);
  });
  it("matches against from", () => {
    expect(threadMatchesQuery(thread, "alice")).toBe(true);
  });
  it("matches against body", () => {
    expect(threadMatchesQuery(thread, "roadmap")).toBe(true);
  });
  it("matches against classification", () => {
    expect(threadMatchesQuery(thread, "lead")).toBe(true);
  });
  it("matches against triage rationale", () => {
    expect(threadMatchesQuery(thread, "prospect")).toBe(true);
  });
  it("returns false for non-matching queries", () => {
    expect(threadMatchesQuery(thread, "xyz999")).toBe(false);
  });
  it("returns true for empty query", () => {
    expect(threadMatchesQuery(thread, "")).toBe(true);
    expect(threadMatchesQuery(thread, "   ")).toBe(true);
  });
});

describe("classificationChipClass", () => {
  it("returns distinct classes for each classification", () => {
    const lead = classificationChipClass("lead");
    const reply = classificationChipClass("reply");
    expect(lead).not.toBe(reply);
    expect(lead).toContain("emerald");
    expect(reply).toContain("accent");
    expect(classificationChipClass("spam")).toContain("rose");
    expect(classificationChipClass("newsletter")).toContain("amber");
  });
});

describe("snippetFrom", () => {
  it("strips HTML tags", () => {
    expect(snippetFrom("<p>Hello <b>World</b></p>", 80)).toBe("Hello World");
  });

  it("collapses whitespace", () => {
    expect(snippetFrom("hello\n\n\n  world", 80)).toBe("hello world");
  });

  it("drops quoted lines (gmail >)", () => {
    expect(snippetFrom("Reply text\n> previous email\n> another quoted line\nMore reply", 80))
      .toBe("Reply text More reply");
  });

  it("decodes basic html entities", () => {
    expect(snippetFrom("Hello&nbsp;World &amp; goodbye", 80)).toBe("Hello World & goodbye");
  });

  it("truncates with ellipsis past maxChars", () => {
    const long = "a".repeat(200);
    const out = snippetFrom(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith("…")).toBe(true);
  });

  it("doesn't truncate when shorter than maxChars", () => {
    expect(snippetFrom("short text", 80)).toBe("short text");
  });
});

describe("buildHtmlQuotedReply", () => {
  const sender = "Jane Doe <jane@example.com>";
  const date = new Date("2026-05-09T12:00:00Z");

  it("wraps the original HTML in a gmail_quote blockquote", () => {
    const out = buildHtmlQuotedReply({
      draftHtml: "<p>Thanks!</p>",
      originalSender: sender,
      originalDate: date,
      originalBodyHtml: "<p>Hi there</p>",
      originalBodyPlain: null,
    });
    expect(out).toContain("<p>Thanks!</p>");
    expect(out).toContain('class="gmail_quote"');
    expect(out).toContain("<p>Hi there</p>");
    expect(out).toContain("Jane Doe");
  });

  it("escapes HTML in the attribution header so sender names with brackets don't break the doc", () => {
    const out = buildHtmlQuotedReply({
      draftHtml: "<p>ok</p>",
      originalSender: "<script>alert(1)</script>",
      originalDate: date,
      originalBodyHtml: "<p>x</p>",
      originalBodyPlain: null,
    });
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("falls back to <pre>-wrapped plain text when bodyHtml is missing", () => {
    const out = buildHtmlQuotedReply({
      draftHtml: "<p>ok</p>",
      originalSender: sender,
      originalDate: date,
      originalBodyHtml: null,
      originalBodyPlain: "Hi there\nLine 2",
    });
    expect(out).toContain("<pre>");
    expect(out).toContain("Hi there");
  });

  it("returns just the draft when there is no original body to quote", () => {
    const out = buildHtmlQuotedReply({
      draftHtml: "<p>ok</p>",
      originalSender: sender,
      originalDate: date,
      originalBodyHtml: null,
      originalBodyPlain: null,
    });
    expect(out).toBe("<p>ok</p>");
  });
});

describe("htmlToPlainText", () => {
  it("strips tags and decodes entities", () => {
    expect(htmlToPlainText("<p>Hello&nbsp;<strong>world</strong>&amp;more</p>"))
      .toBe("Hello world&more");
  });

  it("converts <br> and block boundaries to newlines", () => {
    const out = htmlToPlainText("<p>line 1</p><p>line 2</p><div>line 3<br>line 4</div>");
    expect(out.split("\n")).toEqual(["line 1", "line 2", "line 3", "line 4"]);
  });

  it("returns empty string for empty / null input", () => {
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText(null)).toBe("");
    expect(htmlToPlainText(undefined)).toBe("");
  });

  it("collapses 3+ blank lines down to 2", () => {
    const out = htmlToPlainText("<p>a</p><p></p><p></p><p></p><p>b</p>");
    // <p></p> becomes a blank line; we collapse runs of 3+ blanks to 2.
    expect(out).toBe("a\n\nb");
  });
});
