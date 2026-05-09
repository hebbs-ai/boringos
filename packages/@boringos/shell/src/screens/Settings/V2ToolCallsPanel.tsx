// SPDX-License-Identifier: BUSL-1.1
//
// Settings → v2 Tool calls audit log. Latest 100 dispatches for
// the active tenant.
//
// Data: GET /api/admin/v2/tool-calls?tool=<filter>

import { useEffect, useState, useCallback } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { LoadingState, EmptyState } from "../_shared.js";

type CallRow = {
  id: string;
  toolName: string;
  moduleId: string;
  invokedBy: string;
  agentId: string | null;
  runId: string | null;
  taskId: string | null;
  status: string;
  durationMs: number | null;
  startedAt: string;
  endedAt: string | null;
};

function authHeaders(token: string | null, tenantId: string | undefined) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

const STATUS_BADGES: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  error: "bg-amber-50 text-amber-700",
  validation_failed: "bg-amber-50 text-amber-700",
  permission_denied: "bg-red-50 text-red-700",
  not_found: "bg-bg-warm text-text-secondary",
  internal: "bg-red-50 text-red-700",
};

export function V2ToolCallsPanel() {
  const { user, token } = useAuth();
  const [calls, setCalls] = useState<CallRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    if (!user?.tenantId) return;
    setError(null);
    try {
      const url = filter
        ? `/api/admin/v2/tool-calls?tool=${encodeURIComponent(filter)}`
        : "/api/admin/v2/tool-calls";
      const res = await fetch(url, { headers: authHeaders(token, user.tenantId) });
      if (res.status === 404) {
        setCalls([]);
        return;
      }
      if (!res.ok) throw new Error(`tool-calls: ${res.status}`);
      const body = (await res.json()) as { toolCalls: CallRow[] };
      setCalls(body.toolCalls);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [token, user?.tenantId, filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (calls === null) return <LoadingState />;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-text">Tool calls</h2>
        <button
          type="button"
          onClick={refresh}
          className="text-xs text-muted hover:text-text-secondary"
        >
          Refresh
        </button>
      </div>

      <input
        type="search"
        placeholder="Filter by exact tool name (e.g. framework.tasks.create)"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full rounded-md border border-border px-3 py-1.5 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent-tint"
      />

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {calls.length === 0 ? (
        <EmptyState
          title="No tool calls yet"
          description="Audit rows appear here as agents invoke tools."
        />
      ) : (
        <div className="rounded-md border border-border divide-y divide-border-subtle bg-white">
          {calls.map((c) => (
            <div key={c.id} className="px-4 py-2.5 text-xs">
              <div className="flex items-baseline justify-between">
                <code className="text-text">{c.toolName}</code>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                    STATUS_BADGES[c.status] ?? "bg-bg-warm text-muted-strong"
                  }`}
                >
                  {c.status}
                </span>
              </div>
              <div className="mt-1 flex gap-3 text-muted text-[11px]">
                <span>{new Date(c.startedAt).toLocaleString()}</span>
                {typeof c.durationMs === "number" && (
                  <span>{c.durationMs} ms</span>
                )}
                <span>via {c.invokedBy}</span>
                {c.runId && (
                  <span>
                    run <code className="text-muted">{c.runId.slice(0, 8)}</code>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
