// SPDX-License-Identifier: BUSL-1.1
//
// MIME builder tests. The reply path was rewritten from a hand-rolled
// `text/plain` string to a real multipart/alternative builder. These
// tests pin the bits real Gmail clients care about so the next time
// somebody touches the builder they don't silently regress threading
// or non-ASCII handling.

import { describe, it, expect } from "vitest";

import {
  buildOutgoingMime,
  encodeQuotedPrintable,
} from "@boringos/connector-google";

describe("encodeQuotedPrintable", () => {
  it("passes printable ASCII through unchanged", () => {
    expect(encodeQuotedPrintable("Hello, world!")).toBe("Hello, world!");
  });

  it("encodes `=` as =3D", () => {
    expect(encodeQuotedPrintable("a=b")).toBe("a=3Db");
  });

  it("encodes UTF-8 multibyte characters", () => {
    // em-dash U+2014 in UTF-8 = E2 80 94
    expect(encodeQuotedPrintable("a—b")).toBe("a=E2=80=94b");
  });

  it("preserves CRLF as a hard break", () => {
    expect(encodeQuotedPrintable("line1\nline2")).toBe("line1\r\nline2");
  });

  it("encodes trailing whitespace on a line", () => {
    expect(encodeQuotedPrintable("trailing \nnext")).toBe("trailing=20\r\nnext");
  });

  it("soft-wraps lines longer than 76 chars", () => {
    const long = "x".repeat(120);
    const out = encodeQuotedPrintable(long);
    // Each segment between soft breaks must be <= 75 + the trailing `=`.
    for (const seg of out.split("\r\n")) {
      expect(seg.length).toBeLessThanOrEqual(76);
    }
    // Stripping soft breaks reproduces the original.
    const reassembled = out.replace(/=\r\n/g, "");
    expect(reassembled).toBe(long);
  });
});

describe("buildOutgoingMime", () => {
  it("builds a single-part text/plain body when only bodyText is given", () => {
    const mime = buildOutgoingMime({
      to: "jane@example.com",
      subject: "Hi",
      bodyText: "hello",
    });
    expect(mime).toContain("To: jane@example.com");
    expect(mime).toContain("Subject: Hi");
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime).not.toContain("multipart/alternative");
    expect(mime).toContain("hello");
  });

  it("builds a single-part text/html body when only bodyHtml is given", () => {
    const mime = buildOutgoingMime({
      to: "jane@example.com",
      subject: "Hi",
      bodyHtml: "<p>hi</p>",
    });
    expect(mime).toContain("Content-Type: text/html; charset=utf-8");
    expect(mime).not.toContain("multipart/alternative");
    expect(mime).toContain("<p>hi</p>");
  });

  it("builds multipart/alternative with both parts when both bodies are given", () => {
    const mime = buildOutgoingMime({
      to: "jane@example.com",
      subject: "Hi",
      bodyText: "hello",
      bodyHtml: "<p>hi</p>",
    });
    expect(mime).toMatch(/Content-Type: multipart\/alternative; boundary="(=_b_[a-z0-9]+)"/);
    const boundary = /boundary="(=_b_[a-z0-9]+)"/.exec(mime)![1];
    expect(mime).toContain(`--${boundary}`);
    expect(mime).toContain(`--${boundary}--`);
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime).toContain("Content-Type: text/html; charset=utf-8");
    expect(mime).toContain("hello");
    expect(mime).toContain("<p>hi</p>");
  });

  it("emits In-Reply-To and References for replies", () => {
    const mime = buildOutgoingMime({
      to: "jane@example.com",
      subject: "Re: Hi",
      bodyText: "yo",
      inReplyTo: "<deadbeef@mail.gmail.com>",
      references: "<deadbeef@mail.gmail.com>",
    });
    expect(mime).toContain("In-Reply-To: <deadbeef@mail.gmail.com>");
    expect(mime).toContain("References: <deadbeef@mail.gmail.com>");
  });

  it("encodes non-ASCII subject lines as RFC 2047 encoded-words", () => {
    const mime = buildOutgoingMime({
      to: "jane@example.com",
      subject: "Café — réponse",
      bodyText: "ok",
    });
    // Encoded form, not raw UTF-8.
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  });

  it("ASCII-only subjects pass through unchanged", () => {
    const mime = buildOutgoingMime({
      to: "jane@example.com",
      subject: "Plain subject",
      bodyText: "ok",
    });
    expect(mime).toContain("Subject: Plain subject");
    expect(mime).not.toMatch(/=\?UTF-8\?B\?/);
  });

  it("uses CRLF line endings", () => {
    const mime = buildOutgoingMime({
      to: "jane@example.com",
      subject: "Hi",
      bodyText: "ok",
    });
    expect(mime).toContain("\r\n");
    // Header / body separator is exactly CRLF CRLF.
    expect(mime.includes("\r\n\r\n")).toBe(true);
  });

  it("includes MIME-Version on every message", () => {
    expect(buildOutgoingMime({ to: "x@y.z", subject: "s", bodyText: "b" })).toContain(
      "MIME-Version: 1.0",
    );
    expect(buildOutgoingMime({ to: "x@y.z", subject: "s", bodyHtml: "<p>b</p>" })).toContain(
      "MIME-Version: 1.0",
    );
  });
});
