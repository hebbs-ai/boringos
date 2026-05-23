// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ValuePicker — the non-technical way to reference an upstream block's
// output. Instead of hand-typing `{{blockId.field}}`, the author opens
// a menu of upstream steps and their fields and inserts a token; any
// tokens already in the value render as friendly chips ("From Classify
// · label") with the last-run sample on hover. This is the shared
// primitive every inspector form composes for its value inputs.

import { Command } from "cmdk";
import { useEffect, useRef, useState } from "react";

import type { Block, BlockRun, Edge } from "./types.js";
import { blockKind, blockLabel, kindAccent } from "./utils.js";

// ── Field sources ───────────────────────────────────────────────────────────

export interface FieldOption {
  /** "" means the whole block output; otherwise a top-level output key. */
  path: string;
  sample?: unknown;
}

export interface FieldSource {
  /** "" for synthetic vars ({{now}}/{{today}}); otherwise the block id. */
  blockId: string;
  label: string;
  kind: string;
  fields: FieldOption[];
}

const TOKEN_RE = /\{\{([a-zA-Z0-9_.-]+)\}\}/g;

/** Upstream ancestors of `start` — only their outputs exist at run time. */
function collectAncestors(start: string, edges: Edge[]): Set<string> {
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (!parents.has(e.targetBlockId)) parents.set(e.targetBlockId, []);
    parents.get(e.targetBlockId)!.push(e.sourceBlockId);
  }
  const seen = new Set<string>();
  const stack = [...(parents.get(start) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of parents.get(id) ?? []) stack.push(p);
  }
  return seen;
}

/** Top-level keys of a block's last-run output, with sample values. */
function outputFields(output: Record<string, unknown> | null | undefined): FieldOption[] {
  if (!output || typeof output !== "object") return [];
  return Object.entries(output).map(([path, sample]) => ({ path, sample }));
}

/**
 * Build the menu of referenceable values for the block being edited:
 * every upstream block (by friendly label, with its known output
 * fields) plus the always-available date/time vars.
 */
export function buildFieldSources(
  blocks: Block[],
  edges: Edge[],
  currentBlockId: string | null,
  runBlocks?: BlockRun[],
): FieldSource[] {
  const runByBlock = new Map<string, BlockRun>();
  for (const r of runBlocks ?? []) runByBlock.set(r.blockId, r);

  const allowed = currentBlockId
    ? collectAncestors(currentBlockId, edges)
    : new Set(blocks.map((b) => b.id));

  const sources: FieldSource[] = [];
  for (const b of blocks) {
    if (b.id === currentBlockId) continue;
    if (!allowed.has(b.id)) continue;
    if (blockKind(b) === "sticky") continue;
    sources.push({
      blockId: b.id,
      label: b.name || blockLabel(b),
      kind: blockKind(b),
      fields: outputFields(runByBlock.get(b.id)?.output),
    });
  }
  const now = new Date();
  sources.push({
    blockId: "",
    label: "Date & time",
    kind: "synthetic",
    fields: [
      { path: "now", sample: now.toISOString() },
      { path: "today", sample: now.toISOString().slice(0, 10) },
    ],
  });
  return sources;
}

/** The `{{…}}` token for a (source, field) pick. */
function tokenFor(source: FieldSource, field: FieldOption): string {
  if (source.blockId === "") return `{{${field.path}}}`;
  return field.path ? `{{${source.blockId}.${field.path}}}` : `{{${source.blockId}}}`;
}

/** Friendly label + sample for a raw token, for the chips preview. */
function describeToken(
  raw: string,
  sources: FieldSource[],
): { label: string; sample?: unknown } {
  const path = raw.replace(/^\{\{|\}\}$/g, "");
  const dot = path.indexOf(".");
  const head = dot === -1 ? path : path.slice(0, dot);
  const rest = dot === -1 ? "" : path.slice(dot + 1);
  // Synthetic vars (date/time, for-each item/index) have no block prefix.
  const synthField = sources
    .filter((s) => s.blockId === "")
    .flatMap((s) => s.fields)
    .find((f) => f.path === path);
  if (synthField) return { label: path, sample: synthField.sample };
  const src = sources.find((s) => s.blockId === head);
  if (!src) return { label: path };
  const field = src.fields.find((f) => f.path === rest);
  return {
    label: rest ? `${src.label} · ${rest}` : src.label,
    sample: field?.sample,
  };
}

/** If `value` is a single whole token, the last-run sample for it as text. */
export function tokenSample(value: string, sources: FieldSource[]): string | undefined {
  const m = /^\{\{([a-zA-Z0-9_.-]+)\}\}$/.exec(value.trim());
  if (!m) return undefined;
  return sampleText(describeToken(`{{${m[1]}}}`, sources).sample);
}

function sampleText(sample: unknown): string | undefined {
  if (sample === undefined) return undefined;
  if (sample === null) return "null";
  if (typeof sample === "string") return sample.length > 60 ? `${sample.slice(0, 57)}…` : sample;
  if (typeof sample === "number" || typeof sample === "boolean") return String(sample);
  try {
    const j = JSON.stringify(sample);
    return j.length > 60 ? `${j.slice(0, 57)}…` : j;
  } catch {
    return undefined;
  }
}

// ── Insert menu ───────────────────────────────────────────────────────────

function InsertValueMenu({
  sources,
  onPick,
  onClose,
}: {
  sources: FieldSource[];
  onPick: (token: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 z-30 mt-1 w-[260px] rounded-md border border-border bg-white shadow-lg overflow-hidden"
    >
      <Command loop>
        <Command.Input
          autoFocus
          placeholder="Search a value…"
          className="w-full border-b border-border-subtle px-2.5 py-1.5 text-xs focus:outline-none placeholder:text-muted"
        />
        <Command.List className="max-h-[260px] overflow-y-auto py-1">
          <Command.Empty className="px-3 py-3 text-[11px] text-muted">
            No upstream values yet — run the workflow once to see fields.
          </Command.Empty>
          {sources.map((src) => {
            const accent = kindAccent(src.kind as Parameters<typeof kindAccent>[0]);
            // Always offer the whole output for real blocks.
            const opts: FieldOption[] =
              src.blockId === ""
                ? src.fields
                : src.fields.length > 0
                  ? src.fields
                  : [{ path: "" }];
            return (
              <Command.Group
                key={src.blockId || "synthetic"}
                heading={src.label}
                className="px-2 pt-1.5 pb-0.5 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:pb-1"
              >
                {opts.map((field) => {
                  const token = tokenFor(src, field);
                  const sample = sampleText(field.sample);
                  return (
                    <Command.Item
                      key={token}
                      value={`${src.label} ${field.path} ${token}`}
                      onSelect={() => {
                        onPick(token);
                        onClose();
                      }}
                      className="flex items-center gap-2 rounded px-2 py-1 text-[11px] text-text-secondary cursor-pointer aria-selected:bg-bg-warm"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${accent.bar}`} />
                      <span className="font-medium truncate">
                        {field.path || "(whole output)"}
                      </span>
                      {sample !== undefined && (
                        <span className="ml-auto font-mono text-muted truncate max-w-[110px]">
                          {sample}
                        </span>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
    </div>
  );
}

// ── TemplateField ───────────────────────────────────────────────────────────

export interface TemplateFieldProps {
  value: string;
  onChange: (v: string) => void;
  sources: FieldSource[];
  multiline?: boolean;
  mono?: boolean;
  placeholder?: string;
  invalid?: boolean;
}

/**
 * A text input/textarea whose values can reference upstream outputs.
 * The "Insert value" button opens the picker and drops a token at the
 * caret; tokens in the value render as friendly chips beneath.
 */
export function TemplateField({
  value,
  onChange,
  sources,
  multiline = false,
  mono = false,
  placeholder,
  invalid = false,
}: TemplateFieldProps) {
  const [open, setOpen] = useState(false);
  const elRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const caret = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  const syncCaret = () => {
    const el = elRef.current;
    if (!el) return;
    caret.current = {
      start: el.selectionStart ?? value.length,
      end: el.selectionEnd ?? value.length,
    };
  };

  const insert = (token: string) => {
    const { start, end } = caret.current;
    const s = Math.min(start, value.length);
    const e = Math.min(end, value.length);
    const next = value.slice(0, s) + token + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      const el = elRef.current;
      if (!el) return;
      el.focus();
      const pos = s + token.length;
      el.setSelectionRange(pos, pos);
      caret.current = { start: pos, end: pos };
    });
  };

  const base = `w-full rounded border bg-white px-2 py-1.5 text-xs text-text focus:outline-none ${
    mono ? "font-mono" : ""
  } ${invalid ? "border-rose-300 focus:border-rose-400" : "border-border focus:border-accent"}`;

  // Tokens present in the value → chips.
  const tokens = Array.from(value.matchAll(TOKEN_RE)).map((m) => m[0]);
  const uniqueTokens = Array.from(new Set(tokens));

  return (
    <div className="relative">
      <div className="relative">
        {multiline ? (
          <textarea
            ref={elRef}
            rows={5}
            spellCheck={false}
            className={`${base} pr-16`}
            value={value}
            placeholder={placeholder}
            onChange={(ev) => onChange(ev.target.value)}
            onSelect={syncCaret}
            onKeyUp={syncCaret}
            onClick={syncCaret}
          />
        ) : (
          <input
            ref={elRef}
            className={`${base} pr-16`}
            value={value}
            placeholder={placeholder}
            onChange={(ev) => onChange(ev.target.value)}
            onSelect={syncCaret}
            onKeyUp={syncCaret}
            onClick={syncCaret}
          />
        )}
        <button
          type="button"
          onClick={() => {
            syncCaret();
            setOpen((o) => !o);
          }}
          className={`absolute right-1 ${multiline ? "top-1" : "top-1/2 -translate-y-1/2"} text-[10px] text-muted hover:text-text px-1.5 py-0.5 rounded border border-border-subtle bg-white`}
          title="Insert a value from an earlier step"
        >
          + Value
        </button>
        {open && (
          <InsertValueMenu sources={sources} onPick={insert} onClose={() => setOpen(false)} />
        )}
      </div>

      {uniqueTokens.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {uniqueTokens.map((tok) => {
            const { label, sample } = describeToken(tok, sources);
            const s = sampleText(sample);
            return (
              <span
                key={tok}
                title={s !== undefined ? `${tok} → ${s}` : tok}
                className="inline-flex items-center gap-1 rounded bg-accent/10 text-accent px-1.5 py-0.5 text-[10px] font-medium"
              >
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
