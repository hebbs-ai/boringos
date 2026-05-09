// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";
import type { ActivityRow as ActivityRowT } from "@boringos/ui";
import { actionLabel, actorBadge, formatTime } from "./presenter.js";

export function ActivityRow({ row }: { row: ActivityRowT }) {
  const [open, setOpen] = useState(false);
  const hasPayload = row.metadata && Object.keys(row.metadata).length > 0;

  return (
    <li className="flex items-start gap-3 px-4 py-2.5 hover:bg-bg">
      <span
        className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${actorBadge(
          row.actorType,
        )}`}
      >
        {row.actorType ?? "system"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <div className="truncate text-sm text-text">
            <span className="font-medium">{actionLabel(row.action)}</span>
            <span className="ml-1.5 text-muted">on</span>
            <span className="ml-1.5 font-mono text-[12px] text-muted-strong">
              {row.entityType}
            </span>
          </div>
        </div>
        {hasPayload && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-1 text-[11px] text-muted hover:text-muted-strong"
          >
            {open ? "Hide payload" : "Show payload"}
          </button>
        )}
        {open && hasPayload && (
          <pre className="mt-2 overflow-x-auto rounded-md bg-bg p-2 text-[11px] text-text-secondary">
            {JSON.stringify(row.metadata, null, 2)}
          </pre>
        )}
      </div>
      <span className="shrink-0 text-[11px] text-muted tabular-nums">
        {formatTime(row.createdAt)}
      </span>
    </li>
  );
}
