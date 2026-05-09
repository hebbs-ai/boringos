// SPDX-License-Identifier: BUSL-1.1
//
// Inbox search box. Debounces keystrokes locally before lifting state
// up so the parent only re-filters at most every 200ms.

import { useEffect, useState } from "react";

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
}

export function SearchBox({ value, onChange, placeholder, debounceMs = 200 }: SearchBoxProps) {
  // Local mirror so typing feels immediate even though the upstream
  // re-filter is debounced.
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (local !== value) onChange(local);
    }, debounceMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, debounceMs]);

  return (
    <div className="relative px-1 mb-2">
      <input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder ?? "Search subject, sender, body…"}
        className="w-full text-xs border border-border bg-white rounded-md px-2.5 py-1.5 pr-7 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {local && (
        <button
          type="button"
          onClick={() => setLocal("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-secondary text-xs"
          title="Clear"
        >
          ×
        </button>
      )}
    </div>
  );
}
