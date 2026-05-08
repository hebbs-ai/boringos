// SPDX-License-Identifier: BUSL-1.1
//
// Settings → v2 Workflow palette. Shows the block kinds the
// visual editor can offer: 5 control-flow primitives baked into
// the workflow runtime, plus every registered tool.
//
// Phase 7 of task_12 §13b.4 — the visual editor's palette IS the
// tool registry. This panel is the read-only preview; the full
// visual-editor migration comes after this.

import { useEffect, useState } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { LoadingState, EmptyState } from "../_shared.js";

type ToolRow = {
  fullName: string;
  moduleId: string;
  description: string;
};

const CONTROL_FLOW = [
  { kind: "trigger", label: "Trigger", description: "Entry point. Output = the trigger payload." },
  { kind: "condition", label: "Condition", description: "Evaluate field/operator/value; routes to true / false branches." },
  { kind: "for_each", label: "For each", description: "Iterate over an array; dispatches a tool per item." },
  { kind: "delay", label: "Delay", description: "Wait `ms` milliseconds before continuing." },
  { kind: "transform", label: "Transform", description: "Map upstream outputs into a new shape." },
];

function authHeaders(token: string | null, tenantId: string | undefined) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

export function V2WorkflowPalettePanel() {
  const { user, token } = useAuth();
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (tools === null) return <LoadingState />;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-medium text-slate-900">Workflow blocks</h2>
        <p className="text-xs text-slate-500 mt-1">
          The visual editor offers these blocks. Control-flow primitives are
          built into the workflow runtime; tool blocks are sourced from every
          installed module's tool catalog — install a module to add new blocks.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <section>
        <h3 className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">
          Control flow ({CONTROL_FLOW.length})
        </h3>
        <div className="rounded-md border border-slate-200 divide-y divide-slate-100 bg-white">
          {CONTROL_FLOW.map((b) => (
            <div key={b.kind} className="px-4 py-2.5 text-xs">
              <div className="flex items-baseline gap-2">
                <code className="text-slate-900">{b.kind}</code>
                <span className="text-slate-500">— {b.label}</span>
              </div>
              <div className="text-slate-600 mt-0.5">{b.description}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">
          Tool blocks ({tools.length})
        </h3>
        {tools.length === 0 ? (
          <EmptyState
            title="No tool blocks yet"
            description="Install a v2 module from the Modules tab to add tool blocks here."
          />
        ) : (
          <div className="rounded-md border border-slate-200 divide-y divide-slate-100 bg-white">
            {tools.map((t) => (
              <div key={t.fullName} className="px-4 py-2.5 text-xs">
                <div className="flex items-baseline gap-2">
                  <code className="text-slate-900">{t.fullName}</code>
                  <span className="text-slate-500">— {t.moduleId}</span>
                </div>
                <div className="text-slate-600 mt-0.5">{t.description}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
