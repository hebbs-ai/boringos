// SPDX-License-Identifier: BUSL-1.1
//
// Classification filter chips — sit under the status tabs. Multi-select
// (toggle each chip). Counts reflect items in the current status tab
// matching that classification.

import {
  classificationChipClass,
  type Classification,
} from "./presenter.js";

const CLASSIFICATIONS: Classification[] = ["lead", "reply", "internal", "newsletter", "spam"];

export interface ClassificationFilterProps {
  active: Set<Classification>;
  counts: Record<Classification, number>;
  onToggle: (c: Classification) => void;
  onClear: () => void;
}

export function ClassificationFilter({ active, counts, onToggle, onClear }: ClassificationFilterProps) {
  const total = CLASSIFICATIONS.reduce((sum, c) => sum + (counts[c] ?? 0), 0);
  if (total === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-1 mb-3 flex-wrap">
      <button
        type="button"
        onClick={onClear}
        className={`text-[11px] px-2 py-0.5 rounded-full ${
          active.size === 0
            ? "bg-accent text-white"
            : "text-muted hover:text-text"
        }`}
      >
        All
      </button>
      {CLASSIFICATIONS.map((c) => {
        const isOn = active.has(c);
        const n = counts[c] ?? 0;
        if (n === 0 && !isOn) return null;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onToggle(c)}
            className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ring-1 ${
              isOn ? classificationChipClass(c) : "ring-border text-muted hover:text-text"
            }`}
          >
            <span className="capitalize">{c}</span>
            {n > 0 && <span className="tabular-nums opacity-70">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
