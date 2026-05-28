// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MIME helpers for outgoing Gmail messages.
//
// `GmailClient` (the legacy executeAction-based class) was removed in
// Phase 2 Task 2.9. Only the MIME-building utilities remain here because
// the typed GmailClient in services/gmail/client.ts imports them via a
// dynamic import at this path (kept to avoid a two-file change while
// Tasks 2.9 and 2.10 land). Move to mime-helpers.ts in a follow-up if
// desired.

/**
 * Build an outgoing MIME message for Gmail's `messages.send`. Returns
 * a UTF-8 string the caller base64url-encodes.
 *
 * Shape decisions:
 *   - Default to `multipart/alternative` when both HTML and plain are
 *     provided so any client renders something correct (Gmail picks
 *     HTML, text-only clients fall back to plain).
 *   - Single-part `text/html` or `text/plain` when only one is given.
 *   - Quoted-printable bodies for both parts so non-ASCII (smart quotes,
 *     accents, etc.) survives the 8bit-MIME boundary without mojibake on
 *     older clients.
 *
 * The returned string uses CRLF as RFC 5322 mandates.
 */
export function buildOutgoingMime(args: {
  to: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const { to, subject, bodyText, bodyHtml, inReplyTo, references } = args;

  const headers: string[] = [];
  headers.push(`To: ${to}`);
  headers.push(`Subject: ${encodeMimeHeader(subject)}`);
  headers.push("MIME-Version: 1.0");
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  const hasHtml = typeof bodyHtml === "string" && bodyHtml.length > 0;
  const hasText = typeof bodyText === "string" && bodyText.length > 0;

  if (hasHtml && hasText) {
    const boundary = `=_b_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      encodeQuotedPrintable(bodyText!),
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      encodeQuotedPrintable(bodyHtml!),
      `--${boundary}--`,
      "",
    ];
    return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n");
  }

  if (hasHtml) {
    headers.push("Content-Type: text/html; charset=utf-8");
    headers.push("Content-Transfer-Encoding: quoted-printable");
    return headers.join("\r\n") + "\r\n\r\n" + encodeQuotedPrintable(bodyHtml!);
  }

  headers.push("Content-Type: text/plain; charset=utf-8");
  headers.push("Content-Transfer-Encoding: quoted-printable");
  return headers.join("\r\n") + "\r\n\r\n" + encodeQuotedPrintable(bodyText ?? "");
}

/**
 * Quoted-printable encode per RFC 2045 sec 6.7. Encodes:
 *   - Bytes outside printable ASCII (33-60, 62-126), incl. `=` itself
 *   - Trailing whitespace on each line
 *   - CRLF preserved as a hard line break
 * And soft-wraps lines longer than 76 chars with `=\r\n`.
 */
export function encodeQuotedPrintable(input: string): string {
  const bytes = Buffer.from(input.replace(/\r?\n/g, "\r\n"), "utf-8");
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      out.push("\r\n");
      i++;
      continue;
    }
    if (b === 0x09 || b === 0x20) {
      out.push(String.fromCharCode(b));
      continue;
    }
    if (b >= 0x21 && b <= 0x7e && b !== 0x3d) {
      out.push(String.fromCharCode(b));
      continue;
    }
    out.push("=" + b.toString(16).toUpperCase().padStart(2, "0"));
  }
  let encoded = out.join("");

  encoded = encoded.replace(/([ \t])(?=\r\n|$)/g, (m) =>
    m === " " ? "=20" : "=09",
  );

  const wrapped: string[] = [];
  for (const line of encoded.split("\r\n")) {
    let remaining = line;
    while (remaining.length > 75) {
      let breakAt = 75;
      if (remaining.charAt(breakAt - 1) === "=") breakAt = 74;
      else if (remaining.charAt(breakAt - 2) === "=") breakAt = 73;
      wrapped.push(remaining.slice(0, breakAt) + "=");
      remaining = remaining.slice(breakAt);
    }
    wrapped.push(remaining);
  }
  return wrapped.join("\r\n");
}

/**
 * Encode a header value with non-ASCII characters using RFC 2047
 * encoded-words. Pure-ASCII values pass through unchanged.
 */
function encodeMimeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7f]/.test(value)) return value;
  const b64 = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}
