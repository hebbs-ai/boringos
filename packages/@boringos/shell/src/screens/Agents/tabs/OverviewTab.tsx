// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useState } from "react";
import type { Agent } from "@boringos/ui";
import { avatarColor, avatarMark, formatCents, formatRelative, roleIcon, statusPill } from "../presenter.js";

export function OverviewTab({
  agent,
  onSaveIcon,
  saving,
}: {
  agent: Agent;
  onSaveIcon?: (icon: string | null) => Promise<void>;
  saving?: boolean;
}) {
  const pill = statusPill(agent.status);
  return (
    <div className="space-y-4 text-sm">
      {onSaveIcon && (
        <Row label="Icon">
          <IconEditor agent={agent} onSave={onSaveIcon} saving={!!saving} />
        </Row>
      )}
      <Row label="Status">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px] font-medium ${pill.cls}`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${pill.dot}`} />
          {pill.label}
        </span>
        {agent.pauseReason && (
          <span className="ml-2 text-xs text-amber-700">— {agent.pauseReason}</span>
        )}
      </Row>
      <Row label="Role">
        <span className="text-text">{agent.role}</span>
      </Row>
      {agent.title && (
        <Row label="Title">
          <span className="text-text">{agent.title}</span>
        </Row>
      )}
      <Row label="Runtime">
        <span className="font-mono text-xs text-text-secondary">
          {agent.runtimeId ?? "(default)"}
        </span>
      </Row>
      {agent.fallbackRuntimeId && (
        <Row label="Fallback runtime">
          <span className="font-mono text-xs text-text-secondary">{agent.fallbackRuntimeId}</span>
        </Row>
      )}
      <Row label="Last seen">
        <span className="text-text">{formatRelative(agent.lastHeartbeatAt)}</span>
      </Row>
      <Row label="Spent (this month)">
        <span className="text-text tabular-nums">
          {formatCents(agent.spentMonthlyCents ?? 0)}
          {agent.budgetMonthlyCents > 0 && (
            <span className="ml-1 text-muted">
              / {formatCents(agent.budgetMonthlyCents)}
            </span>
          )}
        </span>
      </Row>
      {agent.budgetMonthlyCents > 0 && (
        <BudgetGauge
          spent={agent.spentMonthlyCents ?? 0}
          budget={agent.budgetMonthlyCents}
        />
      )}
    </div>
  );
}

function IconEditor({
  agent,
  onSave,
  saving,
}: {
  agent: Agent;
  onSave: (icon: string | null) => Promise<void>;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(agent.icon ?? "");
  useEffect(() => {
    setDraft(agent.icon ?? "");
  }, [agent.id, agent.icon]);
  const dirty = (agent.icon ?? "") !== draft;
  const inheritedFromRole = roleIcon(agent.role);
  const previewMark = draft.trim().length > 0
    ? draft.trim()
    : avatarMark({ ...agent, icon: null });

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold ${avatarColor(
          agent.role,
        )}`}
      >
        {previewMark}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={4}
        placeholder={inheritedFromRole ?? "(initials)"}
        className="w-24 rounded-md border border-border bg-white px-2 py-1 text-center text-base text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-tint"
      />
      <button
        type="button"
        onClick={() => void onSave(draft.trim() === "" ? null : draft.trim())}
        disabled={!dirty || saving}
        className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {agent.icon && (
        <button
          type="button"
          onClick={() => void onSave(null)}
          disabled={saving}
          className="text-[11px] text-muted hover:text-text"
        >
          Reset to role default
        </button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="w-36 shrink-0 text-[11px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function BudgetGauge({ spent, budget }: { spent: number; budget: number }) {
  const pct = Math.min(100, Math.round((spent / budget) * 100));
  const bar =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-warm">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-right text-[10px] text-muted tabular-nums">{pct}%</div>
    </div>
  );
}
