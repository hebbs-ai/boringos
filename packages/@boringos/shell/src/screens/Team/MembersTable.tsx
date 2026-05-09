// SPDX-License-Identifier: BUSL-1.1

import type { TeamMember } from "@boringos/ui";
import { ROLE_OPTIONS, formatJoined, initials, roleBadge } from "./presenter.js";

export function MembersTable({
  members,
  meId,
  onRoleChange,
  onRemove,
  busyId,
}: {
  members: TeamMember[];
  meId: string | null;
  onRoleChange: (userId: string, role: string) => void;
  onRemove: (userId: string) => void;
  busyId: string | null;
}) {
  if (members.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
        No members yet. Invite someone below.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-bg text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Member</th>
            <th className="px-4 py-2 text-left font-medium">Role</th>
            <th className="px-4 py-2 text-left font-medium">Joined</th>
            <th className="px-4 py-2 text-right font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {members.map((m) => {
            const isMe = m.userId === meId;
            return (
              <tr key={m.userId} className="hover:bg-bg">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-tint text-xs font-semibold text-accent">
                      {initials(m.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-text">
                        {m.name}
                        {isMe && (
                          <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                            you
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {isMe ? (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${roleBadge(
                        m.role,
                      )}`}
                    >
                      {m.role}
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      onChange={(e) => onRoleChange(m.userId, e.target.value)}
                      disabled={busyId === m.userId}
                      className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-tint disabled:opacity-40"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {formatJoined(m.joinedAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  {!isMe && (
                    <button
                      type="button"
                      onClick={() => onRemove(m.userId)}
                      disabled={busyId === m.userId}
                      className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
