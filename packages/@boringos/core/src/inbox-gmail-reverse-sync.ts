// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reverse sync -- Gmail -> Hebbs.
//
// User archives / reads / labels in Gmail directly (mobile, desktop,
// other clients). Without this loop, Hebbs would still show those
// items in their pre-action state, forcing the user to act twice.
//
// On a fixed cadence (default every 2 min), for each tenant with a
// connected Gmail account:
//   1. Read `connector_accounts.profile.lastHistoryId` from the account row.
//   2. If absent, seed it from the most recent ingested message and
//      return -- no diff to apply yet.
//   3. Otherwise call `users.history.list` (via the v2 GmailClient) and
//      apply the resulting label add/remove events to local inbox items.
//   4. Persist the new historyId cursor so the next tick picks up
//      from where this one left off.
//
// Local writes are optimistic: a label change in Gmail flows back to
// Hebbs the next tick. If Hebbs has a more-recent local mutation
// (`inbox_items.updatedAt > start of tick`), we leave it alone -- the
// Hebbs->Gmail outbound sync will re-mirror it shortly.

import { sql, eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectorAccounts } from "@boringos/db";
import { GmailClientV2 as GmailClient } from "@boringos/connector-google";
import type { AuthManager } from "./auth-manager.js";

const PROVIDER_GOOGLE = "google";
const CALLER_MODULE = "inbox-gmail-reverse-sync";

export interface InboxGmailReverseSyncTicker {
  start(): void;
  stop(): void;
  /** Single tick -- exposed for tests / manual triggers. */
  tickOnce(): Promise<{ tenantsScanned: number; eventsApplied: number }>;
}

const DEFAULT_INTERVAL_MS = 2 * 60_000;

// Account row from connector_accounts -- only the fields we need.
interface AccountRow {
  id: string;
  tenantId: string;
  accountId: string;
  profile: Record<string, unknown> | null;
}

function readHistoryId(profile: Record<string, unknown> | null): string | null {
  const v = (profile ?? {}).lastHistoryId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function persistHistoryId(
  db: Db,
  account: AccountRow,
  historyId: string,
): Promise<void> {
  const profile = account.profile ?? {};
  const nextProfile = { ...profile, lastHistoryId: historyId };
  await db
    .update(connectorAccounts)
    .set({ profile: nextProfile, updatedAt: new Date() })
    .where(eq(connectorAccounts.id, account.id))
    .catch(() => {});
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
  },
): Promise<boolean> {
  let nextStatus: string | null = null;

  if (event.labelsRemoved?.includes("INBOX")) {
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
 * and use that to seed `lastHistoryId`. We fetch the full message from
 * Gmail to retrieve its historyId field.
 */
async function seedHistoryId(
  db: Db,
  account: AccountRow,
  gmail: GmailClient,
): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT source_id AS gmail_id
      FROM inbox_items
     WHERE tenant_id = ${account.tenantId}
       AND source = ${"google.gmail"}
       AND source_id IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1
  `);
  const gmailId = (result as unknown as Array<{ gmail_id: string }>)[0]?.gmail_id;
  if (!gmailId) return null;
  try {
    const msg = await gmail.getMessage(gmailId);
    // The Gmail REST API returns `historyId` as a top-level field on the
    // full message object. It's not part of our typed GmailMessage
    // interface (which only models the fields we actively use), so we
    // read it from the raw response via a type assertion.
    const historyId = (msg as unknown as { historyId?: string }).historyId;
    return typeof historyId === "string" ? historyId : null;
  } catch {
    return null;
  }
}

export function createInboxGmailReverseSyncTicker(
  db: Db,
  authManager: AuthManager,
  options: { intervalMs?: number } = {},
): InboxGmailReverseSyncTicker {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let interval: ReturnType<typeof setInterval> | null = null;

  async function tickOnce(): Promise<{ tenantsScanned: number; eventsApplied: number }> {
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
      ) as AccountRow[];

    let tenantsScanned = 0;
    let eventsApplied = 0;

    for (const account of accounts) {
      tenantsScanned += 1;
      try {
        const handle = await authManager.getToken(PROVIDER_GOOGLE, account.tenantId, CALLER_MODULE, {
          accountId: account.accountId,
        });
        if (!handle) {
          console.warn(
            `[gmail-reverse-sync] no token tenant=${account.tenantId} account=${account.accountId}`,
          );
          continue;
        }

        const gmail = new GmailClient(handle.getToken);
        let historyId = readHistoryId(account.profile);

        if (!historyId) {
          const seeded = await seedHistoryId(db, account, gmail);
          if (seeded) {
            await persistHistoryId(db, account, seeded);
          }
          // Either we seeded (no diff to apply this tick) or there's
          // nothing in the inbox yet. Move on.
          continue;
        }

        let events: Awaited<ReturnType<typeof gmail.listHistory>>;
        try {
          events = await gmail.listHistory(historyId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // 404-equivalent (cursor too old): re-seed from current state.
          if (/404/.test(msg)) {
            const seeded = await seedHistoryId(db, account, gmail);
            if (seeded) await persistHistoryId(db, account, seeded);
          } else {
            console.warn(
              `[gmail-reverse-sync] history.list failed tenant=${account.tenantId}:`,
              msg,
            );
          }
          continue;
        }

        // The v2 GmailClient returns HistoryEvent[] from listHistory.
        // Each event has labelsAdded/labelsRemoved as arrays of
        // { message: GmailMessage; labelIds: string[] }. We flatten
        // into per-message actions and apply them.
        for (const histEvent of events) {
          for (const entry of histEvent.labelsAdded ?? []) {
            const applied = await applyEvent(db, account.tenantId, {
              messageId: entry.message.id,
              labelsAdded: entry.labelIds,
            });
            if (applied) eventsApplied += 1;
          }
          for (const entry of histEvent.labelsRemoved ?? []) {
            const applied = await applyEvent(db, account.tenantId, {
              messageId: entry.message.id,
              labelsRemoved: entry.labelIds,
            });
            if (applied) eventsApplied += 1;
          }
        }

        // Advance the cursor to the id of the last history event we saw.
        // If the history list was empty there's nothing to advance.
        if (events.length > 0) {
          const lastId = events[events.length - 1].id;
          if (lastId && lastId !== historyId) {
            await persistHistoryId(db, account, lastId);
          }
        }
      } catch (err) {
        console.warn(
          `[gmail-reverse-sync] tenant=${account.tenantId} error:`,
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
