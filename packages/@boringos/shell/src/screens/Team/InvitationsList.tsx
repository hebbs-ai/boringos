// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";
import type { PendingInvitation } from "@boringos/ui";
import { formatJoined, roleBadge } from "./presenter.js";

export function InvitationsList({
  invitations,
  onRevoke,
  busyId,
}: {
  invitations: PendingInvitation[];
  onRevoke: (id: string) => void;
  busyId: string | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyLink = async (code: string, id: string) => {
    const link = `${window.location.origin}/signup?invite=${code}`;
    await navigator.clipboard.writeText(link);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };

  if (invitations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
        No pending invitations.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-bg text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Email</th>
            <th className="px-4 py-2 text-left font-medium">Role</th>
            <th className="px-4 py-2 text-left font-medium">Expires</th>
            <th className="px-4 py-2 text-right font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {invitations.map((inv) => (
            <tr key={inv.id} className="hover:bg-bg">
              <td className="px-4 py-3 text-text">{inv.email}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${roleBadge(
                    inv.role,
                  )}`}
                >
                  {inv.role}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {formatJoined(inv.expiresAt)}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void copyLink(inv.code, inv.id)}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg"
                  >
                    {copied === inv.id ? "Copied!" : "Copy link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRevoke(inv.id)}
                    disabled={busyId === inv.id}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Revoke
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
