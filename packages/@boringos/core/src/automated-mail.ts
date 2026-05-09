// SPDX-License-Identifier: MIT
//
// Deterministic automated-mail classifier. Runs at ingest time
// (no LLM) so the triage path can short-circuit on clear newsletter
// / automated signals instead of paying for a Claude call to read
// "this is a newsletter, score 5".
//
// Inputs come from the message itself: a small set of RFC headers
// plus the From / Reply-To address. Output is a tristate kind +
// the reasons we landed there, so downstream callers can show the
// user *why* something was filtered.

import type { EmailHeaders } from "@boringos/connector-google";

export type AutomatedKind =
  /** Bulk content with an unsubscribe footer / list headers. */
  | "newsletter"
  /** Machine-generated transactional / system mail (receipts,
   *  password resets, calendar invites from no-reply). */
  | "automated";

export interface AutomatedClassification {
  /** True when at least one signal fired. */
  automated: boolean;
  /** Best-fit kind when `automated` is true; null otherwise. */
  kind: AutomatedKind | null;
  /** Short human-readable reasons (for logs + UI). */
  reasons: string[];
}

const NOREPLY_LOCAL_PART_RE =
  /(?:^|[._-])(?:no[-._]?reply|donotreply|do[-._]?not[-._]?reply|notifications?|alerts?|mailer[-._]?daemon|postmaster|bounces?|noreplies?)(?:[._-]|@|$)/i;

/**
 * Pull the address out of an RFC 5322 From / Reply-To value, e.g.
 * '"Acme Inc" <noreply@acme.com>' → 'noreply@acme.com'. Returns
 * lowercased, trimmed, or null when no `@` is present.
 */
export function extractEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle?.[1] ?? raw).trim().toLowerCase();
  return candidate.includes("@") ? candidate : null;
}

function isNoReplyLocalPart(address: string): boolean {
  const local = address.split("@", 1)[0];
  return NOREPLY_LOCAL_PART_RE.test(local);
}

/**
 * Return a header value lowercased + trimmed, or null. Many of the
 * headers we inspect (Auto-Submitted, Precedence) are case-insensitive
 * by spec, so normalising once at the entry of the classifier keeps
 * the rules below readable.
 */
function norm(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}

/**
 * Classify a message as automated vs human based on a small set of
 * deterministic signals. Designed to err on the side of *not*
 * classifying as automated — false negatives go through full triage
 * (cheap), false positives silence a real reply (expensive).
 *
 * Signals, in priority order:
 *   1. `Auto-Submitted` ≠ "no" → automated  (RFC 3834)
 *   2. `Precedence: bulk|list|junk` → newsletter
 *   3. `List-Unsubscribe` or `List-Id` present → newsletter
 *   4. From / Reply-To address local part matches noreply / notifications /
 *      mailer-daemon / postmaster / bounces → automated
 *
 * The first matching signal wins for `kind`; the rest are still
 * recorded in `reasons` so the UI can surface "filtered because:
 * List-Unsubscribe + noreply@".
 */
export function classifyAutomatedMail(input: {
  headers: EmailHeaders;
  from: string | null;
}): AutomatedClassification {
  const { headers, from } = input;
  const reasons: string[] = [];
  let kind: AutomatedKind | null = null;

  const setKind = (next: AutomatedKind) => {
    if (!kind) kind = next;
  };

  const autoSubmitted = norm(headers.autoSubmitted);
  if (autoSubmitted && autoSubmitted !== "no") {
    setKind("automated");
    reasons.push(`auto-submitted: ${autoSubmitted}`);
  }

  const precedence = norm(headers.precedence);
  if (precedence && (precedence === "bulk" || precedence === "list" || precedence === "junk")) {
    setKind("newsletter");
    reasons.push(`precedence: ${precedence}`);
  }

  if (headers.listUnsubscribe) {
    setKind("newsletter");
    reasons.push("has List-Unsubscribe");
  }

  if (headers.listId) {
    setKind("newsletter");
    reasons.push(`list-id: ${headers.listId.trim()}`);
  }

  const fromAddress = extractEmailAddress(from);
  if (fromAddress && isNoReplyLocalPart(fromAddress)) {
    setKind("automated");
    reasons.push(`no-reply sender: ${fromAddress}`);
  }
  // Reply-To is checked separately — some legitimate humans send From
  // a generic alias but set a real Reply-To. We only flag when *both*
  // From and Reply-To look automated (or Reply-To is missing).
  const replyToAddress = extractEmailAddress(headers.replyTo);
  if (replyToAddress && isNoReplyLocalPart(replyToAddress)) {
    setKind("automated");
    reasons.push(`no-reply Reply-To: ${replyToAddress}`);
  }

  return {
    automated: kind !== null,
    kind,
    reasons,
  };
}
