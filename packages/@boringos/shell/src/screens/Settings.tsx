// SPDX-License-Identifier: GPL-3.0-or-later
//
// Settings — General + Branding + per-module panels contributed via
// pluginHost.settingsPanels (gated on useInstalledModules).

import { useState, Suspense } from "react";

import { useInstalledModules } from "@boringos/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { pluginHost } from "../plugin-host/index.js";
import { ScreenBody, ScreenHeader } from "./_shared.js";
import { BrandingPanel } from "./Settings/BrandingPanel.js";
import { BusinessProfilePanel } from "./Settings/BusinessProfilePanel.js";
import { AppearancePanel } from "./Settings/AppearancePanel.js";
import { AgentsPanel } from "./Settings/AgentsPanel.js";
import { ManifestSection } from "./Settings/ManifestSection.js";
import { ToolsPanel } from "./Settings/ToolsPanel.js";
import { ToolCallsPanel } from "./Settings/ToolCallsPanel.js";
import { WorkflowPalettePanel } from "./Settings/WorkflowPalettePanel.js";

type Tab = { id: string; label: string };

export function Settings() {
  const { user } = useAuth();
  const installed = useInstalledModules();
  const isAdmin = user?.role === "admin";

  const pluginPanels = pluginHost.settingsPanels.filter((p) =>
    installed.has(p.moduleId),
  );

  const tabs: Tab[] = [
    { id: "general", label: "General" },
    { id: "business-profile", label: "Business profile" },
    { id: "appearance", label: "Appearance" },
    { id: "branding", label: "Branding" },
    ...(isAdmin
      ? [
          { id: "agents", label: "Agents" },
          { id: "tools", label: "Tool catalog" },
          { id: "tool-calls", label: "Tool calls" },
          { id: "workflow-blocks", label: "Workflow blocks" },
        ]
      : []),
    ...pluginPanels.map((p) => ({
      id: `plugin-${p.moduleId}-${p.id}`,
      label: p.label,
    })),
  ];

  const [active, setActive] = useState<string>("general");
  const activePanel = pluginPanels.find(
    (p) => `plugin-${p.moduleId}-${p.id}` === active,
  );

  return (
    <>
      <ScreenHeader
        title="Settings"
        subtitle="Tenant configuration"
      />
      <div className="flex-1 flex overflow-hidden">
        <nav className="w-56 border-r border-border-subtle px-2 py-4 overflow-y-auto shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`block w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                active === t.id
                  ? "bg-bg-warm text-text font-medium"
                  : "text-muted-strong hover:bg-bg-warm hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <ScreenBody>
          {active === "general" && (
            <div className="space-y-8">
              <div className="max-w-xl space-y-6">
                <Field label="Tenant name" value={user?.tenantName ?? "—"} />
                <Field label="Your role" value={user?.role ?? "—"} />
                <Field label="Email" value={user?.email ?? "—"} />
              </div>
              {isAdmin && <ManifestSection />}
            </div>
          )}

          {active === "business-profile" && <BusinessProfilePanel />}
          {active === "appearance" && <AppearancePanel />}
          {active === "branding" && <BrandingPanel />}
          {active === "agents" && <AgentsPanel />}
          {active === "tools" && <ToolsPanel />}
          {active === "tool-calls" && <ToolCallsPanel />}
          {active === "workflow-blocks" && <WorkflowPalettePanel />}

          {activePanel && (
            <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
              {(() => {
                const Element = activePanel.element as React.ComponentType;
                return <Element />;
              })()}
            </Suspense>
          )}
        </ScreenBody>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-1 text-sm text-text">{value}</div>
    </div>
  );
}
