// SPDX-License-Identifier: BUSL-1.1
//
// Activity — chronological feed of activity_log rows. Filters work
// client-side on the most-recent N rows fetched from the admin API
// (server-side filters not yet wired). Polls every 10s so the feed
// stays current without an SSE subscription.

import { useMemo, useState } from "react";
import { useActivity } from "@boringos/ui";

import { EmptyState, LoadingState, ScreenBody, ScreenHeader } from "../_shared.js";
import { ActivityRow } from "./ActivityRow.js";
import { formatDay, groupByDay, uniq } from "./presenter.js";

export function Activity() {
  const { rows, isLoading } = useActivity({ limit: 200 });

  const [actorFilter, setActorFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");

  const actorOptions = useMemo(
    () => uniq(rows.map((r) => r.actorType ?? "system")),
    [rows],
  );
  const entityOptions = useMemo(
    () => uniq(rows.map((r) => r.entityType)),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (actorFilter !== "all" && (r.actorType ?? "system") !== actorFilter) return false;
        if (entityFilter !== "all" && r.entityType !== entityFilter) return false;
        return true;
      }),
    [rows, actorFilter, entityFilter],
  );

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <>
      <ScreenHeader
        title="Activity"
        subtitle="What happened across this tenant. Polled live."
      />
      <ScreenBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Actor"
            value={actorFilter}
            options={[{ value: "all", label: "Anyone" }, ...actorOptions.map((a) => ({ value: a, label: a }))]}
            onChange={setActorFilter}
          />
          <FilterSelect
            label="Entity"
            value={entityFilter}
            options={[{ value: "all", label: "Anything" }, ...entityOptions.map((e) => ({ value: e, label: e }))]}
            onChange={setEntityFilter}
          />
          <span className="ml-auto text-[11px] text-muted tabular-nums">
            {filtered.length} of {rows.length}
          </span>
        </div>

        {isLoading ? (
          <LoadingState />
        ) : grouped.length === 0 ? (
          <EmptyState
            title="Quiet so far"
            description="Activity will show up here as soon as agents run, tasks change, or anyone in the team takes an action."
          />
        ) : (
          <div className="space-y-6">
            {grouped.map(({ day, rows: dayRows }) => (
              <section key={day}>
                <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">
                  {formatDay(day)}{" "}
                  <span className="ml-1 font-normal normal-case text-muted">
                    ({dayRows.length})
                  </span>
                </div>
                <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-white">
                  {dayRows.map((r) => (
                    <ActivityRow key={r.id} row={r} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </ScreenBody>
    </>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="uppercase tracking-wide text-[10px]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
