// SPDX-License-Identifier: BUSL-1.1
//
// Pure helpers for the Agents screen — colors, initials, status text,
// fleet aggregates. Kept logic-only so they can be unit-tested without
// rendering React.

import type { Agent } from "@boringos/ui";

export interface FleetStats {
  total: number;
  running: number;
  paused: number;
  idle: number;
  spentTodayCents: number;
}

export function fleetStats(agents: Agent[]): FleetStats {
  let running = 0;
  let paused = 0;
  let idle = 0;
  let spent = 0;
  for (const a of agents) {
    if (a.status === "running") running += 1;
    else if (a.status === "paused") paused += 1;
    else if (a.status === "idle") idle += 1;
    spent += a.spentMonthlyCents ?? 0;
  }
  return { total: agents.length, running, paused, idle, spentTodayCents: spent };
}

export function formatCents(cents: number): string {
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  return dollars >= 10 ? `$${dollars.toFixed(0)}` : `$${dollars.toFixed(2)}`;
}

// Role → glyph map. Hand-picked emoji + symbols. Falls back to
// initials in the renderer when no mapping exists. Kept as a single
// table so adding a new built-in role is one line.
const ROLE_ICONS: Record<string, string> = {
  ceo: "♚",
  "chief-of-staff": "✦",
  cos: "✦",
  copilot: "◇",
  triage: "⚐",
  replier: "✉",
  engineer: "⚙",
  cto: "⚒",
  designer: "✎",
  researcher: "⌕",
  pm: "▤",
  qa: "✓",
  finance: "$",
  devops: "⎔",
  "content-creator": "✍",
  "personal-assistant": "★",
  vp: "◆",
  sdr: "↗",
};

export function roleIcon(role: string): string | null {
  return ROLE_ICONS[role.toLowerCase()] ?? null;
}

/**
 * Pick the visual marker for an agent's avatar. If the agent has set
 * a custom `icon` (a single grapheme — emoji, glyph, etc.), use it.
 * Otherwise fall back to the role's hand-picked icon, then to
 * derived initials. The renderer chooses the size; this is just the
 * string.
 */
export function avatarMark(agent: { icon?: string | null; role: string; name: string }): string {
  if (agent.icon && agent.icon.trim().length > 0) return agent.icon.trim();
  return roleIcon(agent.role) ?? initials(agent.name);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Stable role → color map. Hash the role so unknown roles still get a
// deterministic color, while built-in roles get a recognisable one.
const ROLE_PALETTE: Record<string, string> = {
  ceo: "bg-violet-100 text-violet-700",
  "chief-of-staff": "bg-indigo-100 text-indigo-700",
  cos: "bg-indigo-100 text-indigo-700",
  copilot: "bg-accent-tint text-accent",
  triage: "bg-amber-100 text-amber-700",
  replier: "bg-emerald-100 text-emerald-700",
  engineer: "bg-cyan-100 text-cyan-700",
  designer: "bg-pink-100 text-pink-700",
  researcher: "bg-teal-100 text-teal-700",
  pm: "bg-orange-100 text-orange-700",
  qa: "bg-lime-100 text-lime-700",
  finance: "bg-yellow-100 text-yellow-800",
  devops: "bg-border-subtle text-text-secondary",
  "content-creator": "bg-rose-100 text-rose-700",
};
const FALLBACK_PALETTE = [
  "bg-bg-warm text-text-secondary",
  "bg-zinc-100 text-zinc-700",
  "bg-stone-100 text-stone-700",
  "bg-neutral-100 text-neutral-700",
];

export function avatarColor(role: string): string {
  const direct = ROLE_PALETTE[role.toLowerCase()];
  if (direct) return direct;
  let h = 0;
  for (let i = 0; i < role.length; i += 1) h = (h * 31 + role.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length]!;
}

export function statusPill(status: string): { label: string; cls: string; dot: string } {
  switch (status) {
    case "running":
      return {
        label: "Running",
        cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
        dot: "bg-emerald-500 animate-pulse",
      };
    case "paused":
      return {
        label: "Paused",
        cls: "bg-amber-50 text-amber-700 border-amber-200",
        dot: "bg-amber-500",
      };
    case "archived":
      return {
        label: "Archived",
        cls: "bg-bg-warm text-muted border-border",
        dot: "bg-muted",
      };
    case "error":
      return {
        label: "Error",
        cls: "bg-red-50 text-red-700 border-red-200",
        dot: "bg-red-500",
      };
    default:
      return {
        label: "Idle",
        cls: "bg-bg text-muted-strong border-border",
        dot: "bg-muted",
      };
  }
}

/**
 * Turn a sparse `{ 'YYYY-MM-DD': count }` map into an ordered array
 * of run counts for the last `days` days, ending today (UTC). Missing
 * days are zero-filled. Used by the card sparkline.
 */
export function activitySeries(
  byDay: Record<string, number> | undefined,
  days: number,
  now: Date = new Date(),
): number[] {
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push(byDay?.[iso] ?? 0);
  }
  return out;
}

export function formatRelative(iso: string | Date | null): string {
  if (!iso) return "never";
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const delta = Date.now() - t;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}
