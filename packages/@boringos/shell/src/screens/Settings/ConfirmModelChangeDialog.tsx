// SPDX-License-Identifier: GPL-3.0-or-later
//
// Confirmation dialog for the per-agent model swap in
// Settings → Agents.
//
// Why this exists: changing `agents.model` does not just update
// a label — the framework also clears `tasks.session_id` for any
// task that was mid-conversation, because Claude Code's
// `--resume <sessionId>` ignores `--model <new>` and keeps the
// original session's model. Clearing session_id is the only way
// to make the next wake actually use the new model.
//
// The dialog tells the operator that explicitly so the in-task
// context loss is a deliberate choice rather than a surprise.

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

export interface ConfirmModelChangeDialogProps {
  /** Display name of the agent being changed (used in copy). */
  agentName: string;
  /** Pretty label of the new model (e.g. "Claude Opus 4.6"). */
  newModelLabel: string;
  /** Pretty label of the previous model, or null when previously unset. */
  previousModelLabel: string | null;
  /** Called when the operator confirms. Errors thrown here surface back to the parent. */
  onConfirm: () => Promise<void>;
  /** Called when the dialog is dismissed without confirming. */
  onCancel: () => void;
}

export function ConfirmModelChangeDialog({
  agentName,
  newModelLabel,
  previousModelLabel,
  onConfirm,
  onCancel,
}: ConfirmModelChangeDialogProps) {
  const [busy, setBusy] = useState(false);

  const headline = previousModelLabel
    ? `Switch ${agentName} from ${previousModelLabel} to ${newModelLabel}?`
    : `Set ${agentName} to ${newModelLabel}?`;

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{headline}</DialogTitle>
          <DialogDescription>
            Switching this agent's model starts a fresh Claude session on the next run.
            Any in-task context from the current session will be lost.
          </DialogDescription>
        </DialogHeader>
        <div className="text-xs text-muted-strong space-y-2">
          <p>
            Tasks currently mid-run keep using the old model until that run completes;
            every wake afterwards uses {newModelLabel}.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? "Updating…" : `Switch to ${newModelLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
