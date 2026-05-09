// SPDX-License-Identifier: BUSL-1.1
//
// Settings → Agents (Operational) panel.
// Global pause toggle + per-agent controls: pause/resume, change model, view runs.

import { useState } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { useAgents, useRuntimes, useSettings, useCosts } from "@boringos/ui";
import { Switch } from "../../components/ui/switch.js";
import { LoadingState, EmptyState } from "../_shared.js";

export function AgentsPanel() {
  const { user } = useAuth();
  const { agents, isLoading: agentsLoading, updateAgent } = useAgents();
  const { runtimes } = useRuntimes();
  const { settings, updateSettings } = useSettings();
  const { costs } = useCosts();
  const [error, setError] = useState<string | null>(null);

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
    if (cost.agent_id) {
      agentSpendMap.set(cost.agent_id, (agentSpendMap.get(cost.agent_id) || 0) + (cost.costUsd || 0));
    }
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
                      {agent.runtimeId && runtimes.find((r: any) => r.id === agent.runtimeId)?.model ? (
                        <span>{String(runtimes.find((r: any) => r.id === agent.runtimeId)?.model)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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
    </div>
  );
}
