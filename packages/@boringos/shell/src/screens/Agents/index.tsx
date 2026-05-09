// SPDX-License-Identifier: BUSL-1.1
//
// Agents — "the cabinet". Cards-grid by default with a toggle to an
// org-chart view. Clicking any agent (in either view) opens the
// right-rail detail panel where the operator edits instructions,
// skills, hierarchy etc.

import { useEffect, useState } from "react";
import { useAgents, useAgentActivity, useAgentStats, useClient, useOrgTree } from "@boringos/ui";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../auth/AuthProvider.js";
import { EmptyState, LoadingState, ScreenBody, ScreenHeader } from "../_shared.js";
import { AgentDetailPanel } from "./AgentDetailPanel.js";
import { AgentGrid } from "./AgentGrid.js";
import { BulkActionBar } from "./BulkActionBar.js";
import { FleetHeader } from "./FleetHeader.js";
import { NewAgentModal } from "./NewAgentModal.js";
import { OrgChart } from "./OrgChart.js";
import { fleetStats } from "./presenter.js";

type ViewMode = "grid" | "org";

export function Agents() {
  const { agents, isLoading, wakeAgent, updateAgent } = useAgents();
  const { tree } = useOrgTree();
  const { stats } = useAgentStats();
  const { activity, days: activityDays } = useAgentActivity("7d");
  const client = useClient();
  const queryClient = useQueryClient();

  // SSE-driven invalidation. Backend emits agent:created /
  // agent:updated / agent:reparented and run:* events on the
  // realtime bus; refetch the cabinet whenever something interesting
  // happens. The 5/10s polling stays as a safety net but loses its
  // role as the primary trigger.
  useEffect(() => {
    const sub = (client as { subscribe?: (cb: (e: { type: string }) => void) => () => void }).subscribe;
    if (typeof sub !== "function") return;
    const off = sub((event) => {
      if (
        event.type.startsWith("agent:") ||
        event.type.startsWith("run:") ||
        event.type === "agent:reparented"
      ) {
        queryClient.invalidateQueries({ queryKey: ["agents"] });
        queryClient.invalidateQueries({ queryKey: ["orgTree"] });
        queryClient.invalidateQueries({ queryKey: ["agentStats"] });
      }
    });
    return () => {
      try { off?.(); } catch { /* ignore */ }
    };
  }, [client, queryClient]);

  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [view, setView] = useState<ViewMode>("grid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wakingId, setWakingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkSet, setBulkSet] = useState<Set<string>>(new Set());
  const [bulkAnchor, setBulkAnchor] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleBulkToggle = (agentId: string, e: React.MouseEvent) => {
    setBulkSet((prev) => {
      const next = new Set(prev);
      // Shift-click selects a range from the anchor.
      if (e.shiftKey && bulkAnchor && agents) {
        const ids = agents.map((a) => a.id);
        const a = ids.indexOf(bulkAnchor);
        const b = ids.indexOf(agentId);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i += 1) next.add(ids[i]!);
          return next;
        }
      }
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
    setBulkAnchor(agentId);
  };

  const fanOut = async (action: (id: string) => Promise<unknown>) => {
    setBulkBusy(true);
    try {
      const ids = [...bulkSet];
      // Run in small parallel batches so we don't slam the API.
      const BATCH = 5;
      for (let i = 0; i < ids.length; i += BATCH) {
        await Promise.all(ids.slice(i, i + BATCH).map((id) => action(id).catch(() => undefined)));
      }
      setBulkSet(new Set());
      setBulkAnchor(null);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkWake = () => fanOut((id) => wakeAgent({ agentId: id }));
  const bulkPause = () => fanOut((id) => updateAgent({ agentId: id, data: { status: "paused" } }));
  const bulkResume = () => fanOut((id) => updateAgent({ agentId: id, data: { status: "idle" } }));

  const handleWake = async (agentId: string) => {
    setWakingId(agentId);
    try {
      await wakeAgent({ agentId });
    } finally {
      setWakingId(null);
    }
  };

  const fallback = fleetStats(agents ?? []);

  return (
    <>
      <ScreenHeader
        title="Cabinet"
        subtitle="The agents who work for you, your team, and your tenant."
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            {isAdmin && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-light"
              >
                + New
              </button>
            )}
          </div>
        }
      />
      <ScreenBody>
        {isLoading ? (
          <LoadingState />
        ) : !agents || agents.length === 0 ? (
          <EmptyState
            title="No agents yet"
            description="Install an app to seed agents, or create one from the API. The framework ships 12 personas and 6 runtime adapters."
          />
        ) : (
          <>
            <FleetHeader stats={stats} fallback={fallback} />
            {view === "grid" ? (
              <AgentGrid
                agents={agents}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onWake={handleWake}
                wakingId={wakingId}
                bulkSet={bulkSet}
                bulkVisible={isAdmin}
                onBulkToggle={handleBulkToggle}
                activity={activity}
                activityDays={activityDays}
              />
            ) : (
              <OrgChart
                tree={tree}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </>
        )}
      </ScreenBody>
      {selectedId && (
        <AgentDetailPanel agentId={selectedId} onClose={() => setSelectedId(null)} />
      )}
      {bulkSet.size > 0 && (
        <BulkActionBar
          count={bulkSet.size}
          onWake={() => void bulkWake()}
          onPause={() => void bulkPause()}
          onResume={() => void bulkResume()}
          onClear={() => {
            setBulkSet(new Set());
            setBulkAnchor(null);
          }}
          busy={bulkBusy}
        />
      )}
      {createOpen && (
        <NewAgentModal
          agents={agents ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={(agentId) => {
            setCreateOpen(false);
            setSelectedId(agentId);
          }}
        />
      )}
    </>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const baseCls =
    "px-3 py-1.5 text-xs font-medium transition border-y border-border first:border-l first:rounded-l-md last:border-r last:rounded-r-md";
  return (
    <div className="flex">
      <button
        type="button"
        onClick={() => onChange("grid")}
        className={`${baseCls} ${
          value === "grid"
            ? "bg-accent text-white border-accent"
            : "bg-white text-text-secondary hover:bg-bg"
        }`}
      >
        Cards
      </button>
      <button
        type="button"
        onClick={() => onChange("org")}
        className={`${baseCls} ${
          value === "org"
            ? "bg-accent text-white border-accent"
            : "bg-white text-text-secondary hover:bg-bg"
        }`}
      >
        Org chart
      </button>
    </div>
  );
}
