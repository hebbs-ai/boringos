// SPDX-License-Identifier: BUSL-1.1

import type { Agent } from "@boringos/ui";
import { Sparkline } from "./Sparkline.js";
import { avatarColor, avatarMark, formatCents, formatRelative, statusPill } from "./presenter.js";

export function AgentCard({
  agent,
  selected,
  onSelect,
  onWake,
  waking,
  bulkChecked,
  bulkVisible,
  onBulkToggle,
  activitySeries,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: () => void;
  onWake: () => void;
  waking: boolean;
  bulkChecked: boolean;
  bulkVisible: boolean;
  onBulkToggle: (e: React.MouseEvent) => void;
  activitySeries: number[];
}) {
  const pill = statusPill(agent.status);
  const role = agent.role || "general";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex w-full flex-col rounded-xl border bg-white p-4 text-left transition hover:border-border hover:shadow-sm ${
        selected ? "border-accent ring-2 ring-accent-tint" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        {bulkVisible && (
          <button
            type="button"
            role="checkbox"
            aria-checked={bulkChecked}
            aria-label={`Select ${agent.name}`}
            onClick={onBulkToggle}
            className={`absolute left-3 top-3 flex h-4 w-4 items-center justify-center rounded border ${
              bulkChecked ? "border-accent bg-accent text-white" : "border-border bg-white"
            }`}
          >
            {bulkChecked && <span className="text-[10px] leading-none">✓</span>}
          </button>
        )}
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold ${avatarColor(
            role,
          )} ${bulkVisible ? "ml-5" : ""}`}
        >
          {avatarMark(agent)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-semibold text-text">{agent.name}</div>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-medium ${pill.cls}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${pill.dot}`} />
              {pill.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {agent.title || role}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-2 text-[11px] text-muted">
        <div className="grid flex-1 grid-cols-2 gap-2">
          <Mini label="Spent (mo)" value={formatCents(agent.spentMonthlyCents ?? 0)} />
          <Mini label="Last seen" value={formatRelative(agent.lastHeartbeatAt)} />
        </div>
        {activitySeries.length > 0 && (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-muted">7d</span>
            <Sparkline series={activitySeries} />
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onWake();
          }}
          disabled={waking || agent.status === "paused" || agent.status === "archived"}
          className="rounded-md bg-accent px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          {waking ? "Waking…" : "Wake"}
        </button>
        <span className="text-[11px] text-muted group-hover:text-muted">
          Click to configure →
        </span>
      </div>
    </button>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-xs font-medium text-text-secondary tabular-nums">{value}</div>
    </div>
  );
}
