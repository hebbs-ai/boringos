// SPDX-License-Identifier: BUSL-1.1

export const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
  { value: "member", label: "Member" },
] as const;

export type Role = (typeof ROLE_OPTIONS)[number]["value"];

export function roleBadge(role: string): string {
  switch (role) {
    case "admin":
      return "bg-violet-100 text-violet-700";
    case "staff":
      return "bg-accent-tint text-accent";
    default:
      return "bg-bg-warm text-muted-strong";
  }
}

export function formatJoined(iso: string): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
