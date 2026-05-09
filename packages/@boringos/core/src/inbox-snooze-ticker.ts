// SPDX-License-Identifier: BUSL-1.1
//
// Inbox snooze ticker — every 30s, flip any snoozed inbox_items whose
// snooze_until has elapsed back to status='unread' (and clear the
// timestamp so they don't reset). Decoupled from the routine
// scheduler so the snooze tick rate can be tuned independently.

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { syncSnoozeWake } from "./inbox-gmail-sync.js";

export interface InboxSnoozeTicker {
  start(): void;
  stop(): void;
  /** Run a single tick; exposed for tests. Returns the number of items flipped. */
  tickOnce(): Promise<number>;
}

const DEFAULT_INTERVAL_MS = 30_000;

export function createInboxSnoozeTicker(
  db: Db,
  options: { intervalMs?: number } = {},
): InboxSnoozeTicker {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let interval: ReturnType<typeof setInterval> | null = null;

  async function tickOnce(): Promise<number> {
    const result = await db.execute<{ id: string; tenant_id: string }>(sql`
      WITH wakes AS (
        UPDATE inbox_items
           SET status = 'unread',
               snooze_until = NULL,
               updated_at = now()
         WHERE status = 'snoozed'
           AND snooze_until IS NOT NULL
           AND snooze_until <= now()
        RETURNING id, tenant_id
      )
      SELECT id, tenant_id FROM wakes;
    `);
    const rows = result as unknown as Array<{ id: string; tenant_id: string }>;
    // Mirror the wake to Gmail (re-add INBOX, remove Hebbs/Snoozed) for
    // each item — fire-and-forget. Failures are logged inside the
    // helper; the local DB flip is the source of truth.
    for (const row of rows) {
      void syncSnoozeWake({ db }, row.tenant_id, row.id);
    }
    return rows.length;
  }

  return {
    tickOnce,
    start() {
      if (interval) return;
      // First tick immediately so server restart wakes any items that
      // crossed the threshold while the process was down.
      tickOnce().catch(() => {});
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
