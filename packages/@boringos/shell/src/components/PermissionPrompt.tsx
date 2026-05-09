// SPDX-License-Identifier: BUSL-1.1
//
// PermissionPrompt — canonical install-time consent UI (TASK-C7).
//
// Renders the OAuth-style "this app wants…" panel: requested
// capability scopes grouped by category, publisher trust signal
// (verified / unverified), Approve / Cancel buttons.
//
// Used by both the marketplace install path and the GitHub-direct
// "Install from URL" path. The Approve handler is the caller's job —
// the marketplace path eventually invokes the install pipeline (C5)
// via an admin API; the direct path does the same. The component
// only owns the consent UI.
//
// Replaces A7's local copy at screens/Apps/PermissionPrompt.tsx —
// that file now re-exports this canonical version so existing call
// sites keep working through the rename.

import type { Manifest } from "@boringos/app-sdk";

import { groupCapabilities } from "./capabilityCategories.js";

export interface PermissionPromptProps {
  manifest: Manifest;
  /**
   * Trust source of the manifest:
   *   "marketplace"  — trust publisher.verified
   *   "github-direct" — always show the unverified warning
   */
  source: "marketplace" | "github-direct";
  onApprove: () => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
  /** Optional: error from the install pipeline to surface inline. */
  error?: string;
}

export function PermissionPrompt({
  manifest,
  source,
  onApprove,
  onCancel,
  busy,
  error,
}: PermissionPromptProps) {
  const verified =
    manifest.publisher.verified === true && source === "marketplace";
  const groups = groupCapabilities(manifest.capabilities);

  return (
    <div className="rounded-xl border border-border bg-white p-6 max-w-lg">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text">
            {manifest.name}
          </h3>
          <div className="text-xs text-muted mt-0.5">
            {manifest.publisher.name}
            {verified && (
              <span className="ml-2 text-emerald-700 font-medium">
                verified
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] font-mono text-muted shrink-0">
          v{manifest.version}
        </span>
      </div>

      {!verified && source === "github-direct" && (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Unverified publisher. Install only if you trust this source.
        </div>
      )}

      <p className="text-sm text-muted-strong mb-4">
        This {manifest.kind} requests permission to:
      </p>

      <div className="space-y-3 mb-6 max-h-72 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
              {g.label}
            </div>
            <ul className="space-y-1">
              {g.items.map((cap) => (
                <li
                  key={cap}
                  className="text-xs text-text-secondary font-mono pl-3 border-l-2 border-border-subtle"
                >
                  {cap}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md text-muted-strong hover:bg-bg-warm disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onApprove()}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Installing…" : "Install"}
        </button>
      </div>
    </div>
  );
}
