// SPDX-License-Identifier: BUSL-1.1
//
// Settings → v2 Tools catalog. Browse every registered tool with
// description, owning module, and idempotency hint.
//
// Data: GET /api/admin/v2/tools

import { useEffect, useState, useMemo } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { LoadingState, EmptyState } from "../_shared.js";

type ToolRow = {
  fullName: string;
  moduleId: string;
  description: string;
  idempotency?: "none" | "key";
  costHint?: "cheap" | "moderate" | "expensive";
};

function authHeaders(token: string | null, tenantId: string | undefined) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

export function V2ToolsPanel() {
  const { user, token } = useAuth();
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!user?.tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/v2/tools", {
          headers: authHeaders(token, user.tenantId),
        });
        if (cancelled) return;
        if (res.status === 404) {
          setTools([]);
          return;
        }
        if (!res.ok) throw new Error(`tools: ${res.status}`);
        const body = (await res.json()) as { tools: ToolRow[] };
        setTools(body.tools);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.tenantId]);

  const filtered = useMemo(() => {
    if (!tools) return [];
    if (!filter.trim()) return tools;
    const q = filter.toLowerCase();
    return tools.filter(
      (t) =>
        t.fullName.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.moduleId.toLowerCase().includes(q),
    );
  }, [tools, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, ToolRow[]>();
    for (const t of filtered) {
      const list = map.get(t.moduleId) ?? [];
      list.push(t);
      map.set(t.moduleId, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (tools === null) return <LoadingState />;
  if (tools.length === 0) {
    return (
      <EmptyState
        title="No tools registered"
        description="No v2 modules are registered with this host."
      />
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-text">Tool catalog</h2>
        <span className="text-xs text-muted">{tools.length} tools</span>
      </div>

      <input
        type="search"
        placeholder="Filter by name, module, or description"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full rounded-md border border-border px-3 py-1.5 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent-tint"
      />

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {grouped.map(([moduleId, entries]) => (
          <div key={moduleId}>
            <div className="text-xs font-medium text-muted mb-1.5">{moduleId}</div>
            <div className="rounded-md border border-border divide-y divide-border-subtle bg-white">
              {entries.map((t) => (
                <div key={t.fullName} className="px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <code className="text-xs text-text">{t.fullName}</code>
                    {t.idempotency === "key" && (
                      <span className="text-[10px] uppercase tracking-wide text-muted bg-bg-warm px-1 py-0.5 rounded">
                        idempotent
                      </span>
                    )}
                    {t.costHint && (
                      <span className="text-[10px] text-muted">{t.costHint}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-strong mt-0.5">{t.description}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
