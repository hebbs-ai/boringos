// SPDX-License-Identifier: BUSL-1.1
//
// Compact bar that appears above the list pane when multiple threads
// are selected. Sticky to the top of the list so the user can act on
// the multi-select without scrolling back.

export interface BulkActionBarProps {
  count: number;
  busy?: boolean;
  onArchive: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onCancel: () => void;
}

export function BulkActionBar({
  count,
  busy,
  onArchive,
  onMarkRead,
  onMarkUnread,
  onCancel,
}: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div className="px-3 py-2 bg-accent text-white text-xs flex items-center gap-2">
      <span className="tabular-nums font-medium">{count} selected</span>
      <div className="flex items-center gap-1 ml-auto">
        <button
          type="button"
          onClick={onArchive}
          disabled={busy}
          className="px-2.5 py-1 rounded bg-accent hover:bg-accent-light disabled:opacity-50"
        >
          Archive
        </button>
        <button
          type="button"
          onClick={onMarkRead}
          disabled={busy}
          className="px-2.5 py-1 rounded hover:bg-accent-light disabled:opacity-50"
        >
          Mark read
        </button>
        <button
          type="button"
          onClick={onMarkUnread}
          disabled={busy}
          className="px-2.5 py-1 rounded hover:bg-accent-light disabled:opacity-50"
        >
          Mark unread
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-2.5 py-1 rounded hover:bg-accent-light disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
