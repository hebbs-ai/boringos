// SPDX-License-Identifier: BUSL-1.1
//
// Shell command bar (Cmd+K) — input + typeahead over command actions
// contributed by installed apps via the slot registry.
//
// Lifted from boringos-crm/packages/web/src/components/CommandBar.tsx
// but generalized: the CRM version sent input to a copilot session via
// CRM-specific hooks. The shell version reads `useSlot("commandActions")`
// and invokes the matching action handler. The "send to copilot" UX
// becomes a default first-party command action (Phase 1 task E3).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSlot } from "../slots/context.js";
import type { SlotContribution } from "../slots/types.js";

function score(query: string, command: SlotContribution<"commandActions">): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = command.slot.label.toLowerCase();
  if (label.includes(q)) return 100;
  for (const k of command.slot.keywords) {
    if (k.toLowerCase().includes(q)) return 50;
  }
  return 0;
}

export function CommandBar() {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useSlot("commandActions");

  // Cmd+K focuses input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const matches = useMemo(() => {
    return commands
      .map((c) => ({ c, s: score(value, c) }))
      .filter((m) => m.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((m) => m.c);
  }, [commands, value]);

  const invoke = useCallback(
    async (command: SlotContribution<"commandActions">) => {
      // ActionContext is provided by the runtime in A6/C5. For now, a
      // minimal stub keeps the chrome compiling. When the real runtime
      // lands, this becomes a single call into the install pipeline's
      // dispatch helper.
      console.warn(
        `[CommandBar] invoke "${command.slot.id}" — runtime ActionContext lands in A6.`,
      );
      setValue("");
      setOpen(false);
    },
    [],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const top = matches[0];
      if (top) void invoke(top);
    },
    [matches, invoke],
  );

  return (
    <div className="shrink-0 border-t border-border bg-white">
      <div className="w-full px-6 py-3">
        <div className="max-w-[720px] mx-auto relative">
          <form
            onSubmit={handleSubmit}
            className="bg-white border border-border flex items-center px-4 py-2.5 gap-2 rounded-xl focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 transition-all"
          >
            <span className="text-[13px] font-semibold text-muted bg-bg-warm px-1.5 py-0.5 rounded shrink-0">
              &#8984;K
            </span>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder={
                commands.length === 0
                  ? "Install an app to enable commands…"
                  : "Type a command…"
              }
              className="flex-1 border-none outline-none text-sm text-text bg-transparent placeholder:text-muted"
            />
          </form>

          {open && matches.length > 0 && (
            <ul className="absolute left-0 right-0 bottom-full mb-2 bg-white border border-border rounded-xl shadow-lg overflow-hidden">
              {matches.map((m) => (
                <li key={`${m.appId}/${m.slotId}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // Prevent the input blur from firing before we invoke
                      e.preventDefault();
                    }}
                    onClick={() => void invoke(m)}
                    className="w-full text-left px-4 py-2 hover:bg-bg flex items-center gap-2"
                  >
                    {m.slot.icon && (
                      <span className="w-[18px] text-center text-[15px] shrink-0 text-muted">
                        {m.slot.icon}
                      </span>
                    )}
                    <span className="flex-1 text-sm text-text">
                      {m.slot.label}
                    </span>
                    <span className="text-[10px] text-muted font-mono">
                      {m.appId}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
