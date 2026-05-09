// SPDX-License-Identifier: BUSL-1.1

import type { Agent } from "@boringos/ui";
import { AgentCard } from "./AgentCard.js";
import { activitySeries } from "./presenter.js";

export function AgentGrid({
  agents,
  selectedId,
  onSelect,
  onWake,
  wakingId,
  bulkSet,
  bulkVisible,
  onBulkToggle,
  activity,
  activityDays,
}: {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
  onWake: (agentId: string) => void;
  wakingId: string | null;
  bulkSet: Set<string>;
  bulkVisible: boolean;
  onBulkToggle: (agentId: string, e: React.MouseEvent) => void;
  activity: Record<string, Record<string, number>>;
  activityDays: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          selected={agent.id === selectedId}
          onSelect={() => onSelect(agent.id)}
          onWake={() => onWake(agent.id)}
          waking={wakingId === agent.id}
          bulkChecked={bulkSet.has(agent.id)}
          bulkVisible={bulkVisible}
          onBulkToggle={(e) => onBulkToggle(agent.id, e)}
          activitySeries={activitySeries(activity[agent.id], activityDays)}
        />
      ))}
    </div>
  );
}
