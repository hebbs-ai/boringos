// SPDX-License-Identifier: BUSL-1.1
//
// Settings → Budgets panel.
// Spend overview, budget policies, and incidents.

import { useState } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { useBudgets, useAgents, useCosts } from "@boringos/ui";
import { LoadingState, EmptyState } from "../_shared.js";

const PERIODS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export function BudgetsPanel() {
  const { user } = useAuth();
  const { policies, incidents, isLoading, createBudget, deleteBudget } = useBudgets();
  const { agents } = useAgents();
  const { costs } = useCosts();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    scope: "tenant" as "tenant" | "agent",
    agentId: "",
    period: "monthly" as "daily" | "weekly" | "monthly",
    limitCents: 10000,
    warnThresholdPct: 80,
  });

  if (!user?.role || user.role !== "admin") {
    return (
      <div className="rounded-md bg-accent-tint border border-accent px-4 py-3 text-sm text-accent">
        <div className="font-medium">Admin access required</div>
        <div className="text-xs mt-1">Only admins can manage budgets.</div>
      </div>
    );
  }

  if (isLoading) return <LoadingState />;

  const handleCreate = async () => {
    try {
      setError(null);
      const data: Record<string, unknown> = {
        scope: formData.scope,
        period: formData.period,
        limitCents: formData.limitCents,
        warnThresholdPct: formData.warnThresholdPct,
      };
      if (formData.scope === "agent" && formData.agentId) {
        data.agentId = formData.agentId;
      }
      await createBudget(data);
      setFormData({
        scope: "tenant",
        agentId: "",
        period: "monthly",
        limitCents: 10000,
        warnThresholdPct: 80,
      });
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create budget");
    }
  };

  const handleDelete = async (policyId: string) => {
    if (!window.confirm("Delete this budget policy?")) return;
    try {
      setError(null);
      await deleteBudget(policyId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete budget");
    }
  };

  const totalSpend = costs.reduce((sum: number, cost: any) => sum + (Number(cost.costUsd) || 0), 0);
  const agentSpendMap = new Map<string, number>();
  costs.forEach((cost: any) => {
    if (cost.agentId) {
      agentSpendMap.set(cost.agentId, (agentSpendMap.get(cost.agentId) || 0) + (Number(cost.costUsd) || 0));
    }
  });
  const topAgents = Array.from(agentSpendMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="space-y-6 max-w-5xl">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">Error</div>
          <div className="text-xs mt-1 font-mono">{error}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-accent-tint to-accent-tint border border-accent rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-accent font-medium mb-1">This Month (USD)</div>
          <div className="text-3xl font-bold text-accent">${totalSpend.toFixed(2)}</div>
        </div>
        {topAgents.length > 0 && (
          <div className="bg-gradient-to-br from-bg to-bg-warm border border-border rounded-lg p-4">
            <div className="text-xs uppercase tracking-wide text-muted-strong font-medium mb-2">Top Agent</div>
            <div className="text-sm font-medium text-text">
              {agents.find((a: any) => a.id === topAgents[0][0])?.name || "Unknown"}
            </div>
            <div className="text-lg font-bold text-text-secondary">${topAgents[0][1].toFixed(2)}</div>
          </div>
        )}
      </div>

      {topAgents.length > 1 && (
        <div className="bg-bg border border-border rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-muted-strong font-medium mb-3">Spend by Agent</div>
          <div className="space-y-2">
            {topAgents.map(([agentId, spend]) => {
              const agent = agents.find((a: any) => a.id === agentId);
              const pct = (spend / totalSpend) * 100;
              return (
                <div key={agentId}>
                  <div className="flex justify-between mb-1">
                    <div className="text-sm text-text font-medium">{agent?.name || "Unknown"}</div>
                    <div className="text-sm text-muted-strong">${spend.toFixed(2)}</div>
                  </div>
                  <div className="w-full h-2 bg-border-subtle rounded-full overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center pt-2">
        <div>
          <div className="text-sm font-medium text-text">Budget Policies</div>
          <div className="text-xs text-muted mt-1">Limit spend and receive warnings</div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent transition-colors"
        >
          {showForm ? "Cancel" : "New Policy"}
        </button>
      </div>

      {showForm && (
        <div className="border border-border rounded-lg p-4 bg-bg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Scope</label>
                <select
                  value={formData.scope}
                  onChange={(e) => setFormData({ ...formData, scope: e.target.value as "tenant" | "agent", agentId: "" })}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option value="tenant">Tenant</option>
                  <option value="agent">Agent</option>
                </select>
              </div>

              {formData.scope === "agent" && (
                <div>
                  <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Agent</label>
                  <select
                    value={formData.agentId}
                    onChange={(e) => setFormData({ ...formData, agentId: e.target.value })}
                    className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="">Select an agent</option>
                    {agents.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Period</label>
                <select
                  value={formData.period}
                  onChange={(e) => setFormData({ ...formData, period: e.target.value as "daily" | "weekly" | "monthly" })}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Limit (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.limitCents / 100}
                  onChange={(e) => setFormData({ ...formData, limitCents: Math.round(e.target.valueAsNumber * 100) })}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Warn at ({formData.warnThresholdPct}%)</label>
              <input
                type="range"
                min="10"
                max="100"
                value={formData.warnThresholdPct}
                onChange={(e) => setFormData({ ...formData, warnThresholdPct: parseInt(e.target.value) })}
                className="w-full"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowForm(false)}
                className="px-3 py-1.5 rounded-md border border-border text-text-secondary text-xs font-medium hover:bg-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                disabled={formData.scope === "agent" && !formData.agentId}
              >
                Create Policy
              </button>
            </div>
          </div>
        </div>
      )}

      {policies.length === 0 ? (
        <EmptyState
          title="No budget policies"
          description="Create a policy to limit spend and receive warnings."
        />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Scope</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Period</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Limit</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Warn At</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {policies.map((policy: any) => (
                <tr key={policy.id} className="hover:bg-bg">
                  <td className="px-4 py-3 text-text font-medium">
                    {policy.scope === "tenant" ? "Tenant" : agents.find((a: any) => a.id === policy.agentId)?.name || "Unknown"}
                  </td>
                  <td className="px-4 py-3 text-muted-strong">{policy.period || "monthly"}</td>
                  <td className="px-4 py-3 text-muted-strong font-mono">${((policy.limitCents || 0) / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-strong">{policy.warnThresholdPct || 80}%</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(policy.id)}
                      className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {incidents.length > 0 && (
        <div className="pt-4">
          <div className="text-sm font-medium text-text mb-3">Recent Budget Incidents (Last 50)</div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {incidents.slice(0, 20).map((incident: any) => {
              const isHardStop = incident.type === "hard_stop";
              return (
                <div
                  key={incident.id}
                  className={`border-l-4 pl-3 py-2 ${isHardStop ? "border-red-500 bg-red-50" : "border-amber-500 bg-amber-50"}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className={`text-xs font-medium ${isHardStop ? "text-red-700" : "text-amber-700"}`}>
                        {isHardStop ? "Hard Stop" : "Warning"}
                      </div>
                      <div className="text-xs text-muted-strong mt-0.5">
                        Spent ${((incident.spentCents || 0) / 100).toFixed(2)} of ${((incident.limitCents || 0) / 100).toFixed(2)} limit
                      </div>
                    </div>
                    <div className="text-xs text-muted">{new Date(incident.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
