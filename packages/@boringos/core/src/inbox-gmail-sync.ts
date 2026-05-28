// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Hebbs -> Gmail mirror for inbox state changes.
//
// When a user archives / reads / unreads / snoozes an inbox item that
// originated in Gmail, mirror the action by adding/removing labels on
// the underlying Gmail message. Local update is the source of truth;
// any Gmail-side failure is logged but never rolls back the local
// state -- the user clicked archive, they expect it gone.
//
// Lazy-creates a `Hebbs/Snoozed` label on first snooze and caches the
// label id on the connector_accounts row's `profile.labels.snoozed` so
// we don't hit `users.labels.list` on every call.
//
// Uses AuthManager + the v2 typed GmailClient. Token refresh is
// handled transparently by AuthManager.getToken() + the v2 client's
// fetchWithAuth 401-retry path. No direct credentials access here.

import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectorAccounts, inboxItems } from "@boringos/db";
import { GmailClient } from "@boringos/connector-google";
import type { AuthManager } from "./auth-manager.js";

const SNOOZED_LABEL_NAME = "Hebbs/Snoozed";
const SOURCE_GMAIL = "google.gmail";
const PROVIDER_GOOGLE = "google";
const CALLER_MODULE = "inbox-gmail-sync";

function gmailMessageId(item: { sourceId: string | null; source: string }): string | null {
  if (item.source !== SOURCE_GMAIL) return null;
  return item.sourceId && item.sourceId.length > 0 ? item.sourceId : null;
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

/** Build a GmailClient for the given tenant, or null if no account is connected. */
async function buildGmailClient(
  authManager: AuthManager,
  tenantId: string,
): Promise<GmailClient | null> {
  const handle = await authManager.getToken(PROVIDER_GOOGLE, tenantId, CALLER_MODULE);
  if (!handle) return null;
  return new GmailClient(handle.getToken);
}

/**
 * Resolve the `Hebbs/Snoozed` label id, creating it via Gmail API if it
 * does not exist yet. The result is cached in `connector_accounts.profile`
 * as `labels.snoozed` so we don't call `users.labels.list` on every tick.
 */
async function resolveSnoozedLabelId(
  db: Db,
  authManager: AuthManager,
  tenantId: string,
  gmail: GmailClient,
): Promise<string | null> {
  // Check the cache in connector_accounts.profile first.
  const accounts = await db
    .select({ id: connectorAccounts.id, profile: connectorAccounts.profile })
    .from(connectorAccounts)
    .where(
      and(
        eq(connectorAccounts.tenantId, tenantId),
        eq(connectorAccounts.provider, PROVIDER_GOOGLE),
        eq(connectorAccounts.status, "active"),
      ),
    )
    .limit(1);

  const account = accounts[0];
  if (!account) return null;

  const profile = (account.profile ?? {}) as Record<string, unknown>;
  const cachedLabelId = (profile.labels as { snoozed?: string } | undefined)?.snoozed;
  if (cachedLabelId) return cachedLabelId;

  // No cache hit -- call Gmail API to find or create the label.
  try {
    const { labelId } = await gmail.ensureLabel(SNOOZED_LABEL_NAME);
    if (!labelId) return null;

    // Persist to profile.labels.snoozed so subsequent calls are cache hits.
    const nextProfile: Record<string, unknown> = {
      ...profile,
      labels: { ...((profile.labels as Record<string, unknown> | undefined) ?? {}), snoozed: labelId },
    };
    await db
      .update(connectorAccounts)
      .set({ profile: nextProfile, updatedAt: new Date() })
      .where(eq(connectorAccounts.id, account.id))
      .catch(() => {});

    return labelId;
  } catch (err) {
    console.warn(`[inbox-gmail-sync] ensureLabel failed tenant=${tenantId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export interface GmailSyncDeps {
  db: Db;
  authManager: AuthManager;
}

/** Hebbs archive -> remove `INBOX` label on the Gmail message. */
export async function syncArchive(deps: GmailSyncDeps, tenantId: string, itemId: string): Promise<void> {
  try {
    const item = await loadItem(deps.db, tenantId, itemId);
    if (!item) return;
    const msgId = gmailMessageId(item);
    if (!msgId) return;
    const gmail = await buildGmailClient(deps.authManager, tenantId);
    if (!gmail) return;
    await gmail.archiveMessage(msgId);
  } catch (err) {
    console.warn(`[inbox-gmail-sync] syncArchive error:`, err);
  }
}

/** Hebbs status: read | unread | snoozed | archived -> mirror to labels. */
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
    const gmail = await buildGmailClient(deps.authManager, tenantId);
    if (!gmail) return;

    if (status === "read") {
      await gmail.modifyLabels(msgId, { removeLabelIds: ["UNREAD"] });
    } else if (status === "unread") {
      await gmail.modifyLabels(msgId, { addLabelIds: ["UNREAD"] });
    } else if (status === "snoozed") {
      const labelId = await resolveSnoozedLabelId(deps.db, deps.authManager, tenantId, gmail);
      const addLabelIds = labelId ? [labelId] : [];
      await gmail.modifyLabels(msgId, { addLabelIds, removeLabelIds: ["INBOX"] });
    } else if (status === "archived") {
      await gmail.archiveMessage(msgId);
    }
  } catch (err) {
    console.warn(`[inbox-gmail-sync] syncStatusChange error:`, err);
  }
}

/** Snooze ticker wake -> re-add `INBOX` and remove `Hebbs/Snoozed`. */
export async function syncSnoozeWake(deps: GmailSyncDeps, tenantId: string, itemId: string): Promise<void> {
  try {
    const item = await loadItem(deps.db, tenantId, itemId);
    if (!item) return;
    const msgId = gmailMessageId(item);
    if (!msgId) return;
    const gmail = await buildGmailClient(deps.authManager, tenantId);
    if (!gmail) return;
    const labelId = await resolveSnoozedLabelId(deps.db, deps.authManager, tenantId, gmail);
    const removeLabelIds = labelId ? [labelId] : [];
    await gmail.modifyLabels(msgId, { addLabelIds: ["INBOX"], removeLabelIds });
  } catch (err) {
    console.warn(`[inbox-gmail-sync] syncSnoozeWake error:`, err);
  }
}
