// SPDX-License-Identifier: BUSL-1.1
//
// Updates tab — placeholder. Real update detection lives in the
// marketplace + control plane (Phase 4). For v1 this is an explanatory
// empty state.

export function Updates() {
  return (
    <div className="text-center py-12">
      <p className="text-sm text-muted">No updates available.</p>
      <p className="text-xs text-muted mt-2 max-w-sm mx-auto">
        Auto-update polling lands with the marketplace backend (Phase 4).
        Until then, re-paste an app's GitHub URL to install a newer version.
      </p>
    </div>
  );
}
