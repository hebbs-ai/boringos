// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Settings → Agents (Operational) panel.
// Global pause toggle + per-agent controls: pause/resume, change model, view runs.

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "../../auth/AuthProvider.js";
import { useAgents, useRuntimes, useRuntimeModels, useSettings, useCosts } from "@boringos/ui";
import { Switch } from "../../components/ui/switch.js";
import { LoadingState, EmptyState } from "../_shared.js";
import { ConfirmModelChangeDialog } from "./ConfirmModelChangeDialog.js";

// Per-agent model picker. Options come live from the agent's runtime
// (GET /runtimes/:id/models → the runtime's models[]/listModels()), so the
// list is always correct for whatever runtime backs the agent — claude,
// pi (OpenAI), etc. — instead of a hardcoded set. Picking one sets
// `agents.model`; the engine passes it as the runtime's --model.
function ModelSelect({
  runtimeId,
  runtimeDefaultModel,
  currentModel,
  onChange,
}: {
  runtimeId: string | undefined;
  runtimeDefaultModel: string | undefined;
  currentModel: string | undefined;
  onChange: (model: string) => void;
}) {
  const { data: models } = useRuntimeModels(runtimeId);
  const list = models ?? [];
  const current = currentModel ?? runtimeDefaultModel ?? "";
  const isOverride = !!currentModel;
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
      title={isOverride ? "Per-agent override" : runtimeDefaultModel ? "Inherited from runtime" : "Runtime default"}
    >
      <option value="">— Runtime default —</option>
      {list.map((m) => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
      {current && !list.some((m) => m.id === current) && (
        <option value={current}>{current}</option>
      )}
    </select>
  );
}

function modelLabel(id: string | null | undefined): string {
  if (!id) return "Runtime default";
  const known = CLAUDE_MODELS.find((m) => m.id === id);
  return known?.label ?? id;
}

interface PendingModelChange {
  agentId: string;
  agentName: string;
  newModel: string; // empty string means "Runtime default"
  previousModel: string | null;
}

export function AgentsPanel() {
  const { user } = useAuth();
  const { agents, isLoading: agentsLoading, updateAgent } = useAgents();
  const { runtimes } = useRuntimes();
  const { settings, updateSettings } = useSettings();
  const { costs } = useCosts();
  const [error, setError] = useState<string | null>(null);
  const [pendingModelChange, setPendingModelChange] = useState<PendingModelChange | null>(null);

  if (!user?.role || user.role !== "admin") {
    return (
      <div className="rounded-md bg-accent-tint border border-accent px-4 py-3 text-sm text-accent">
        <div className="font-medium">Admin access required</div>
        <div className="text-xs mt-1">Only admins can manage agents.</div>
      </div>
    );
  }

  if (agentsLoading) return <LoadingState />;
  if (!agents || agents.length === 0) {
    return <EmptyState title="No agents" description="Create your first agent to get started." />;
  }

  const globalPaused = settings?.agents_paused === "true";
  const agentSpendMap = new Map<string, number>();
  costs.forEach((cost: any) => {
    const aid = cost.agent_id ?? cost.agentId;
    if (!aid) return;
    const usd = Number(cost.costUsd ?? cost.cost_usd ?? 0);
    if (!Number.isFinite(usd)) return;
    agentSpendMap.set(aid, (agentSpendMap.get(aid) || 0) + usd);
  });

  const handleGlobalPause = async (paused: boolean) => {
    try {
      setError(null);
      await updateSettings({ agents_paused: paused ? "true" : "false" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update pause state");
    }
  };

  const handleStatusChange = async (agentId: string, newStatus: string) => {
    try {
      setError(null);
      await updateAgent({ agentId, data: { status: newStatus } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update agent");
    }
  };

  // Two-phase model swap: opening this dialog is a no-op until the
  // operator confirms. Confirming calls updateAgent and surfaces the
  // server's `sessionInvalidation` payload through a sonner toast so
  // the operator knows whether any in-flight runs are still on the
  // old model.
  const handleModelChange = (agentId: string, newModel: string) => {
    const agent = agents?.find((a) => a.id === agentId);
    if (!agent) return;
    const previousModel = (agent as { model?: string | null }).model ?? null;
    if ((newModel || null) === (previousModel || null)) return; // no-op
    setError(null);
    setPendingModelChange({
      agentId,
      agentName: agent.name,
      newModel,
      previousModel,
    });
  };

  const commitModelChange = async () => {
    if (!pendingModelChange) return;
    const { agentId, newModel } = pendingModelChange;
    try {
      const updated = (await updateAgent({
        agentId,
        data: { model: newModel || null },
      })) as { sessionInvalidation?: { tasksCleared: number; tasksDeferred: number } };
      const inv = updated?.sessionInvalidation;
      const niceLabel = modelLabel(newModel || null);
      if (inv && inv.tasksDeferred > 0) {
        toast.info(
          `Model updated. ${inv.tasksDeferred} run${inv.tasksDeferred === 1 ? "" : "s"} ` +
            `currently in progress will finish on the old model; subsequent runs use ${niceLabel}.`,
        );
      } else if (inv && inv.tasksCleared > 0) {
        toast.success(
          `Model updated. ${inv.tasksCleared} task session${inv.tasksCleared === 1 ? "" : "s"} ` +
            `reset; next run uses ${niceLabel}.`,
        );
      } else {
        toast.success(`Model updated. Next run uses ${niceLabel}.`);
      }
      setPendingModelChange(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update model";
      setError(msg);
      toast.error(msg);
      setPendingModelChange(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">Error</div>
          <div className="text-xs mt-1 font-mono">{error}</div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium text-text">Global Pause</div>
            <div className="text-xs text-muted mt-1">
              Pausing agents stops new runs from starting. Already-running agents continue.
            </div>
          </div>
          <Switch
            checked={globalPaused}
            onCheckedChange={(v) => handleGlobalPause(!!v)}
            aria-label="Pause all agents globally"
          />
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-text mb-3">Agents</div>
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Status</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Model</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Monthly Spend</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {agents.map((agent) => {
                const statusColor =
                  agent.status === "paused"
                    ? "bg-amber-50 text-amber-700"
                    : agent.status === "running"
                      ? "bg-accent-tint text-accent"
                      : "bg-bg text-text-secondary";

                return (
                  <tr key={agent.id} className="hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-text">{agent.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
                        {agent.status || "idle"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-strong">
                      <ModelSelect
                        runtimeId={agent.runtimeId ?? undefined}
                        runtimeDefaultModel={
                          agent.runtimeId
                            ? (runtimes.find((r: any) => r.id === agent.runtimeId)?.model as string | undefined)
                            : undefined
                        }
                        currentModel={(agent as any).model ?? undefined}
                        onChange={(model) => handleModelChange(agent.id, model)}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-strong">
                      ${(agentSpendMap.get(agent.id) || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {agent.status === "paused" ? (
                          <button
                            onClick={() => handleStatusChange(agent.id, "idle")}
                            className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                          >
                            Resume
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStatusChange(agent.id, "paused")}
                            className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                          >
                            Pause
                          </button>
                        )}
                        <a
                          href={`/agents/${agent.id}/runs`}
                          className="text-xs px-2 py-1 rounded bg-accent-tint text-accent hover:bg-accent-tint transition-colors"
                        >
                          Runs
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pendingModelChange && (
        <ConfirmModelChangeDialog
          agentName={pendingModelChange.agentName}
          newModelLabel={modelLabel(pendingModelChange.newModel || null)}
          previousModelLabel={
            pendingModelChange.previousModel
              ? modelLabel(pendingModelChange.previousModel)
              : null
          }
          onConfirm={commitModelChange}
          onCancel={() => setPendingModelChange(null)}
        />
      )}
    </div>
  );
}
