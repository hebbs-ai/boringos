// SPDX-License-Identifier: BUSL-1.1
//
// Fork-from-step modal — used by the run drawer's "Replay from this
// step" affordance. Lets the user edit the resolved inputs of a
// past block-run before re-dispatching.

import { useState } from "react";

import type { BlockRun } from "./types.js";

export interface ForkModalProps {
  open: boolean;
  blockRun: BlockRun | null;
  onClose: () => void;
  onConfirm: (editedInputs: Record<string, unknown>) => Promise<void>;
}

export function ForkModal({ open, blockRun, onClose, onConfirm }: ForkModalProps) {
  const initialInputs =
    (blockRun?.resolvedConfig as { inputs?: Record<string, unknown> } | undefined)?.inputs ??
    blockRun?.resolvedConfig ??
    {};
  const [text, setText] = useState(() => JSON.stringify(initialInputs, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open || !blockRun) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-accent/30 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div className="w-[560px] max-w-[90vw] bg-white rounded-lg border border-border shadow-2xl">
        <header className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">
            Fork from step
          </span>
          <code className="font-mono text-[11px] text-text-secondary ml-2">{blockRun.blockId}</code>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-muted hover:text-text-secondary text-sm"
          >
            ×
          </button>
        </header>
        <div className="px-4 py-3">
          <p className="text-[11px] text-muted leading-relaxed mb-2">
            Upstream block outputs from the original run will be reused. The
            inputs below replace the resolved inputs for this step. Downstream
            steps re-execute from here.
          </p>
          <textarea
            rows={14}
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              try {
                JSON.parse(e.target.value);
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
            className={`w-full rounded border px-3 py-2 text-[12px] font-mono focus:outline-none focus:border-accent ${
              error ? "border-rose-300 bg-rose-50" : "border-border"
            }`}
          />
          {error && (
            <div className="mt-2 text-[11px] text-rose-600">{error}</div>
          )}
        </div>
        <footer className="px-4 py-3 border-t border-border-subtle flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] px-3 py-1 rounded border border-border text-muted-strong hover:bg-bg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !!error}
            onClick={async () => {
              setBusy(true);
              try {
                const parsed = JSON.parse(text) as Record<string, unknown>;
                await onConfirm(parsed);
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            className="text-[11px] px-3 py-1 rounded bg-accent text-white hover:bg-accent-light disabled:opacity-50"
          >
            {busy ? "Forking…" : "↻ Fork run"}
          </button>
        </footer>
      </div>
    </div>
  );
}
