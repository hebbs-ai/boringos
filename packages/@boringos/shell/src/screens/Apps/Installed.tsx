// SPDX-License-Identifier: BUSL-1.1
//
// Installed tab — lists what's installed for the tenant. The list
// comes from /api/admin/apps (backend, source of truth) plus a merge
// from the client-side InstallRuntime so slot-only contributions
// (rare in practice) don't disappear. The Uninstall button calls the
// K11 admin endpoint and shows a cascade warning when other apps
// depend on the one being removed. Hard mode surfaces a separate
// irreversible-confirm dialog before firing.

import { useEffect, useState } from "react";

import { installRuntime } from "../../runtime/install-runtime.js";
import type { InstalledAppRecord } from "../../runtime/install-runtime.js";
import {
  createInstallApi,
  InstallApiResponseError,
  type InstallApiOptions,
} from "./installApi.js";

/** Shape returned by /api/admin/apps for each row. */
interface ServerInstallRow {
  id?: string;
  app_id: string;
  appId?: string;
  version: string;
  status: string;
  installed_at?: string;
  installedAt?: string;
}

export interface InstalledProps {
  api?: InstallApiOptions;
  onUninstalled?: (appId: string) => void;
}

interface CascadeEntry {
  sourceAppId?: string;
  capability?: string;
}

interface UninstallState {
  appId: string | null;
  busy: boolean;
  cascade: CascadeEntry[];
  /** Non-null when a hard-uninstall confirm is pending. */
  hardConfirmFor: string | null;
  error: string | null;
}

const INITIAL_STATE: UninstallState = {
  appId: null,
  busy: false,
  cascade: [],
  hardConfirmFor: null,
  error: null,
};

export function Installed({ api, onUninstalled }: InstalledProps = {}) {
  const [records, setRecords] = useState<InstalledAppRecord[]>(() =>
    mergeInstalled(installRuntime.list(), []),
  );
  const [state, setState] = useState<UninstallState>(INITIAL_STATE);
  const [loadError, setLoadError] = useState<string | null>(null);

  const installApi = createInstallApi(api);

  // Subscribe to client-side slot updates AND fetch the backend list.
  // Backend is the source of truth; slot runtime is a hint. If the
  // backend fetch fails we surface the error in the UI rather than
  // silently degrade to "no apps installed" — that masks 401s.
  useEffect(() => {
    let cancelled = false;

    async function refresh(): Promise<void> {
      let serverRows: ServerInstallRow[] = [];
      let err: string | null = null;
      try {
        const body = await installApi.list();
        serverRows = (body.apps ?? []) as unknown as ServerInstallRow[];
      } catch (e) {
        if (e instanceof InstallApiResponseError) {
          err = `${e.payload.error}${e.payload.detail ? `: ${e.payload.detail}` : ""} (HTTP ${e.payload.status})`;
        } else {
          err = e instanceof Error ? e.message : String(e);
        }
        console.error("[Installed] /api/admin/apps failed:", e);
      }
      if (cancelled) return;
      setLoadError(err);
      setRecords(mergeInstalled(installRuntime.list(), serverRows));
    }

    void refresh();

    const off = installRuntime.getRegistry().subscribe(() => {
      void refresh();
    });

    return () => {
      cancelled = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => setState(INITIAL_STATE);

  const handleSoftClick = async (appId: string) => {
    setState({ ...INITIAL_STATE, appId, busy: true });
    try {
      const result = await installApi.uninstall(appId, "soft");
      if (!result.uninstalled && Array.isArray(result.cascade) && result.cascade.length > 0) {
        setState({
          appId,
          busy: false,
          cascade: result.cascade as CascadeEntry[],
          hardConfirmFor: null,
          error: null,
        });
      } else {
        onUninstalled?.(appId);
        reset();
      }
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: errorMessage(e) }));
    }
  };

  const handleSoftForce = async () => {
    if (!state.appId) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      await installApi.uninstall(state.appId, "soft", true);
      onUninstalled?.(state.appId);
      reset();
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: errorMessage(e) }));
    }
  };

  const handleHardClick = (appId: string) => {
    setState({ ...INITIAL_STATE, hardConfirmFor: appId });
  };

  const handleHardConfirm = async () => {
    if (!state.hardConfirmFor) return;
    const appId = state.hardConfirmFor;
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const result = await installApi.uninstall(appId, "hard", true);
      if (!result.uninstalled) {
        // Hard with force=true should always succeed when the app is
        // installed; cascade is informational only.
        setState((s) => ({
          ...s,
          busy: false,
          error: "Hard uninstall did not complete; check the server log.",
        }));
        return;
      }
      onUninstalled?.(appId);
      reset();
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: errorMessage(e) }));
    }
  };

  if (loadError) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        <div className="font-medium">Couldn't load installed apps.</div>
        <div className="text-xs mt-1 font-mono">{loadError}</div>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted">No apps installed.</p>
        <p className="text-xs text-muted mt-2">
          Install one from Browse, or paste a GitHub URL in the next tab.
        </p>
      </div>
    );
  }

  return (
    <div>
      {state.error && (
        <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.error}
        </div>
      )}

      {state.appId && state.cascade.length > 0 && (
        <CascadeWarning
          appId={state.appId}
          cascade={state.cascade}
          busy={state.busy}
          onContinue={handleSoftForce}
          onCancel={reset}
        />
      )}

      {state.hardConfirmFor && (
        <HardConfirm
          appId={state.hardConfirmFor}
          busy={state.busy}
          onConfirm={handleHardConfirm}
          onCancel={reset}
        />
      )}

      <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-white">
        {records.map((r) => (
          <li key={r.appId} className="px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-text">{r.appId}</div>
              <div className="text-xs text-muted mt-0.5">
                v{r.version} · installed {r.installedAt.toLocaleDateString()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSoftClick(r.appId)}
                disabled={state.busy && state.appId === r.appId}
                className="text-xs px-2.5 py-1 rounded-md bg-bg-warm text-text-secondary hover:bg-border-subtle disabled:opacity-50"
              >
                {state.busy && state.appId === r.appId ? "Working…" : "Uninstall"}
              </button>
              <button
                type="button"
                onClick={() => handleHardClick(r.appId)}
                className="text-xs px-2.5 py-1 rounded-md text-red-700 border border-red-200 hover:bg-red-50"
                title="Hard uninstall — irreversible"
              >
                Delete data
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Merge the client-side slot install records with the backend's
 * authoritative list. Backend rows win on overlap; client-only rows
 * (slot-installed without a backend tenant_apps entry — rare) are
 * preserved.
 */
function mergeInstalled(
  clientRows: InstalledAppRecord[],
  serverRows: ServerInstallRow[],
): InstalledAppRecord[] {
  const byId = new Map<string, InstalledAppRecord>();
  for (const r of clientRows) byId.set(r.appId, r);
  for (const s of serverRows) {
    const appId = s.app_id ?? s.appId ?? "";
    if (!appId) continue;
    const installedAtRaw = s.installed_at ?? s.installedAt ?? "";
    const installedAt = installedAtRaw ? new Date(installedAtRaw) : new Date();
    byId.set(appId, {
      appId,
      version: s.version,
      installedAt,
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.appId.localeCompare(b.appId));
}

function errorMessage(e: unknown): string {
  if (e instanceof InstallApiResponseError) {
    const detail = e.payload.detail ? `: ${e.payload.detail}` : "";
    return `${e.payload.error}${detail}`;
  }
  return e instanceof Error ? e.message : "Uninstall failed.";
}

function CascadeWarning(props: {
  appId: string;
  cascade: CascadeEntry[];
  busy: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900">
      <div className="font-semibold mb-1">
        Other apps depend on {props.appId}:
      </div>
      <ul className="list-disc list-inside mb-2">
        {props.cascade.map((c, i) => (
          <li key={i}>
            {c.sourceAppId ?? "(unknown)"}
            {c.capability ? ` — ${c.capability}` : ""}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onContinue}
          disabled={props.busy}
          className="text-xs px-2.5 py-1 rounded-md bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {props.busy ? "Working…" : "Continue anyway"}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          disabled={props.busy}
          className="text-xs px-2.5 py-1 rounded-md bg-white border border-amber-300 text-amber-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function HardConfirm(props: {
  appId: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-900">
      <div className="font-semibold mb-1">
        Hard uninstall {props.appId}?
      </div>
      <p className="mb-2">
        This drops the app's tables and deletes its data. <strong>Irreversible.</strong>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onConfirm}
          disabled={props.busy}
          className="text-xs px-2.5 py-1 rounded-md bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
        >
          {props.busy ? "Working…" : "Yes, delete"}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          disabled={props.busy}
          className="text-xs px-2.5 py-1 rounded-md bg-white border border-red-300 text-red-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
