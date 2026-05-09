// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";

import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { ROLE_OPTIONS } from "./presenter.js";

export function InviteModal({
  onClose,
  onInvite,
  busy,
}: {
  onClose: () => void;
  onInvite: (data: { email: string; role: string }) => Promise<{
    code: string;
    inviteLink: string;
  }>;
  busy: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [result, setResult] = useState<{ code: string; inviteLink: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.includes("@")) {
      setError("Enter a valid email");
      return;
    }
    try {
      const r = await onInvite({ email: email.trim().toLowerCase(), role });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const link = result
    ? `${window.location.origin}${result.inviteLink}`
    : null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They’ll get a one‑time invite code. Send it to them via your usual channel.
          </DialogDescription>
        </DialogHeader>

        {result && link ? (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Invitation created. Share this link:
            </div>
            <div className="flex gap-2">
              <input
                readOnly
                value={link}
                className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-text"
              />
              <Button onClick={() => void navigator.clipboard.writeText(link)}>Copy</Button>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-muted">
                Email
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                placeholder="alice@example.com"
                autoFocus
                className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-tint"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-muted">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button
                onClick={() => void submit()}
                disabled={busy || email.trim().length === 0}
              >
                {busy ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
