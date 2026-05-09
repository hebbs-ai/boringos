// SPDX-License-Identifier: BUSL-1.1
//
// Cabinet-wide stats strip. Pulls from the server-side /agents/stats
// aggregate; falls back to client-computed numbers from the agents
// list if the endpoint isn't reachable (e.g. older host, network
// blip). Refreshes every 5s via useAgentStats().

import type { AgentStats } from "@boringos/ui";
import type { FleetStats } from "./presenter.js";
import { formatCents } from "./presenter.js";

export function FleetHeader({
  stats,
  fallback,
}: {
  stats: AgentStats | null;
  fallback: FleetStats;
}) {
  const source = stats ?? {
    total: fallback.total,
    runningNow: fallback.running,
    pausedNow: fallback.paused,
    idleNow: fallback.idle,
    queueDepth: 0,
    errors24h: 0,
    spentTodayCents: 0,
    spentMonthCents: fallback.spentTodayCents,
  };

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Cabinet" value={source.total} />
      <Stat
        label="Running now"
        value={source.runningNow}
        accent={source.runningNow > 0 ? "emerald" : undefined}
      />
      <Stat
        label="Paused"
        value={source.pausedNow}
        accent={source.pausedNow > 0 ? "amber" : undefined}
      />
      <Stat
        label="Queue"
        value={source.queueDepth}
        accent={source.queueDepth > 0 ? "amber" : undefined}
      />
      <Stat
        label="Errors (24h)"
        value={source.errors24h}
        accent={source.errors24h > 0 ? "red" : undefined}
      />
      <Stat label="Spend (today)" value={formatCents(source.spentTodayCents)} />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "emerald" | "amber" | "red";
}) {
  const accentCls =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
      ? "text-amber-700"
      : accent === "red"
      ? "text-red-700"
      : "text-text";
  return (
    <div className="rounded-lg border border-border bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accentCls}`}>{value}</div>
    </div>
  );
}
