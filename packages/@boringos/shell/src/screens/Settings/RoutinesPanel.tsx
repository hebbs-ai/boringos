// SPDX-License-Identifier: BUSL-1.1
//
// Settings → Routines (Cron) panel.
// List, create, edit, delete, and manually trigger routines.

import { useState } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { useRoutines, useAgents, useWorkflows } from "@boringos/ui";
import { LoadingState, EmptyState } from "../_shared.js";

const CONCURRENCY_POLICIES = [
  { value: "skip_if_active", label: "Skip if running" },
  { value: "coalesce_if_active", label: "Coalesce if running" },
  { value: "allow_concurrent", label: "Allow concurrent" },
];

const PERIODS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export function RoutinesPanel() {
  const { user } = useAuth();
  const { routines, isLoading: routinesLoading, createRoutine, updateRoutine, deleteRoutine, triggerRoutine } =
    useRoutines();
  const { agents } = useAgents();
  const { workflows } = useWorkflows();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    targetType: "agent" as "agent" | "workflow",
    targetId: "",
    cronExpression: "0 */6 * * *",
    timezone: "UTC",
    concurrencyPolicy: "skip_if_active",
  });

  if (!user?.role || user.role !== "admin") {
    return (
      <div className="rounded-md bg-accent-tint border border-accent px-4 py-3 text-sm text-accent">
        <div className="font-medium">Admin access required</div>
        <div className="text-xs mt-1">Only admins can manage routines.</div>
      </div>
    );
  }

  if (routinesLoading) return <LoadingState />;

  const handleCreate = async () => {
    try {
      setError(null);
      const target = formData.targetType === "agent" ? { assigneeAgentId: formData.targetId } : { workflowId: formData.targetId };
      await createRoutine({
        title: formData.title,
        cronExpression: formData.cronExpression,
        timezone: formData.timezone,
        concurrencyPolicy: formData.concurrencyPolicy,
        ...target,
      });
      setFormData({
        title: "",
        targetType: "agent",
        targetId: "",
        cronExpression: "0 */6 * * *",
        timezone: "UTC",
        concurrencyPolicy: "skip_if_active",
      });
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create routine");
    }
  };

  const handleTrigger = async (routineId: string) => {
    try {
      setError(null);
      await triggerRoutine(routineId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger routine");
    }
  };

  const handleDelete = async (routineId: string) => {
    if (!window.confirm("Are you sure you want to delete this routine?")) return;
    try {
      setError(null);
      await deleteRoutine(routineId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete routine");
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

      <div className="flex justify-between items-center">
        <div>
          <div className="text-sm font-medium text-text">Routines</div>
          <div className="text-xs text-muted mt-1">Automated schedules for agents and workflows</div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent transition-colors"
        >
          {showForm ? "Cancel" : "New Routine"}
        </button>
      </div>

      {showForm && (
        <div className="border border-border rounded-lg p-4 bg-bg">
          <div className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Gmail sync"
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Target Type</label>
                <select
                  value={formData.targetType}
                  onChange={(e) => setFormData({ ...formData, targetType: e.target.value as "agent" | "workflow", targetId: "" })}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option value="agent">Agent</option>
                  <option value="workflow">Workflow</option>
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">
                  {formData.targetType === "agent" ? "Agent" : "Workflow"}
                </label>
                <select
                  value={formData.targetId}
                  onChange={(e) => setFormData({ ...formData, targetId: e.target.value })}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option value="">Select {formData.targetType === "agent" ? "an agent" : "a workflow"}</option>
                  {formData.targetType === "agent"
                    ? agents.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))
                    : workflows.map((w: any) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Cron Expression</label>
                <input
                  type="text"
                  value={formData.cronExpression}
                  onChange={(e) => setFormData({ ...formData, cronExpression: e.target.value })}
                  placeholder="0 */6 * * *"
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Timezone</label>
                <select
                  value={formData.timezone}
                  onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option>UTC</option>
                  <option>America/New_York</option>
                  <option>America/Los_Angeles</option>
                  <option>Europe/London</option>
                  <option>Europe/Paris</option>
                  <option>Asia/Tokyo</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-strong mb-1">Concurrency Policy</label>
              <select
                value={formData.concurrencyPolicy}
                onChange={(e) => setFormData({ ...formData, concurrencyPolicy: e.target.value })}
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {CONCURRENCY_POLICIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
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
                disabled={!formData.title || !formData.targetId}
              >
                Create Routine
              </button>
            </div>
          </div>
        </div>
      )}

      {routines.length === 0 ? (
        <EmptyState
          title="No routines"
          description="Create a routine to automatically run agents or workflows on a schedule."
        />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Title</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Target</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Schedule</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Status</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-strong uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {routines.map((routine: any) => {
                const targetName = routine.assigneeAgentId
                  ? agents.find((a: any) => a.id === routine.assigneeAgentId)?.name || "Unknown"
                  : workflows.find((w: any) => w.id === routine.workflowId)?.name || "Unknown";

                return (
                  <tr key={routine.id} className="hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-text">{routine.title}</td>
                    <td className="px-4 py-3 text-muted-strong text-xs">{String(targetName)}</td>
                    <td className="px-4 py-3 text-muted-strong text-xs font-mono">{routine.cronExpression}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          routine.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-bg text-text-secondary"
                        }`}
                      >
                        {routine.status || "active"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleTrigger(routine.id)}
                          className="text-xs px-2 py-1 rounded bg-accent-tint text-accent hover:bg-accent-tint transition-colors"
                        >
                          Run Now
                        </button>
                        <button
                          onClick={() => handleDelete(routine.id)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
