// SPDX-License-Identifier: BUSL-1.1
//
// Home — at-a-glance dashboard. Replaces the CRM's "Brief" page with a
// generic shell version. Reads dashboard.widget contributions from the
// slot registry (per A2 acceptance), so installed apps populate this
// screen with their own tiles.

import { useAgents, useInbox, useTasks } from "@boringos/ui";

import { useAuth } from "../auth/AuthProvider.js";
import { useSlot } from "../slots/context.js";
import { SlotRenderer } from "../slots/SlotRenderer.js";
import { EmptyState, ScreenBody, ScreenHeader } from "./_shared.js";

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-text">{value}</div>
    </div>
  );
}

export function Home() {
  const { user } = useAuth();
  const { tasks } = useTasks();
  const { agents } = useAgents();
  const inbox = useInbox("unread");
  // Approvals are agent_action tasks now — count them from the same
  // tasks list so we don't fan out a second request.
  const pendingApprovals = (tasks ?? []).filter(
    (t) => t.originKind === "agent_action" && t.status !== "done" && t.status !== "cancelled",
  );

  const widgets = useSlot("dashboardWidgets");

  return (
    <>
      <ScreenHeader
        title={`Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        subtitle="At a glance"
      />
      <ScreenBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatTile label="Open tasks" value={tasks?.length ?? 0} />
          <StatTile label="Active agents" value={agents?.length ?? 0} />
          <StatTile label="Unread inbox" value={inbox.data?.length ?? 0} />
          <StatTile label="Pending approvals" value={pendingApprovals.length} />
        </div>

        {widgets.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-text-secondary mb-3">
              From your apps
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <SlotRenderer family="dashboardWidgets" />
            </div>
          </div>
        )}

        {widgets.length === 0 && (
          <div className="mt-8">
            <EmptyState
              title="No app widgets yet"
              description="Install an app from the Apps screen to populate your dashboard."
            />
          </div>
        )}
      </ScreenBody>
    </>
  );
}
