// SPDX-License-Identifier: BUSL-1.1
//
// Right-rail slide-in panel. Tabs let the operator inspect (Overview,
// Runs) and customise (Instructions, Skills, Hierarchy) a single agent.
// Stays in flow — no route change.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAgent, useAgents, useClient, useSkills } from "@boringos/ui";
import { useQuery } from "@tanstack/react-query";
import { avatarColor, avatarMark, statusPill } from "./presenter.js";
import { OverviewTab } from "./tabs/OverviewTab.js";
import { InstructionsTab } from "./tabs/InstructionsTab.js";
import { SkillsTab } from "./tabs/SkillsTab.js";
import { HierarchyTab } from "./tabs/HierarchyTab.js";
import { RunsTab } from "./tabs/RunsTab.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "instructions", label: "Instructions" },
  { id: "skills", label: "Skills" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "runs", label: "Runs" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function AgentDetailPanel({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const { agent, runs, isUpdating, updateAgent, patchRoutingTags, wakeAgent } =
    useAgent(agentId);
  const { agents } = useAgents();
  const { skills: tenantSkills } = useSkills();
  const client = useClient();

  // Inherited prompt skills come from installed v2 modules (tenant-level).
  // Cached cross-panel so re-opening the rail is instant.
  const modulesQuery = useQuery({
    queryKey: ["v2Modules"],
    queryFn: () => client.getV2Modules(),
    staleTime: 60_000,
  });
  const installsQuery = useQuery({
    queryKey: ["v2Installs"],
    queryFn: () => client.getV2Installs(),
    staleTime: 30_000,
  });

  // Reset to overview when switching between agents.
  useEffect(() => {
    setTab("overview");
  }, [agentId]);

  if (!agent) {
    return (
      <Shell onClose={onClose}>
        <div className="px-6 py-10 text-sm text-muted">Loading agent…</div>
      </Shell>
    );
  }

  const pill = statusPill(agent.status);

  const togglePause = async () => {
    const next = agent.status === "paused" ? "idle" : "paused";
    await updateAgent({ status: next });
  };

  return (
    <Shell onClose={onClose}>
      <header className="border-b border-border-subtle px-6 py-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold ${avatarColor(
              agent.role,
            )}`}
          >
            {avatarMark(agent)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-text">
                {agent.name}
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-medium ${pill.cls}`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                {pill.label}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">
              {agent.title || agent.role}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-bg-warm hover:text-text-secondary"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void wakeAgent(undefined)}
            disabled={agent.status === "paused" || agent.status === "archived"}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            Wake
          </button>
          <button
            type="button"
            onClick={() => void togglePause()}
            disabled={isUpdating}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {agent.status === "paused" ? "Resume" : "Pause"}
          </button>
        </div>
      </header>

      <nav className="flex border-b border-border-subtle px-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
              t.id === tab
                ? "border-accent text-text"
                : "border-transparent text-muted hover:text-text-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === "overview" && (
          <OverviewTab
            agent={agent}
            saving={isUpdating}
            onSaveIcon={async (icon) => {
              await updateAgent({ icon });
            }}
          />
        )}
        {tab === "instructions" && (
          <InstructionsTab
            agent={agent}
            saving={isUpdating}
            onSave={async (instructions) => {
              await updateAgent({ instructions });
            }}
          />
        )}
        {tab === "skills" && (
          <SkillsTab
            agent={agent}
            tenantSkills={tenantSkills}
            modules={modulesQuery.data ?? []}
            installs={installsQuery.data ?? []}
            busy={isUpdating}
            onAdd={async (tag) => {
              await patchRoutingTags({ add: [tag] });
            }}
            onRemove={async (tag) => {
              await patchRoutingTags({ remove: [tag] });
            }}
          />
        )}
        {tab === "hierarchy" && (
          <HierarchyTab
            agent={agent}
            allAgents={agents}
            saving={isUpdating}
            onReparent={async (newParentId) => {
              await updateAgent({ reportsTo: newParentId });
            }}
          />
        )}
        {tab === "runs" && <RunsTab runs={runs} />}
      </div>
    </Shell>
  );
}

function Shell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-30 bg-navy/10"
        onClick={onClose}
        aria-hidden
      />
      <motion.aside
        role="dialog"
        aria-label="Agent detail"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[480px] flex-col border-l border-border bg-bg shadow-xl"
      >
        {children}
      </motion.aside>
    </>
  );
}
