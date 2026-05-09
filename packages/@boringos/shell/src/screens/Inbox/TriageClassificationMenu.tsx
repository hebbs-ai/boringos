// SPDX-License-Identifier: BUSL-1.1
//
// Click the triage classification chip → small dropdown to override
// the agent's call. Tracks the override on metadata.triage so future
// agents (and other apps) can see it was manually set.

import { useEffect, useRef, useState } from "react";

import {
  classificationChipClass,
  type Classification,
} from "./presenter.js";

const CHOICES: Classification[] = ["lead", "reply", "internal", "newsletter", "spam"];

export interface TriageClassificationMenuProps {
  current: Classification;
  onSelect: (next: Classification) => void;
}

export function TriageClassificationMenu({
  current,
  onSelect,
}: TriageClassificationMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full ring-1 hover:ring-2 ${classificationChipClass(current)}`}
        title="Click to override the triage classification"
      >
        {current} ▾
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 w-36 rounded-md bg-white shadow-lg ring-1 ring-border overflow-hidden">
          {CHOICES.map((c) => {
            const isCurrent = c === current;
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!isCurrent) onSelect(c);
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-bg flex items-center gap-2 disabled:opacity-50"
                disabled={isCurrent}
              >
                <span
                  className={`text-[9px] font-medium uppercase px-1.5 py-0.5 rounded-full ring-1 ${classificationChipClass(c)}`}
                >
                  {c}
                </span>
                {isCurrent && <span className="text-[10px] text-muted">current</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
