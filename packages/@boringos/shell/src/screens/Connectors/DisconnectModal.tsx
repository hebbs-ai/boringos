// SPDX-License-Identifier: BUSL-1.1
//
// Disconnect confirmation modal (N6). Tells the user what will happen
// — credentials revoked, sync workflows paused (not deleted) — before
// they tear down the connection.

import { useEffect } from "react";
import type { ConnectorViewModel } from "./connectorsPresenter.js";

export interface DisconnectModalProps {
  vm: ConnectorViewModel;
  onConfirm: (kind: string) => void;
  onCancel: () => void;
}

export function DisconnectModal({
  vm,
  onConfirm,
  onCancel,
}: DisconnectModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      data-testid="disconnect-connector-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-accent/40 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-text">
            Disconnect {vm.name}?
          </h2>
        </div>

        <div className="px-5 py-4 space-y-2 text-sm text-text-secondary">
          <p>This will:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-strong">
            <li>
              Remove stored access tokens for this tenant
            </li>
            <li>
              Pause any sync workflows {vm.name} installed (your data
              stays — reconnect resumes them)
            </li>
            <li>
              Stop new events from {vm.name} reaching your inbox until
              you reconnect
            </li>
          </ul>
        </div>

        <div className="px-5 pb-5 pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium px-3 py-1.5 rounded-md text-muted-strong hover:bg-bg-warm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(vm.kind)}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700"
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
