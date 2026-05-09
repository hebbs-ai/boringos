// SPDX-License-Identifier: BUSL-1.1

import { useMemo, useState } from "react";
import type { Agent } from "@boringos/ui";
import { avatarColor, avatarMark } from "../presenter.js";
import { Button } from "../../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";

export function HierarchyTab({
  agent,
  allAgents,
  onReparent,
  saving,
}: {
  agent: Agent;
  allAgents: Agent[];
  onReparent: (newParentId: string | null) => Promise<void>;
  saving: boolean;
}) {
  const byId = useMemo(() => new Map(allAgents.map((a) => [a.id, a])), [allAgents]);
  const reports = allAgents.filter((a) => a.reportsTo === agent.id);
  const manager = agent.reportsTo ? byId.get(agent.reportsTo) : null;

  // Reparent dropdown — exclude self + descendants to prevent cycles
  // (backend also enforces; this keeps the dropdown honest).
  const descendantIds = useMemo(() => {
    const out = new Set<string>([agent.id]);
    let frontier = [agent.id];
    while (frontier.length) {
      const next: string[] = [];
      for (const a of allAgents) {
        if (a.reportsTo && frontier.includes(a.reportsTo) && !out.has(a.id)) {
          out.add(a.id);
          next.push(a.id);
        }
      }
      frontier = next;
    }
    return out;
  }, [agent.id, allAgents]);

  const reparentOptions = allAgents.filter((a) => !descendantIds.has(a.id));

  const [pending, setPending] = useState<string | null>(agent.reportsTo ?? null);
  const dirty = pending !== (agent.reportsTo ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const newManager = pending ? byId.get(pending) ?? null : null;
  const cascadeReports = reports; // moving the agent moves their reports' boss path implicitly

  const onSave = async () => {
    // If the agent has direct reports, prompt — moving the agent
    // visually re-roots the whole subtree under the new manager.
    // No reports → save immediately.
    if (cascadeReports.length > 0) {
      setConfirmOpen(true);
      return;
    }
    await onReparent(pending);
  };

  const confirm = async () => {
    setConfirmOpen(false);
    await onReparent(pending);
  };

  return (
    <div className="space-y-5 text-sm">
      <section>
        <div className="text-[11px] uppercase tracking-wide text-muted">Reports to</div>
        {manager ? (
          <AgentRow agent={manager} />
        ) : (
          <div className="mt-2 text-xs italic text-muted">
            Top of the cabinet (no manager).
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <select
            value={pending ?? ""}
            onChange={(e) => setPending(e.target.value || null)}
            className="flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-text"
          >
            <option value="">— Top of cabinet —</option>
            {reparentOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.role}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!dirty || saving}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Reparent"}
          </button>
        </div>
      </section>

      {confirmOpen && (
        <ReparentConfirm
          agent={agent}
          newManager={newManager}
          cascadeReports={cascadeReports}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void confirm()}
          saving={saving}
        />
      )}

      <section>
        <div className="text-[11px] uppercase tracking-wide text-muted">
          Direct reports{reports.length ? ` (${reports.length})` : ""}
        </div>
        {reports.length === 0 ? (
          <div className="mt-2 text-xs italic text-muted">No direct reports.</div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {reports.map((r) => (
              <li key={r.id}>
                <AgentRow agent={r} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReparentConfirm({
  agent,
  newManager,
  cascadeReports,
  onCancel,
  onConfirm,
  saving,
}: {
  agent: Agent;
  newManager: Agent | null;
  cascadeReports: Agent[];
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {agent.name}?</DialogTitle>
          <DialogDescription>
            {agent.name} has {cascadeReports.length} direct report
            {cascadeReports.length === 1 ? "" : "s"}. Reparenting will move the
            whole subtree under{" "}
            {newManager ? (
              <span className="font-medium text-text">{newManager.name}</span>
            ) : (
              <span className="font-medium text-text">the top of the cabinet</span>
            )}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-bg">
          <ul className="divide-y divide-border-subtle">
            {cascadeReports.map((r) => (
              <li key={r.id} className="px-3 py-1.5 text-xs text-text-secondary">
                {r.name} <span className="text-muted">· {r.role}</span>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={onConfirm} disabled={saving}>
            {saving ? "Moving…" : "Move subtree"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  return (
    <div className="mt-2 flex items-center gap-3 rounded-md border border-border bg-white px-3 py-2">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarColor(
          agent.role,
        )}`}
      >
        {avatarMark(agent)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-text">{agent.name}</div>
        <div className="truncate text-[11px] text-muted">{agent.role}</div>
      </div>
    </div>
  );
}
