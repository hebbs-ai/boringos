// SPDX-License-Identifier: BUSL-1.1
//
// Forward sync — Gmail → Hebbs inbox ingestion.
//
// On a fixed cadence (default every 30s), for each tenant with a
// connected Gmail connector, fetch recent messages and upsert them
// into `inbox_items` so the shell's Inbox screen + the triage agent
// can react.
//
// Cursor: `config.gmail.lastForwardSyncAt` (epoch seconds). On the
// first tick we fetch the last 60 minutes; subsequent ticks fetch
// `after:<cursor>`.
//
// Idempotent: dedups by (tenantId, source='google.gmail', sourceId).
// We re-check existence per row rather than relying on a unique
// constraint because the inbox table doesn't have one and adding
// it would require coordinating with non-Gmail sources.
//
// Replaces v1's `gmail.gmail-sync` workflow + routine, which lived
// inside the deleted @boringos/workflow engine.

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { GmailClient, type EmailHeaders } from "@boringos/connector-google";
import { refreshOAuthToken } from "./oauth.js";
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

const KIND_GMAIL = "google";
const SOURCE_GMAIL = "google.gmail";
const DEFAULT_INTERVAL_MS = 30_000;
const FIRST_RUN_LOOKBACK_SECONDS = 60 * 60; // 1 hour
const MAX_RESULTS_PER_TICK = 25;

interface ConnectorRow {
  id: string;
  tenant_id: string;
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
}

interface SimpleResult {
  success: boolean;
  data?: unknown;
  error?: string;
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

export interface InboxGmailForwardSyncTicker {
  start(): void;
  stop(): void;
  /** Single tick — exposed for tests / manual triggers. */
  tickOnce(): Promise<{ tenantsScanned: number; itemsCreated: number }>;
}

async function runGmail(
  db: Db,
  row: ConnectorRow,
  action: string,
  inputs: Record<string, unknown>,
): Promise<SimpleResult> {
  const access = (row.credentials?.accessToken as string | undefined) ?? "";
  const refresh = row.credentials?.refreshToken as string | undefined;
  let result = await new GmailClient(access).executeAction(action, inputs);
  const looks401 =
    !result.success && typeof result.error === "string" && /\b401\b/.test(result.error);
  if (looks401 && refresh) {
    const refreshed = await refreshOAuthToken("google", refresh);
    if (refreshed) {
      const nextCreds: Record<string, unknown> = {
        ...(row.credentials ?? {}),
        accessToken: refreshed.accessToken,
      };
      if (refreshed.expiresAt) nextCreds.expiresAt = refreshed.expiresAt;
      await db
        .execute(
          sql`UPDATE connectors
                 SET credentials = ${JSON.stringify(nextCreds)}::jsonb,
                     updated_at  = now()
               WHERE id = ${row.id}`,
        )
        .catch(() => {});
      row.credentials = nextCreds;
      result = await new GmailClient(refreshed.accessToken).executeAction(action, inputs);
    }
  }
  return result;
}

function readCursor(row: ConnectorRow): number | null {
  const cfg = row.config ?? {};
  const gmail = (cfg as { gmail?: { lastForwardSyncAt?: unknown } }).gmail;
  const v = gmail?.lastForwardSyncAt;
  return typeof v === "number" && v > 0 ? v : null;
}

async function persistCursor(db: Db, row: ConnectorRow, epochSeconds: number): Promise<void> {
  const cfg = row.config ?? {};
  const gmail = ((cfg as { gmail?: Record<string, unknown> }).gmail) ?? {};
  const nextConfig = {
    ...cfg,
    gmail: { ...gmail, lastForwardSyncAt: epochSeconds },
  };
  await db
    .execute(
      sql`UPDATE connectors
             SET config = ${JSON.stringify(nextConfig)}::jsonb,
                 updated_at = now()
           WHERE id = ${row.id}`,
    )
    .catch(() => {});
}

/**
 * Build the `metadata` JSON payload for a freshly-ingested Gmail
 * message. Pure — exported for unit tests so we can assert
 * prefilter behaviour without spinning up Postgres.
 */
export function buildIngestMetadata(msg: GmailMessage, opts: { now?: Date } = {}): {
  metadata: Record<string, unknown>;
  headers: EmailHeaders;
  automated: AutomatedClassification;
} {
  const headers = msg.headers ?? emptyHeaders();
  const automated = classifyAutomatedMail({ headers, from: msg.from ?? null });
  const metadata: Record<string, unknown> = {
    email: { headers, automated },
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
    metadata.triage = {
      classification: automated.kind === "newsletter" ? "newsletter" : "spam",
      score: automated.kind === "newsletter" ? 5 : 1,
      rationale: `header-prefilter: ${automated.reasons.join("; ")}`,
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

export function createInboxGmailForwardSyncTicker(
  db: Db,
  options: InboxGmailForwardSyncOptions = {},
): InboxGmailForwardSyncTicker {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let interval: ReturnType<typeof setInterval> | null = null;

  async function tickOnce(): Promise<{ tenantsScanned: number; itemsCreated: number }> {
    const rowsResult = await db.execute(sql`
      SELECT id, tenant_id, credentials, config
        FROM connectors
       WHERE kind = ${KIND_GMAIL}
         AND status = ${"active"}
    `);
    const rows = rowsResult as unknown as ConnectorRow[];

    let tenantsScanned = 0;
    let itemsCreated = 0;
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const row of rows) {
      tenantsScanned += 1;
      try {
        const cursor = readCursor(row);
        // First run: catch the past hour. Subsequent runs: only new
        // messages since the last successful tick.
        const after = cursor ?? nowSeconds - FIRST_RUN_LOOKBACK_SECONDS;
        const query = `after:${after} -in:chats`;

        const result = await runGmail(db, row, "list_emails", {
          query,
          maxResults: MAX_RESULTS_PER_TICK,
        });
        if (!result.success) {
          // Don't advance the cursor — retry next tick.
          console.warn(
            `[gmail-forward-sync] list_emails failed tenant=${row.tenant_id}:`,
            result.error,
          );
          continue;
        }

        const messages = ((result.data as { messages?: GmailMessage[] })?.messages ?? []) as GmailMessage[];
        for (const msg of messages) {
          let item: IngestedInboxItem | null = null;
          try {
            item = await ingestMessage(db, row.tenant_id, msg);
          } catch (e) {
            console.warn(
              `[gmail-forward-sync] ingest failed tenant=${row.tenant_id} msg=${msg.id}:`,
              e instanceof Error ? e.message : e,
            );
          }
          if (!item) continue;
          itemsCreated += 1;

          // Fire the ingest hook (used for triage/replier wakeups) and
          // emit an event-bus event for any other subscribers. Both run
          // in best-effort mode — sync continues even if a listener
          // throws.
          if (options.onIngest) {
            try {
              await options.onIngest(item);
            } catch (e) {
              console.warn(
                `[gmail-forward-sync] onIngest threw tenant=${row.tenant_id} item=${item.itemId}:`,
                e instanceof Error ? e.message : e,
              );
            }
          }
          if (options.eventBus) {
            try {
              await options.eventBus.emit({
                connectorKind: KIND_GMAIL,
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
                `[gmail-forward-sync] eventBus.emit threw tenant=${row.tenant_id} item=${item.itemId}:`,
                e instanceof Error ? e.message : e,
              );
            }
          }
        }

        await persistCursor(db, row, nowSeconds);
      } catch (err) {
        console.warn(
          `[gmail-forward-sync] tenant=${row.tenant_id} error:`,
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
