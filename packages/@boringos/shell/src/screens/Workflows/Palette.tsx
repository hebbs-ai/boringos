// SPDX-License-Identifier: BUSL-1.1
//
// Cmd-K palette — fuzzy block insertion. Shows control-flow primitives
// at the top, then tools grouped by module. Compact, keyboard-first.

import { Command } from "cmdk";
import { useEffect, useMemo, useRef } from "react";

import type { ToolRow, V2BlockKind } from "./types.js";

const CONTROL_FLOW: { kind: V2BlockKind; label: string; hint: string }[] = [
  { kind: "trigger", label: "Trigger", hint: "Entry point — receives the trigger payload" },
  { kind: "condition", label: "Condition (if)", hint: "Branch true / false on a value" },
  { kind: "for_each", label: "For each", hint: "Iterate an array, dispatch a tool per item" },
  { kind: "delay", label: "Delay", hint: "Wait N milliseconds before continuing" },
  { kind: "transform", label: "Transform", hint: "Map upstream outputs into a new shape" },
  { kind: "sticky", label: "Sticky note", hint: "Annotate the canvas — non-executing" },
  { kind: "agent", label: "Wake agent", hint: "Wake an agent on a task — framework.agents.wake" },
];

export interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tools: ToolRow[];
  /** Called when user picks a control-flow kind. */
  onPickKind: (kind: V2BlockKind) => void;
  /** Called when user picks a tool. */
  onPickTool: (tool: ToolRow) => void;
}

export function Palette({ open, onOpenChange, tools, onPickKind, onPickTool }: PaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const grouped = useMemo(() => {
    const map = new Map<string, ToolRow[]>();
    for (const t of tools) {
      const m = t.moduleId || "other";
      if (!map.has(m)) map.set(m, []);
      map.get(m)!.push(t);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tools]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-accent/30 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onOpenChange(false);
      }}
    >
      <Command
        loop
        className="w-[520px] max-w-[90vw] bg-white rounded-lg border border-border shadow-2xl overflow-hidden"
      >
        <div className="border-b border-border-subtle px-3 py-2 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">
            Insert
          </span>
          <Command.Input
            ref={inputRef}
            placeholder="Search blocks and tools…"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted"
          />
          <kbd className="text-[10px] text-muted font-mono">esc</kbd>
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto py-1">
          <Command.Empty className="px-3 py-4 text-xs text-muted">
            No matches.
          </Command.Empty>

          <Command.Group
            heading="Control flow"
            className="text-[9px] uppercase tracking-wider text-muted font-semibold px-3 pt-2 pb-1"
          >
            {CONTROL_FLOW.map((b) => (
              <Command.Item
                key={`cf-${b.kind}`}
                value={`${b.kind} ${b.label}`}
                onSelect={() => {
                  onPickKind(b.kind);
                  onOpenChange(false);
                }}
                className="px-3 py-1.5 text-sm text-text-secondary cursor-pointer aria-selected:bg-bg-warm flex items-center gap-3"
              >
                <span className="font-medium w-32 shrink-0">{b.label}</span>
                <span className="text-[11px] text-muted truncate">{b.hint}</span>
              </Command.Item>
            ))}
          </Command.Group>

          {grouped.map(([moduleId, mt]) => (
            <Command.Group
              key={moduleId}
              heading={moduleId}
              className="text-[9px] uppercase tracking-wider text-muted font-semibold px-3 pt-2 pb-1"
            >
              {mt.map((t) => (
                <Command.Item
                  key={t.fullName}
                  value={`${t.fullName} ${t.description}`}
                  onSelect={() => {
                    onPickTool(t);
                    onOpenChange(false);
                  }}
                  className="px-3 py-1.5 text-sm cursor-pointer aria-selected:bg-bg-warm flex items-center gap-3"
                >
                  <code className="text-[11px] text-text w-44 shrink-0 truncate">
                    {t.fullName}
                  </code>
                  <span className="text-[11px] text-muted truncate">{t.description}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
