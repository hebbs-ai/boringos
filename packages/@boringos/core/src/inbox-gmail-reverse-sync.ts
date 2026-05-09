// SPDX-License-Identifier: BUSL-1.1
//
// Reverse sync — Gmail → Hebbs.
//
// User archives / reads / labels in Gmail directly (mobile, desktop,
// other clients). Without this loop, Hebbs would still show those
// items in their pre-action state, forcing the user to act twice.
//
// On a fixed cadence (default every 2 min), for each tenant with a
// connected Gmail connector:
//   1. Read `config.gmail.lastHistoryId` from the connector row.
//   2. If absent, seed it from the most recent ingested message and
//      return — no diff to apply yet.
//   3. Otherwise call `users.history.list` (via the `list_history`
//      connector action) and apply the resulting label add/remove
//      and delete events to local inbox items.
//   4. Persist the new historyId cursor so the next tick picks up
//      from where this one left off.
//
// Local writes are optimistic: a label change in Gmail flows back to
// Hebbs the next tick. If Hebbs has a more-recent local mutation
// (`inbox_items.updatedAt > start of tick`), we leave it alone — the
// Hebbs→Gmail outbound sync will re-mirror it shortly.

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { GmailClient } from "@boringos/connector-google";
import { refreshOAuthToken } from "./oauth.js";

interface SimpleResult { success: boolean; data?: unknown; error?: string; }

// Run a Gmail action with OAuth refresh-and-retry. Mirror of the
// pattern in v2-modules/google.ts and inbox-gmail-sync.ts.
async function runGmail(
  db: Db,
  row: { id: string; credentials: Record<string, unknown> | null },
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
      await db.execute(sql`
        UPDATE connectors
           SET credentials = ${JSON.stringify(nextCreds)}::jsonb,
               updated_at  = now()
         WHERE id = ${row.id}
      `).catch(() => {});
      // Mutate in place so subsequent calls in this tick reuse the fresh token.
      row.credentials = nextCreds;
      result = await new GmailClient(refreshed.accessToken).executeAction(action, inputs);
    }
  }
  return result;
}

const KIND_GMAIL = "google";

export interface InboxGmailReverseSyncTicker {
  start(): void;
  stop(): void;
  /** Single tick — exposed for tests / manual triggers. */
  tickOnce(): Promise<{ tenantsScanned: number; eventsApplied: number }>;
}

const DEFAULT_INTERVAL_MS = 2 * 60_000;

interface ConnectorRow {
  id: string;
  tenant_id: string;
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
}

// (credentialsFor removed — runGmail() reads accessToken directly)

function readHistoryId(row: ConnectorRow): string | null {
  const cfg = row.config ?? {};
  const gmail = (cfg as { gmail?: { lastHistoryId?: unknown } }).gmail;
  const v = gmail?.lastHistoryId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function persistHistoryId(
  db: Db,
  row: ConnectorRow,
  historyId: string,
): Promise<void> {
  const cfg = row.config ?? {};
  const gmail = ((cfg as { gmail?: Record<string, unknown> }).gmail) ?? {};
  const nextConfig = {
    ...cfg,
    gmail: { ...gmail, lastHistoryId: historyId },
  };
  await db.execute(sql`
    UPDATE connectors
       SET config = ${JSON.stringify(nextConfig)}::jsonb,
           updated_at = now()
     WHERE id = ${row.id}
  `).catch(() => {});
}

/**
 * Apply a Gmail history event to the matching `inbox_items` row. Lookup
 * is by tenant + Gmail message id stored in metadata. Returns true if
 * we mutated something.
 */
async function applyEvent(
  db: Db,
  tenantId: string,
  event: {
    messageId: string;
    labelsAdded?: string[];
    labelsRemoved?: string[];
    deleted?: boolean;
  },
): Promise<boolean> {
  let nextStatus: string | null = null;

  if (event.deleted) {
    nextStatus = "archived";
  } else if (event.labelsRemoved?.includes("INBOX")) {
    nextStatus = "archived";
  } else if (event.labelsAdded?.includes("UNREAD")) {
    nextStatus = "unread";
  } else if (event.labelsRemoved?.includes("UNREAD")) {
    nextStatus = "read";
  }

  if (!nextStatus) return false;

  const result = await db.execute(sql`
    UPDATE inbox_items
       SET status     = ${nextStatus},
           updated_at = now(),
           archived_at = CASE WHEN ${nextStatus} = 'archived' THEN now() ELSE archived_at END
     WHERE tenant_id  = ${tenantId}
       AND source     = ${"google.gmail"}
       AND source_id  = ${event.messageId}
       AND status    != ${nextStatus}
    RETURNING id
  `);
  const rows = result as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/**
 * Pull the most recent Gmail message id we've ingested for this tenant
 * and use that to seed `lastHistoryId`. We don't have the historyId on
 * the message id alone, so we issue a tiny `read_email` to fetch it.
 */
async function seedHistoryId(
  db: Db,
  row: ConnectorRow,
): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT source_id AS gmail_id
      FROM inbox_items
     WHERE tenant_id = ${row.tenant_id}
       AND source = ${"google.gmail"}
       AND source_id IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1
  `);
  const gmailId = (result as unknown as Array<{ gmail_id: string }>)[0]?.gmail_id;
  if (!gmailId) return null;
  const r = await runGmail(db, row, "read_email", { messageId: gmailId });
  if (!r.success) return null;
  const historyId = (r.data as { historyId?: string } | undefined)?.historyId;
  return typeof historyId === "string" ? historyId : null;
}

export function createInboxGmailReverseSyncTicker(
  db: Db,
  options: { intervalMs?: number } = {},
): InboxGmailReverseSyncTicker {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let interval: ReturnType<typeof setInterval> | null = null;

  async function tickOnce(): Promise<{ tenantsScanned: number; eventsApplied: number }> {
    const rowsResult = await db.execute(sql`
      SELECT id, tenant_id, credentials, config
        FROM connectors
       WHERE kind = ${KIND_GMAIL}
         AND status = ${"active"}
    `);
    const rows = rowsResult as unknown as ConnectorRow[];

    let tenantsScanned = 0;
    let eventsApplied = 0;

    for (const row of rows) {
      tenantsScanned += 1;
      try {
        let historyId = readHistoryId(row);

        if (!historyId) {
          const seeded = await seedHistoryId(db, row);
          if (seeded) {
            await persistHistoryId(db, row, seeded);
          }
          // Either we seeded (no diff to apply this tick) or there's
          // nothing in the inbox yet. Move on.
          continue;
        }

        const result = await runGmail(db, row, "list_history", { startHistoryId: historyId });

        if (!result.success) {
          // 404-equivalent (cursor too old): re-seed from current state.
          if (result.error && /404/.test(result.error)) {
            const seeded = await seedHistoryId(db, row);
            if (seeded) await persistHistoryId(db, row, seeded);
          } else {
            console.warn(
              `[gmail-reverse-sync] history.list failed tenant=${row.tenant_id}:`,
              result.error,
            );
          }
          continue;
        }

        const data = result.data as
          | { events?: Array<{ messageId: string; labelsAdded?: string[]; labelsRemoved?: string[]; deleted?: boolean }>; historyId?: string }
          | undefined;

        for (const event of data?.events ?? []) {
          const applied = await applyEvent(db, row.tenant_id, event);
          if (applied) eventsApplied += 1;
        }

        if (data?.historyId && data.historyId !== historyId) {
          await persistHistoryId(db, row, data.historyId);
        }
      } catch (err) {
        console.warn(
          `[gmail-reverse-sync] tenant=${row.tenant_id} error:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { tenantsScanned, eventsApplied };
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
