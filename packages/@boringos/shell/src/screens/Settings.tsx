// SPDX-License-Identifier: BUSL-1.1
//
// Settings — General + Branding (A9) + per-app panels via
// useSlot("settingsPanels").

import { useState } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import { useSlot } from "../slots/context.js";
import { SlotRenderer } from "../slots/SlotRenderer.js";
import { EmptyState, ScreenBody, ScreenHeader } from "./_shared.js";
import { BrandingPanel } from "./Settings/BrandingPanel.js";
import { AgentsPanel } from "./Settings/AgentsPanel.js";
import { RoutinesPanel } from "./Settings/RoutinesPanel.js";
import { BudgetsPanel } from "./Settings/BudgetsPanel.js";
import { V2ModulesPanel } from "./Settings/V2ModulesPanel.js";
import { V2ToolsPanel } from "./Settings/V2ToolsPanel.js";
import { V2ToolCallsPanel } from "./Settings/V2ToolCallsPanel.js";
import { V2WorkflowPalettePanel } from "./Settings/V2WorkflowPalettePanel.js";

type Tab = { id: string; label: string };

export function Settings() {
  const { user } = useAuth();
  const panels = useSlot("settingsPanels");
  const isAdmin = user?.role === "admin";

  const tabs: Tab[] = [
    { id: "general", label: "General" },
    { id: "branding", label: "Branding" },
    ...(isAdmin
      ? [
          { id: "agents", label: "Agents" },
          { id: "routines", label: "Routines" },
          { id: "budgets", label: "Budgets" },
          { id: "v2-modules", label: "Modules" },
          { id: "v2-tools", label: "Tool catalog" },
          { id: "v2-tool-calls", label: "Tool calls" },
          { id: "v2-workflow-palette", label: "Workflow blocks" },
        ]
      : []),
    ...panels.map((p) => ({
      id: `app-${p.appId}-${p.slotId}`,
      label: p.slot.label,
    })),
  ];

  const [active, setActive] = useState<string>("general");
  const activePanel = panels.find(
    (p) => `app-${p.appId}-${p.slotId}` === active,
  );

  return (
    <>
      <ScreenHeader
        title="Settings"
        subtitle="Tenant configuration"
      />
      <div className="flex-1 flex overflow-hidden">
        <nav className="w-56 border-r border-slate-100 px-2 py-4 overflow-y-auto shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`block w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                active === t.id
                  ? "bg-slate-100 text-slate-900 font-medium"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}

          {panels.length === 0 && (
            <div className="mt-4 px-3 text-[11px] text-slate-400">
              Install apps to add their settings panels here.
            </div>
          )}
        </nav>

        <ScreenBody>
          {active === "general" && (
            <div className="max-w-xl space-y-6">
              <Field label="Tenant name" value={user?.tenantName ?? "—"} />
              <Field label="Your role" value={user?.role ?? "—"} />
              <Field label="Email" value={user?.email ?? "—"} />
            </div>
          )}

          {active === "branding" && <BrandingPanel />}

          {active === "agents" && <AgentsPanel />}

          {active === "routines" && <RoutinesPanel />}

          {active === "budgets" && <BudgetsPanel />}

          {active === "v2-modules" && <V2ModulesPanel />}

          {active === "v2-tools" && <V2ToolsPanel />}

          {active === "v2-tool-calls" && <V2ToolCallsPanel />}

          {active === "v2-workflow-palette" && <V2WorkflowPalettePanel />}

          {activePanel && (
            <SlotRenderer
              family="settingsPanels"
              id={activePanel.slotId}
              appId={activePanel.appId}
              empty={
                <EmptyState
                  title="Panel did not render"
                  description={`The ${activePanel.appId} app contributed this panel but its component did not return any content.`}
                />
              }
            />
          )}
        </ScreenBody>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm text-slate-900">{value}</div>
    </div>
  );
}
