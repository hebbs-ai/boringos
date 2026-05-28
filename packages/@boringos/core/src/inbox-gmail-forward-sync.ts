// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Forward sync -- Gmail -> Hebbs inbox ingestion.
//
// On a fixed cadence (default every 30s), for each tenant with a
// connected Gmail account, fetch recent messages and upsert them
// into `inbox_items` so the shell's Inbox screen and the triage agent
// can react.
//
// Cursor: `connector_accounts.profile.lastForwardSyncAt` (epoch seconds).
// On the first tick we fetch the last 60 minutes; subsequent ticks fetch
// `after:<cursor>`.
//
// Flag: `connector_accounts.profile.forwardSyncEnabled` (boolean, default
// true). Set it to false to pause ingestion for a specific account without
// disconnecting. Omitting it is the same as true.
//
// Idempotent: dedups by (tenantId, source='google.gmail', sourceId).
// We re-check existence per row rather than relying on a unique
// constraint because the inbox table doesn't have one and adding
// it would require coordinating with non-Gmail sources.
//
// Standalone ticker (no workflow dependency).

import { sql, eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectorAccounts } from "@boringos/db";
import { GmailClientV2 as GmailClient, type EmailHeaders } from "@boringos/connector-google";
import type { AuthManager } from "./auth-manager.js";
import type { EventBus } from "./event-bus.js";
import {
  classifyAutomatedMail,
  type AutomatedClassification,
} from "./automated-mail.js";

export interface IngestedInboxItem {
  itemId: string;
  tenantId: string;
  source: string;
  sourceId: string;
  subject: string;
  body: string | null;
  from: string | null;
  threadId?: string;
  /** Headers we pull from every Gmail message. Always present;
   *  individual fields are null when the header was absent. */
  headers: EmailHeaders;
  /** Deterministic prefilter result. When `automated` is true, the
   *  ingest path also pre-populates `metadata.triage` so the triage
   *  agent doesn't run; downstream listeners can also use this to
   *  decide whether to wake the replier. */
  automated: AutomatedClassification;
}

const PROVIDER_GOOGLE = "google";
const SOURCE_GMAIL = "google.gmail";
const CALLER_MODULE = "inbox-gmail-forward-sync";
const DEFAULT_INTERVAL_MS = 30_000;
const FIRST_RUN_LOOKBACK_SECONDS = 60 * 60; // 1 hour
const MAX_RESULTS_PER_TICK = 25;

// Account row from connector_accounts -- only the fields we need.
interface AccountRow {
  id: string;
  tenantId: string;
  accountId: string;
  profile: Record<string, unknown> | null;
}

interface GmailMessage {
  id: string;
  threadId?: string;
  subject?: string | null;
  from?: string | null;
  snippet?: string | null;
  body?: string | null;
  /** Raw HTML body when the message had a `text/html` MIME part.
   *  Persisted into `metadata.bodyHtml` so the shell's sandboxed
   *  iframe renderer can show it as rich text instead of leaking
   *  raw markup through the plain-text fallback. */
  bodyHtml?: string | null;
  date?: string | null;
  headers?: EmailHeaders;
  /** Gmail system + user label ids on the message (e.g. CATEGORY_UPDATES,
   *  CATEGORY_PROMOTIONS, SPAM, IMPORTANT, STARRED, user labels). A
   *  strong triage/lead signal -- persisted to `metadata.email.gmailLabels`. */
  labelIds?: string[];
}

function emptyHeaders(): EmailHeaders {
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
  };
}

/** Decode a base64url-encoded Gmail body part to UTF-8 text. */
function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

type GmailPayload = {
  body?: { data?: string };
  mimeType?: string;
  parts?: Array<{
    mimeType: string;
    body?: { data?: string };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  }>;
  headers?: Array<{ name: string; value: string }>;
};

/** Extract both plain-text and HTML bodies from a Gmail message payload. */
function extractBodies(payload?: GmailPayload): { plain: string | null; html: string | null } {
  if (!payload) return { plain: null, html: null };

  // Single-part message -- body is directly on the payload
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/html") {
      return { plain: null, html: decoded };
    }
    return { plain: decoded, html: null };
  }

  if (!payload.parts) return { plain: null, html: null };

  let plain: string | null = null;
  let html: string | null = null;

  for (const part of payload.parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      plain = decodeBase64Url(part.body.data);
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html = decodeBase64Url(part.body.data);
    }
    // Nested multipart (e.g. multipart/alternative inside multipart/mixed)
    if (part.parts) {
      for (const sub of part.parts) {
        if (sub.mimeType === "text/plain" && sub.body?.data && !plain) {
          plain = decodeBase64Url(sub.body.data);
        } else if (sub.mimeType === "text/html" && sub.body?.data && !html) {
          html = decodeBase64Url(sub.body.data);
        }
      }
    }
  }

  return { plain, html };
}

function extractEmailHeaders(
  rawHeaders: Array<{ name: string; value: string }> | undefined,
): EmailHeaders {
  if (!rawHeaders || rawHeaders.length === 0) return emptyHeaders();
  const get = (name: string) =>
    rawHeaders.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  return {
    listUnsubscribe: get("List-Unsubscribe"),
    listUnsubscribePost: get("List-Unsubscribe-Post"),
    listId: get("List-Id"),
    autoSubmitted: get("Auto-Submitted"),
    precedence: get("Precedence"),
    returnPath: get("Return-Path"),
    replyTo: get("Reply-To"),
    messageId: get("Message-ID") ?? get("Message-Id"),
    inReplyTo: get("In-Reply-To"),
    references: get("References"),
  };
}

/** Parse a raw GmailMessage from the v2 getMessage() response into our local shape. */
function parseGmailMessage(raw: {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  payload?: GmailPayload;
}): GmailMessage {
  const headers = raw.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  const { plain, html } = extractBodies(raw.payload);
  return {
    id: raw.id,
    threadId: raw.threadId,
    subject: getHeader("Subject"),
    from: getHeader("From"),
    date: getHeader("Date"),
    body: plain ?? html,
    bodyHtml: html,
    snippet: raw.snippet || null,
    labelIds: raw.labelIds ?? [],
    headers: extractEmailHeaders(headers),
  };
}

function readCursor(profile: Record<string, unknown> | null): number | null {
  const v = (profile ?? {}).lastForwardSyncAt;
  return typeof v === "number" && v > 0 ? v : null;
}

async function persistCursor(
  db: Db,
  account: AccountRow,
  epochSeconds: number,
): Promise<void> {
  const profile = account.profile ?? {};
  const nextProfile = { ...profile, lastForwardSyncAt: epochSeconds };
  await db
    .update(connectorAccounts)
    .set({ profile: nextProfile, updatedAt: new Date() })
    .where(eq(connectorAccounts.id, account.id))
    .catch(() => {});
}

/**
 * Build the `metadata` JSON payload for a freshly-ingested Gmail
 * message. Pure -- exported for unit tests so we can assert
 * prefilter behaviour without spinning up Postgres.
 */
export function buildIngestMetadata(msg: GmailMessage, opts: { now?: Date } = {}): {
  metadata: Record<string, unknown>;
  headers: EmailHeaders;
  automated: AutomatedClassification;
} {
  const headers = msg.headers ?? emptyHeaders();
  const gmailLabels = msg.labelIds ?? [];
  const automated = classifyAutomatedMail({ headers, from: msg.from ?? null, gmailLabels });
  const metadata: Record<string, unknown> = {
    email: { headers, automated, gmailLabels },
  };
  if (msg.threadId) metadata.threadId = msg.threadId;
  if (msg.date) metadata.date = msg.date;
  // Persist HTML separately from `body` (which is plain ?? html for
  // back-compat with consumers that only use the column). Shell's
  // EmailBody reads metadata.bodyHtml and renders it in a sandboxed
  // iframe; without this, HTML-only emails (Stripe receipts, "Payment
  // Received" notices) showed up with raw markup as text.
  if (msg.bodyHtml) metadata.bodyHtml = msg.bodyHtml;
  if (automated.automated) {
    // Both newsletter and noreply/auto-submitted material map to the
    // `noise` label (auto-archive). The original kind survives on
    // `metadata.email.automated.kind` for any consumer that wants to
    // distinguish.
    metadata.triage = {
      label: "noise",
      reason: `header-prefilter: ${automated.reasons.join("; ")}`,
      classifiedAt: (opts.now ?? new Date()).toISOString(),
      source: "header-prefilter",
    };
  }
  return { metadata, headers, automated };
}

async function ingestMessage(
  db: Db,
  tenantId: string,
  msg: GmailMessage,
): Promise<IngestedInboxItem | null> {
  if (!msg.id) return null;

  // Dedup: skip if we've already ingested this Gmail message.
  const existing = await db.execute(sql`
    SELECT id FROM inbox_items
     WHERE tenant_id = ${tenantId}
       AND source = ${SOURCE_GMAIL}
       AND source_id = ${msg.id}
     LIMIT 1
  `);
  if ((existing as unknown as Array<{ id: string }>).length > 0) return null;

  const subject = msg.subject ?? "(no subject)";
  const body = msg.body ?? msg.snippet ?? null;
  const from = msg.from ?? null;
  const { metadata, headers, automated } = buildIngestMetadata(msg);

  const inserted = await db.execute(sql`
    INSERT INTO inbox_items (
      tenant_id, source, source_id, subject, body, "from",
      status, metadata, created_at, updated_at
    ) VALUES (
      ${tenantId},
      ${SOURCE_GMAIL},
      ${msg.id},
      ${subject},
      ${body},
      ${from},
      ${"unread"},
      ${JSON.stringify(metadata)}::jsonb,
      now(), now()
    )
    RETURNING id
  `);
  const itemId = (inserted as unknown as Array<{ id: string }>)[0]?.id;
  if (!itemId) return null;
  return {
    itemId,
    tenantId,
    source: SOURCE_GMAIL,
    sourceId: msg.id,
    subject,
    body,
    from,
    threadId: msg.threadId,
    headers,
    automated,
  };
}

export interface InboxGmailForwardSyncOptions {
  intervalMs?: number;
  /** Fired after a new inbox item is inserted, before the next message
   *  in the batch is processed. Used by boringos.ts to trigger the
   *  triage / replier wakeups. Errors thrown by the listener are
   *  swallowed so they don't abort the sync. */
  onIngest?: (item: IngestedInboxItem) => Promise<void> | void;
  /** Optional event-bus emit. When provided, the ticker also emits
   *  `inbox.item_created` events so any other event-driven listeners
   *  (workflows, plugins) can subscribe. */
  eventBus?: EventBus;
}

export interface InboxGmailForwardSyncTicker {
  start(): void;
  stop(): void;
  /** Single tick -- exposed for tests / manual triggers. */
  tickOnce(): Promise<{ tenantsScanned: number; itemsCreated: number }>;
}

export function createInboxGmailForwardSyncTicker(
  db: Db,
  authManager: AuthManager,
  options: InboxGmailForwardSyncOptions = {},
): InboxGmailForwardSyncTicker {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let interval: ReturnType<typeof setInterval> | null = null;

  async function tickOnce(): Promise<{ tenantsScanned: number; itemsCreated: number }> {
    // `forwardSyncEnabled` defaults on -- only an explicit false (set via
    // the connector's "pause email sync" toggle) drops an account from the
    // poll without disconnecting the connection.
    const accounts = await db
      .select({
        id: connectorAccounts.id,
        tenantId: connectorAccounts.tenantId,
        accountId: connectorAccounts.accountId,
        profile: connectorAccounts.profile,
      })
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.provider, PROVIDER_GOOGLE),
          eq(connectorAccounts.status, "active"),
        ),
      );

    // Filter by forwardSyncEnabled in JS (cheaper than JSONB operator, and
    // the table is expected to stay small).
    const eligible = accounts.filter((a) => {
      const profile = (a.profile ?? {}) as Record<string, unknown>;
      return profile.forwardSyncEnabled !== false;
    }) as AccountRow[];

    let tenantsScanned = 0;
    let itemsCreated = 0;
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const account of eligible) {
      tenantsScanned += 1;
      try {
        const handle = await authManager.getToken(PROVIDER_GOOGLE, account.tenantId, CALLER_MODULE, {
          accountId: account.accountId,
        });
        if (!handle) {
          console.warn(
            `[gmail-forward-sync] no token tenant=${account.tenantId} account=${account.accountId}`,
          );
          continue;
        }

        const gmail = new GmailClient(handle.getToken);
        const cursor = readCursor(account.profile);
        // First run: catch the past hour. Subsequent runs: only new
        // messages since the last successful tick.
        const after = cursor ?? nowSeconds - FIRST_RUN_LOOKBACK_SECONDS;
        const query = `after:${after} -in:chats`;

        let partialMessages: { id: string; threadId: string }[];
        try {
          partialMessages = await gmail.listMessages({ query, maxResults: MAX_RESULTS_PER_TICK });
        } catch (err) {
          console.warn(
            `[gmail-forward-sync] listMessages failed tenant=${account.tenantId}:`,
            err instanceof Error ? err.message : err,
          );
          continue;
        }

        for (const partial of partialMessages) {
          // listMessages returns partial objects (id + threadId only).
          // Fetch the full message to get subject, from, body, labelIds, etc.
          let rawMsg: Awaited<ReturnType<typeof gmail.getMessage>>;
          try {
            rawMsg = await gmail.getMessage(partial.id);
          } catch (err) {
            console.warn(
              `[gmail-forward-sync] getMessage failed tenant=${account.tenantId} msg=${partial.id}:`,
              err instanceof Error ? err.message : err,
            );
            continue;
          }

          const msg = parseGmailMessage(rawMsg as Parameters<typeof parseGmailMessage>[0]);

          let item: IngestedInboxItem | null = null;
          try {
            item = await ingestMessage(db, account.tenantId, msg);
          } catch (e) {
            console.warn(
              `[gmail-forward-sync] ingest failed tenant=${account.tenantId} msg=${msg.id}:`,
              e instanceof Error ? e.message : e,
            );
          }
          if (!item) continue;
          itemsCreated += 1;

          // Fire the ingest hook (used for triage/replier wakeups) and
          // emit an event-bus event for any other subscribers. Both run
          // in best-effort mode -- sync continues even if a listener throws.
          if (options.onIngest) {
            try {
              await options.onIngest(item);
            } catch (e) {
              console.warn(
                `[gmail-forward-sync] onIngest threw tenant=${account.tenantId} item=${item.itemId}:`,
                e instanceof Error ? e.message : e,
              );
            }
          }
          if (options.eventBus) {
            try {
              await options.eventBus.emit({
                connectorKind: PROVIDER_GOOGLE,
                type: "inbox.item_created",
                tenantId: item.tenantId,
                timestamp: new Date(),
                data: {
                  itemId: item.itemId,
                  source: item.source,
                  sourceId: item.sourceId,
                  subject: item.subject,
                  body: item.body,
                  from: item.from,
                  threadId: item.threadId,
                  headers: item.headers,
                  automated: item.automated,
                },
              });
            } catch (e) {
              console.warn(
                `[gmail-forward-sync] eventBus.emit threw tenant=${account.tenantId} item=${item.itemId}:`,
                e instanceof Error ? e.message : e,
              );
            }
          }
        }

        await persistCursor(db, account, nowSeconds);
      } catch (err) {
        console.warn(
          `[gmail-forward-sync] tenant=${account.tenantId} error:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { tenantsScanned, itemsCreated };
  }

  return {
    tickOnce,
    start() {
      if (interval) return;
      // First tick after a short grace so the framework's own writes
      // settle before we start polling Gmail.
      setTimeout(() => tickOnce().catch(() => {}), 5_000);
      interval = setInterval(() => {
        tickOnce().catch(() => {});
      }, intervalMs);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
  };
}
