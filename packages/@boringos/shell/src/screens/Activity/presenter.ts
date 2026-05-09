// SPDX-License-Identifier: BUSL-1.1

import type { ActivityRow } from "@boringos/ui";

// Group rows by calendar day for the feed UI.
export function groupByDay(rows: ActivityRow[]): Array<{ day: string; rows: ActivityRow[] }> {
  const buckets = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const d = r.createdAt.slice(0, 10); // YYYY-MM-DD
    let bucket = buckets.get(d);
    if (!bucket) {
      bucket = [];
      buckets.set(d, bucket);
    }
    bucket.push(r);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, rs]) => ({ day, rows: rs }));
}

export function formatDay(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (iso === today) return "Today";
  const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (iso === yesterdayIso) return "Yesterday";
  // Fall back to short date.
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function actorBadge(actorType: string | null): string {
  switch (actorType) {
    case "user":
      return "bg-accent-tint text-accent";
    case "agent":
      return "bg-violet-100 text-violet-700";
    case "system":
      return "bg-bg-warm text-muted-strong";
    default:
      return "bg-bg text-muted";
  }
}

export function actionLabel(action: string): string {
  // Make snake/dot/colon-cased actions human-ish:
  //   "agent.created" -> "agent created"
  //   "tenant_app:installed" -> "tenant app installed"
  return action.replace(/[._:]+/g, " ");
}

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
