// SPDX-License-Identifier: BUSL-1.1
//
// Floating bottom bar that appears when 1+ agents are selected on the
// grid. Wake / Pause / Resume / Clear. Backend has no bulk endpoint;
// we fan out one request per agent client-side and report progress.

export function BulkActionBar({
  count,
  onWake,
  onPause,
  onResume,
  onClear,
  busy,
}: {
  count: number;
  onWake: () => void;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 shadow-lg">
        <span className="text-xs font-medium text-text-secondary">
          {count} selected
        </span>
        <span className="h-4 w-px bg-border-subtle" />
        <Btn label="Wake" onClick={onWake} busy={busy} />
        <Btn label="Pause" onClick={onPause} busy={busy} />
        <Btn label="Resume" onClick={onResume} busy={busy} />
        <span className="h-4 w-px bg-border-subtle" />
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="text-[11px] text-muted hover:text-text disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function Btn({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-full px-3 py-1 text-xs font-medium text-text-secondary hover:bg-bg-warm disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}
