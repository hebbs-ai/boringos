// SPDX-License-Identifier: BUSL-1.1
//
// Inbox — two-pane layout (list + detail). Phase A1 + A2.
// A3-A8 build out triage chips, HTML rendering, threading, reply send.

import { useEffect, useMemo, useState } from "react";
import { useInbox, useClient, type InboxItem } from "@boringos/ui";
import { useQuery as useReactQuery, useQueryClient } from "@tanstack/react-query";

import { ScreenBody, ScreenHeader } from "../_shared.js";
import { BulkActionBar } from "./BulkActionBar.js";
import { ClassificationFilter } from "./ClassificationFilter.js";
import { InboxList } from "./InboxList.js";
import { InboxDetail } from "./InboxDetail.js";
import { ReplyComposer } from "./ReplyComposer.js";
import { ScheduleMeetingModal } from "./ScheduleMeetingModal.js";
import { SearchBox } from "./SearchBox.js";
import { useNow } from "./useNow.js";
import {
  formatRelativeTime,
  groupByThread,
  readTriage,
  threadMatchesQuery,
  type Classification,
  type ReplyDraft,
} from "./presenter.js";

const STATUSES = ["unread", "read", "snoozed", "archived"] as const;
type Status = (typeof STATUSES)[number];

export function Inbox() {
  const [status, setStatus] = useState<Status>("unread");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState<{
    item: InboxItem;
    draft: ReplyDraft | null;
  } | null>(null);
  const [scheduling, setScheduling] = useState<InboxItem | null>(null);
  const [classFilter, setClassFilter] = useState<Set<Classification>>(new Set());
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  // Anchor for shift-range selection.
  const [bulkAnchorId, setBulkAnchorId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const tickNow = useNow();

  // Last-sync timestamp drives the small "Synced Nm" indicator.
  // Pulled from /api/connectors/status which already lists per-tenant
  // connector rows. We watch the `connectors-status` key independently
  // so refresh + initial load both invalidate it.
  const connectorStatusQuery = useReactQuery({
    queryKey: ["connectors-status"],
    queryFn: async () => {
      type Cfg = { url?: string; token?: string; tenantId?: string };
      const cfg = (client as { config?: Cfg }).config ?? {};
      const res = await fetch(`${cfg.url ?? ""}/api/connectors/status`, {
        headers: {
          ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
          ...(cfg.tenantId ? { "X-Tenant-Id": cfg.tenantId } : {}),
        },
      });
      if (!res.ok) return { connectors: [] as Array<{ lastSyncAt?: string | null }> };
      return (await res.json()) as { connectors: Array<{ lastSyncAt?: string | null }> };
    },
    staleTime: 30_000,
  });

  const lastSyncAt = (() => {
    const list = connectorStatusQuery.data?.connectors ?? [];
    let latest: string | null = null;
    for (const c of list) {
      if (typeof c.lastSyncAt === "string" && (!latest || c.lastSyncAt > latest)) {
        latest = c.lastSyncAt;
      }
    }
    return latest;
  })();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["inbox"] });
    queryClient.invalidateQueries({ queryKey: ["connectors-status"] });
  };

  // Fetch each status independently so the tab badges show live
  // counts. Tanstack dedupes identical query keys, and our react-query
  // client has staleTime: 5s — so this is four fetches once per tab
  // switch, not on every render.
  const unreadQuery = useInbox("unread");
  const readQuery = useInbox("read");
  const snoozedQuery = useInbox("snoozed");
  const archivedQuery = useInbox("archived");
  const queriesByStatus: Record<Status, ReturnType<typeof useInbox>> = {
    unread: unreadQuery,
    read: readQuery,
    snoozed: snoozedQuery,
    archived: archivedQuery,
  };
  const query = queriesByStatus[status];
  const items = (query.data as InboxItem[] | undefined) ?? [];
  const allThreads = useMemo(() => groupByThread(items), [items]);

  // Counts per classification for the filter chips, computed off the
  // current-status thread set BEFORE the filter is applied.
  const classCounts = useMemo<Record<Classification, number>>(() => {
    const counts: Record<Classification, number> = {
      lead: 0, reply: 0, internal: 0, newsletter: 0, spam: 0, unknown: 0,
    };
    for (const t of allThreads) {
      const c = readTriage(t.latest)?.classification ?? "unknown";
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }, [allThreads]);

  const threads = useMemo(() => {
    let out = allThreads;
    if (classFilter.size > 0) {
      out = out.filter((t) => {
        const c = readTriage(t.latest)?.classification ?? "unknown";
        return classFilter.has(c);
      });
    }
    if (searchQuery.trim()) {
      out = out.filter((t) => threadMatchesQuery(t, searchQuery));
    }
    return out;
  }, [allThreads, classFilter, searchQuery]);

  const selectedThread =
    threads.find((t) => t.latest.id === selectedId) ?? null;
  const selected = selectedThread?.latest ?? null;

  const counts: Record<Status, number> = {
    unread: ((unreadQuery.data as InboxItem[] | undefined) ?? []).length,
    read: ((readQuery.data as InboxItem[] | undefined) ?? []).length,
    snoozed: ((snoozedQuery.data as InboxItem[] | undefined) ?? []).length,
    archived: ((archivedQuery.data as InboxItem[] | undefined) ?? []).length,
  };

  const client = useClient();
  const queryClient = useQueryClient();

  // Preselect the first thread on initial load / status switch — fast
  // triage flow: open inbox, top thread is right there.
  useEffect(() => {
    if (!selectedId && threads.length > 0) {
      setSelectedId(threads[0]!.latest.id);
    }
    // If the currently selected item disappeared, jump to the next.
    if (selectedId && !threads.find((t) => t.latest.id === selectedId)) {
      setSelectedId(threads[0]?.latest.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.length, status]);

  // C2 — SSE live updates: subscribe to the realtime bus and refetch
  // inbox queries when the framework publishes inbox.* events. The
  // bridge in boringos.ts forwards inbox.item_created from the
  // workflow eventBus to the realtime bus, so a fresh Gmail sync
  // surfaces in seconds without polling.
  useEffect(() => {
    const sub = (client as { subscribe?: (cb: (e: { type: string }) => void) => () => void }).subscribe;
    if (typeof sub !== "function") return;
    const off = sub((event) => {
      if (event.type.startsWith("inbox.")) {
        queryClient.invalidateQueries({ queryKey: ["inbox"] });
      }
    });
    return () => {
      try { off?.(); } catch { /* ignore */ }
    };
  }, [client, queryClient]);

  // Keyboard shortcuts. Skip when an input/textarea has focus, or a
  // modal is open (the composer handles Esc itself).
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable
      );
    }

    function move(delta: number) {
      const idx = threads.findIndex((t) => t.latest.id === selectedId);
      if (idx < 0) {
        if (threads.length > 0) setSelectedId(threads[0]!.latest.id);
        return;
      }
      const next = Math.max(0, Math.min(threads.length - 1, idx + delta));
      const target = threads[next]?.latest;
      if (target) void handleSelect(target);
    }

    async function onKey(e: KeyboardEvent) {
      if (composing) return;
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const sel = selectedThread?.latest;
      switch (e.key) {
        case "j":
          e.preventDefault();
          move(1);
          break;
        case "k":
          e.preventDefault();
          move(-1);
          break;
        case "Enter":
          e.preventDefault();
          if (sel) void handleSelect(sel);
          break;
        case "e":
          if (sel) {
            e.preventDefault();
            void handleArchive(sel);
          }
          break;
        case "r":
          if (sel) {
            e.preventDefault();
            setComposing({ item: sel, draft: null });
          }
          break;
        case "u":
          if (sel) {
            e.preventDefault();
            void handleMarkUnread(sel);
          }
          break;
        case "t":
          if (sel) {
            e.preventDefault();
            void handleConvertToTask(sel);
          }
          break;
        case "s":
          if (sel) {
            e.preventDefault();
            // Default keyboard snooze = 1 hour. Power users can pick
            // other durations from the toolbar dropdown.
            const oneHour = new Date(Date.now() + 60 * 60_000);
            void handleSnooze(sel, oneHour);
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing, selectedId, threads.length]);

  const handleSelect = async (
    item: InboxItem,
    modifiers: { meta: boolean; shift: boolean } = { meta: false, shift: false },
  ) => {
    // Cmd/Ctrl-click: toggle the row in the bulk-selection set without
    // marking read or changing the focused row.
    if (modifiers.meta) {
      setBulkSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setBulkAnchorId(item.id);
      return;
    }

    // Shift-click: range select from the anchor (or the currently
    // selected row) to this item.
    if (modifiers.shift) {
      const anchor = bulkAnchorId ?? selectedId;
      if (!anchor) {
        setBulkSelected(new Set([item.id]));
        setBulkAnchorId(item.id);
        return;
      }
      const ids = threads.map((t) => t.latest.id);
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(item.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setBulkSelected(new Set(ids.slice(lo, hi + 1)));
      }
      return;
    }

    // Plain click: clear bulk selection, single-select, mark read.
    setBulkSelected(new Set());
    setBulkAnchorId(item.id);
    setSelectedId(item.id);
    // Auto-mark-read: optimistic, in-place. Do NOT invalidate the
    // inbox query — that would refetch the unread filter and the
    // just-clicked row would vanish from the list under the user's
    // cursor. Instead mutate the cached row in place — visual flips
    // bold→regular, item stays present until the user navigates away
    // or takes an explicit action.
    if (item.status === "unread") {
      queryClient.setQueriesData<InboxItem[]>({ queryKey: ["inbox"] }, (old) => {
        if (!old) return old;
        return old.map((i) => (i.id === item.id ? { ...i, status: "read" } : i));
      });
      try {
        await client.updateInboxItem(item.id, { status: "read" });
      } catch {
        queryClient.invalidateQueries({ queryKey: ["inbox"] });
      }
    }
  };

  /** Run an action across every bulk-selected item, then clear. */
  const runBulk = async (
    action: (item: InboxItem) => Promise<unknown>,
  ) => {
    if (bulkSelected.size === 0) return;
    setBulkBusy(true);
    // Optimistic: drop matching rows from the current status query.
    queryClient.setQueriesData<InboxItem[]>({ queryKey: ["inbox", status] }, (old) =>
      old?.filter((i) => !bulkSelected.has(i.id)) ?? old,
    );
    try {
      const targets = items.filter((i) => bulkSelected.has(i.id));
      await Promise.all(targets.map(action));
    } finally {
      setBulkBusy(false);
      setBulkSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    }
  };

  const handleBulkArchive = () => runBulk((i) => client.archiveInboxItem(i.id));
  const handleBulkMarkRead = () => runBulk((i) => client.updateInboxItem(i.id, { status: "read" }));
  const handleBulkMarkUnread = () => runBulk((i) => client.updateInboxItem(i.id, { status: "unread" }));

  // Explicit user actions (archive / snooze / convert-to-task) DO
  // remove the row immediately from the unread list — that's the
  // user's intention. These run a full invalidate so other tabs (and
  // counts) update too.
  const handleActiveAction = async (
    item: InboxItem,
    action: () => Promise<unknown>,
  ) => {
    // Optimistic remove from current list so the row vanishes immediately.
    queryClient.setQueriesData<InboxItem[]>({ queryKey: ["inbox", status] }, (old) =>
      old?.filter((i) => i.id !== item.id) ?? old,
    );
    try {
      await action();
    } finally {
      // Always refetch all inbox-keyed queries: status changed.
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    }
  };

  const handleArchive = (item: InboxItem) =>
    handleActiveAction(item, () => client.archiveInboxItem(item.id));

  const handleConvertToTask = (item: InboxItem) =>
    handleActiveAction(item, () => client.createTaskFromInboxItem(item.id));

  const handleSnooze = (item: InboxItem, until: Date) =>
    handleActiveAction(item, () =>
      client.updateInboxItem(item.id, {
        status: "snoozed",
        snoozeUntil: until.toISOString(),
      }),
    );

  const handleReclassify = async (item: InboxItem, next: Classification) => {
    const existing = (item.metadata ?? {}) as Record<string, unknown>;
    const triage = (existing.triage ?? {}) as Record<string, unknown>;
    const newMetadata = {
      ...existing,
      triage: {
        ...triage,
        classification: next,
        editedBy: "user",
        editedAt: new Date().toISOString(),
      },
    };
    // Optimistic in-place update across all status caches.
    queryClient.setQueriesData<InboxItem[]>({ queryKey: ["inbox"] }, (old) =>
      old?.map((i) => (i.id === item.id ? { ...i, metadata: newMetadata } : i)) ?? old,
    );
    try {
      await client.updateInboxItem(item.id, { metadata: newMetadata });
    } catch {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    }
  };

  const handleMarkUnread = async (item: InboxItem) => {
    // Mark-unread is the inverse of auto-mark-read: optimistic in-place
    // mutation across all status caches; the row stays where it is in
    // the read tab until the user navigates away.
    queryClient.setQueriesData<InboxItem[]>({ queryKey: ["inbox"] }, (old) =>
      old?.map((i) => (i.id === item.id ? { ...i, status: "unread" } : i)) ?? old,
    );
    try {
      await client.updateInboxItem(item.id, { status: "unread" });
    } catch {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    }
  };

  /**
   * Discard a single reply draft from metadata.replyDrafts. PATCH
   * replaces the whole metadata object, so we read the existing
   * metadata, splice the matching draft out, and write back.
   */
  const handleDiscardDraft = async (item: InboxItem, draft: ReplyDraft) => {
    const existing = (item.metadata ?? {}) as Record<string, unknown>;
    const drafts = Array.isArray(existing.replyDrafts) ? existing.replyDrafts : [];
    const next = drafts.filter((d) => {
      if (!d || typeof d !== "object") return true;
      const r = d as Record<string, unknown>;
      return !(r.author === draft.author && r.body === draft.body);
    });
    const newMetadata = { ...existing, replyDrafts: next };

    // Optimistic in-place update so the card disappears immediately.
    queryClient.setQueriesData<InboxItem[]>({ queryKey: ["inbox"] }, (old) =>
      old?.map((i) => (i.id === item.id ? { ...i, metadata: newMetadata } : i)) ?? old,
    );

    try {
      await client.updateInboxItem(item.id, { metadata: newMetadata });
    } catch {
      // Roll back on failure.
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    }
  };

  return (
    <>
      <ScreenHeader
        title="Inbox"
        subtitle="Unified stream from connectors and apps"
        actions={
          <div className="flex items-center gap-2">
            {lastSyncAt && (
              <span
                className="text-[10px] text-muted tabular-nums"
                title={`Last connector sync: ${lastSyncAt}`}
              >
                Synced {formatRelativeTime(lastSyncAt, tickNow)}
              </span>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              className="text-xs px-2 py-1 rounded text-muted-strong hover:bg-bg-warm"
              title="Refresh"
            >
              ↻
            </button>
            <div className="flex items-center gap-1 rounded-md border border-border bg-white p-0.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStatus(s);
                  setSelectedId(null);
                }}
                className={`px-2.5 py-1 text-xs rounded flex items-center gap-1.5 ${
                  status === s
                    ? "bg-bg-warm text-text font-medium"
                    : "text-muted hover:text-text"
                }`}
              >
                <span className="capitalize">{s}</span>
                {counts[s] > 0 && (
                  <span
                    className={`text-[10px] tabular-nums px-1 rounded ${
                      status === s
                        ? "bg-border-subtle text-text-secondary"
                        : "bg-bg-warm text-muted"
                    }`}
                  >
                    {counts[s]}
                  </span>
                )}
              </button>
            ))}
            </div>
          </div>
        }
      />
      <ScreenBody>
        {query.error ? (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <div className="font-medium">Couldn't load inbox.</div>
            <div className="text-xs mt-1 font-mono">
              {query.error instanceof Error
                ? query.error.message
                : String(query.error)}
            </div>
          </div>
        ) : (
          <div className="flex h-full gap-3 -mt-2">
            <div className="w-[380px] shrink-0 flex flex-col">
              <SearchBox
                value={searchQuery}
                onChange={(q) => {
                  setSearchQuery(q);
                  setSelectedId(null);
                }}
              />
              <ClassificationFilter
                active={classFilter}
                counts={classCounts}
                onToggle={(c) => {
                  const next = new Set(classFilter);
                  if (next.has(c)) next.delete(c);
                  else next.add(c);
                  setClassFilter(next);
                  setSelectedId(null);
                }}
                onClear={() => {
                  setClassFilter(new Set());
                  setSelectedId(null);
                }}
              />
              <div className="flex-1 border border-border rounded-lg bg-white overflow-hidden flex flex-col">
                <BulkActionBar
                  count={bulkSelected.size}
                  busy={bulkBusy}
                  onArchive={handleBulkArchive}
                  onMarkRead={handleBulkMarkRead}
                  onMarkUnread={handleBulkMarkUnread}
                  onCancel={() => setBulkSelected(new Set())}
                />
                <InboxList
                  threads={threads}
                  isLoading={query.isLoading}
                  status={status}
                  selectedId={selectedId}
                  bulkSelected={bulkSelected}
                  onSelect={handleSelect}
                />
              </div>
            </div>

            <div className="flex-1 border border-border rounded-lg bg-white overflow-hidden flex flex-col min-w-0">
              <InboxDetail
                thread={selectedThread}
                onDiscardDraft={handleDiscardDraft}
                onMarkUnread={handleMarkUnread}
                onArchive={handleArchive}
                onConvertToTask={handleConvertToTask}
                onSnooze={handleSnooze}
                onReclassify={handleReclassify}
                onReply={(item) => setComposing({ item, draft: null })}
                onUseDraft={(item, draft) => setComposing({ item, draft })}
                onSchedule={(item) => setScheduling(item)}
              />
            </div>
          </div>
        )}
      </ScreenBody>

      {composing && (
        <ReplyComposer
          item={composing.item}
          initialDraft={composing.draft}
          onClose={() => setComposing(null)}
          onSent={async (sentBody) => {
            // Stamp the item with metadata.sentReply so the UI can
            // show "Replied · <time>" later, and archive the row so
            // it disappears from the unread list (matching Gmail/SH).
            const item = composing.item;
            const existing = (item.metadata ?? {}) as Record<string, unknown>;
            const newMetadata = {
              ...existing,
              sentReply: {
                sentAt: new Date().toISOString(),
                body: sentBody,
                via: item.source,
              },
            };
            try {
              await client.updateInboxItem(item.id, { metadata: newMetadata });
              await client.archiveInboxItem(item.id);
            } catch {
              // Non-fatal — the email still went out; UI just won't
              // archive optimally.
            } finally {
              queryClient.invalidateQueries({ queryKey: ["inbox"] });
            }
          }}
        />
      )}

      {scheduling && (
        <ScheduleMeetingModal
          item={scheduling}
          onClose={() => setScheduling(null)}
          onScheduled={() => {
            queryClient.invalidateQueries({ queryKey: ["inbox"] });
          }}
        />
      )}
    </>
  );
}
