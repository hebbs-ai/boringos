// SPDX-License-Identifier: BUSL-1.1
//
// Workflows screen — sidebar list + editor. Replaces the textarea-only
// surface with a full visual DAG editor on the v2 block schema.

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { ScreenHeader } from "../_shared.js";
import {
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  listTools,
  listWorkflows,
} from "./api.js";
import { Editor } from "./Editor.js";
import type { ToolRow, WorkflowSummary } from "./types.js";

export function Workflows() {
  const { user, token } = useAuth();
  const auth = useMemo(() => ({ token, tenantId: user?.tenantId }), [token, user?.tenantId]);

  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.tenantId) return;
    try {
      const [wfs, ts] = await Promise.all([listWorkflows(auth), listTools(auth)]);
      setWorkflows(wfs);
      setTools(ts);
      if (!activeId && wfs.length > 0) setActiveId(wfs[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [auth, user?.tenantId, activeId]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId, token]);

  const active = useMemo(
    () => workflows?.find((w) => w.id === activeId) ?? null,
    [workflows, activeId],
  );

  const handleCreate = useCallback(async () => {
    try {
      const wf = await createWorkflow(auth, {
        name: "Untitled workflow",
        blocks: [{ id: "trigger", kind: "trigger" }],
        edges: [],
      });
      setWorkflows((arr) => [...(arr ?? []), wf]);
      setActiveId(wf.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [auth]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this workflow? This can't be undone.")) return;
      try {
        await deleteWorkflow(auth, id);
        setWorkflows((arr) => (arr ?? []).filter((w) => w.id !== id));
        if (activeId === id) setActiveId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [auth, activeId],
  );

  const handleDuplicate = useCallback(
    async (src: WorkflowSummary) => {
      try {
        const copy = await duplicateWorkflow(auth, src);
        setWorkflows((arr) => [...(arr ?? []), copy]);
        setActiveId(copy.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [auth],
  );

  const handleSaved = useCallback((wf: WorkflowSummary) => {
    setWorkflows((arr) => (arr ?? []).map((w) => (w.id === wf.id ? wf : w)));
  }, []);

  // Admin gating moved to <RequireAdmin> wrapper at the routes table
  // (App.tsx). The screen now assumes the user is an admin.

  return (
    <div className="flex-1 flex min-h-0 bg-white">
      {/* Sidebar list */}
      <nav className="w-60 shrink-0 border-r border-border-subtle flex flex-col">
        <div className="px-3 py-2 border-b border-border-subtle">
          <button
            type="button"
            onClick={handleCreate}
            className="w-full px-2 py-1.5 rounded text-[11px] font-medium bg-accent text-white hover:bg-accent-light"
          >
            + New workflow
          </button>
        </div>
        {workflows === null ? (
          <div className="px-3 py-3 text-[11px] text-muted">Loading…</div>
        ) : workflows.length === 0 ? (
          <div className="px-3 py-3 text-[11px] text-muted">
            No workflows yet.
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {workflows.map((wf) => (
              <li key={wf.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setActiveId(wf.id)}
                  className={`w-full text-left px-3 py-1.5 text-[12px] border-l-2 transition-colors ${
                    activeId === wf.id
                      ? "bg-bg-warm text-text font-medium border-accent"
                      : "text-muted-strong hover:bg-bg border-transparent"
                  }`}
                >
                  <div className="truncate">{wf.name || "(untitled)"}</div>
                  <div className="text-[9px] text-muted mt-0.5">
                    {wf.blocks?.length ?? 0} blocks · {wf.status ?? "draft"}
                  </div>
                </button>
                <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleDuplicate(wf)}
                    className="text-[10px] text-muted hover:text-text-secondary px-1"
                    title="Duplicate"
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(wf.id)}
                    className="text-[10px] text-muted hover:text-rose-600 px-1"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </nav>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-h-0">
        {error && (
          <div className="px-5 py-1.5 bg-rose-50 border-b border-rose-200 text-[11px] text-rose-700">
            {error}
          </div>
        )}
        {active ? (
          <Editor key={active.id} auth={auth} workflow={active} tools={tools} onSaved={handleSaved} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-muted">
            {workflows && workflows.length === 0
              ? "Create a workflow to get started."
              : "Select a workflow on the left."}
          </div>
        )}
      </div>
    </div>
  );
}
