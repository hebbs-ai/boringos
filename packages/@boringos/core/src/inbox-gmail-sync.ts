// SPDX-License-Identifier: MIT
//
// Hebbs → Gmail mirror for inbox state changes.
//
// When a user archives / reads / unreads / snoozes an inbox item that
// originated in Gmail, mirror the action by adding/removing labels on
// the underlying Gmail message. Local update is the source of truth;
// any Gmail-side failure is logged but never rolls back the local
// state — the user clicked archive, they expect it gone.
//
// Lazy-creates a `Hebbs/Snoozed` label on first snooze and caches the
// label id on the connector row's `config.labels.snoozed` so we don't
// hit `users.labels.list` on every call.
//
// v1 used `ActionRunner.execute(...)` to dispatch the Gmail label
// calls. With the connector framework deleted, we instantiate
// `GmailClient` directly here. Same HTTP path, fewer indirections.

import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors, inboxItems } from "@boringos/db";
import { GmailClient } from "@boringos/connector-google";
import { refreshOAuthToken } from "./oauth.js";

const SNOOZED_LABEL_NAME = "Hebbs/Snoozed";
const SOURCE_GMAIL = "google.gmail";
const KIND_GMAIL = "google";

function gmailMessageId(item: { sourceId: string | null; source: string }): string | null {
  if (item.source !== SOURCE_GMAIL) return null;
  return item.sourceId && item.sourceId.length > 0 ? item.sourceId : null;
}

interface ConnectorRow {
  id: string;
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
}

async function loadConnector(db: Db, tenantId: string): Promise<ConnectorRow | null> {
  const rows = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, KIND_GMAIL)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    credentials: (row.credentials as Record<string, unknown>) ?? null,
    config: (row.config as Record<string, unknown>) ?? null,
  };
}

/**
 * Run a Gmail action with OAuth refresh-and-retry. Mirror of the
 * pattern in `v2-modules/google.ts`.
 */
async function runWithRefresh(
  db: Db,
  row: ConnectorRow,
  action: string,
  inputs: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const access = (row.credentials?.accessToken as string | undefined) ?? "";
  const refresh = row.credentials?.refreshToken as string | undefined;
  let result = await new GmailClient(access).executeAction(action, inputs);
  const looks401 =
    !result.success && typeof result.error === "string" && /\b401\b/.test(result.error);
  if (looks401 && refresh) {
    const refreshed = await refreshOAuthToken("google", refresh);
    if (refreshed) {
      // postgres-js rejects undefined params, so omit `expiresAt`
      // rather than setting it to undefined when absent.
      const nextCreds: Record<string, unknown> = {
        ...(row.credentials ?? {}),
        accessToken: refreshed.accessToken,
      };
      if (refreshed.expiresAt) nextCreds.expiresAt = refreshed.expiresAt;
      await db
        .update(connectors)
        .set({ credentials: nextCreds, updatedAt: new Date() })
        .where(eq(connectors.id, row.id))
        .catch(() => {});
      result = await new GmailClient(refreshed.accessToken).executeAction(action, inputs);
    }
  }
  return result;
}

async function resolveSnoozedLabelId(
  db: Db,
  row: ConnectorRow,
): Promise<string | null> {
  const cached = (row.config?.labels as { snoozed?: string } | undefined)?.snoozed;
  if (cached) return cached;
  const result = await runWithRefresh(db, row, "ensure_label", { name: SNOOZED_LABEL_NAME });
  if (!result.success) return null;
  const labelId = (result.data as { id?: string } | undefined)?.id ?? null;
  if (!labelId) return null;
  const nextConfig = {
    ...(row.config ?? {}),
    labels: { ...((row.config?.labels as Record<string, unknown> | undefined) ?? {}), snoozed: labelId },
  };
  await db
    .update(connectors)
    .set({ config: nextConfig, updatedAt: new Date() })
    .where(eq(connectors.id, row.id))
    .catch(() => {});
  return labelId;
}

async function modify(
  db: Db,
  row: ConnectorRow,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<void> {
  const result = await runWithRefresh(db, row, "modify_email", {
    messageId,
    addLabelIds,
    removeLabelIds,
  });
  if (!result.success) {
    console.warn(`[inbox-gmail-sync] modify_email failed for message=${messageId}:`, result.error);
  }
}

async function loadItem(
  db: Db,
  tenantId: string,
  itemId: string,
): Promise<{ source: string; sourceId: string | null } | null> {
  const rows = await db
    .select({ source: inboxItems.source, sourceId: inboxItems.sourceId })
    .from(inboxItems)
    .where(and(eq(inboxItems.id, itemId), eq(inboxItems.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface GmailSyncDeps {
  db: Db;
}

/** Hebbs archive → remove `INBOX` label on the Gmail message. */
export async function syncArchive(deps: GmailSyncDeps, tenantId: string, itemId: string): Promise<void> {
  try {
    const item = await loadItem(deps.db, tenantId, itemId);
    if (!item) return;
    const msgId = gmailMessageId(item);
    if (!msgId) return;
    const row = await loadConnector(deps.db, tenantId);
    if (!row) return;
    await modify(deps.db, row, msgId, [], ["INBOX"]);
  } catch (err) {
    console.warn(`[inbox-gmail-sync] syncArchive error:`, err);
  }
}

/** Hebbs status: read | unread | snoozed | archived → mirror to labels. */
export async function syncStatusChange(
  deps: GmailSyncDeps,
  tenantId: string,
  itemId: string,
  status: string,
): Promise<void> {
  try {
    const item = await loadItem(deps.db, tenantId, itemId);
    if (!item) return;
    const msgId = gmailMessageId(item);
    if (!msgId) return;
    const row = await loadConnector(deps.db, tenantId);
    if (!row) return;

    if (status === "read") {
      await modify(deps.db, row, msgId, [], ["UNREAD"]);
    } else if (status === "unread") {
      await modify(deps.db, row, msgId, ["UNREAD"], []);
    } else if (status === "snoozed") {
      const labelId = await resolveSnoozedLabelId(deps.db, row);
      const add = labelId ? [labelId] : [];
      await modify(deps.db, row, msgId, add, ["INBOX"]);
    } else if (status === "archived") {
      await modify(deps.db, row, msgId, [], ["INBOX"]);
    }
  } catch (err) {
    console.warn(`[inbox-gmail-sync] syncStatusChange error:`, err);
  }
}

/** Snooze ticker wake → re-add `INBOX` and remove `Hebbs/Snoozed`. */
export async function syncSnoozeWake(deps: GmailSyncDeps, tenantId: string, itemId: string): Promise<void> {
  try {
    const item = await loadItem(deps.db, tenantId, itemId);
    if (!item) return;
    const msgId = gmailMessageId(item);
    if (!msgId) return;
    const row = await loadConnector(deps.db, tenantId);
    if (!row) return;
    const labelId = await resolveSnoozedLabelId(deps.db, row);
    const remove = labelId ? [labelId] : [];
    await modify(deps.db, row, msgId, ["INBOX"], remove);
  } catch (err) {
    console.warn(`[inbox-gmail-sync] syncSnoozeWake error:`, err);
  }
}
