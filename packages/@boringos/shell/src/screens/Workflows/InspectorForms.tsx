// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-kind block config forms, written for non-technical authors:
// plain-language labels, dropdowns instead of operator codes, the
// ValuePicker instead of hand-typed {{templates}}, schema-driven tool
// inputs (FieldForm), and inline hints/validation. Raw JSON is never
// required — it lives behind an "Advanced" disclosure on tool inputs.

import { useState } from "react";

import type { ToolRow, Block, EventTypeRow } from "./types.js";
import { blockKind } from "./utils.js";
import { FieldForm } from "./FieldForm.js";
import { TemplateField, tokenSample, type FieldSource } from "./ValuePicker.js";

export interface FormProps {
  block: Block;
  onChange: (patch: Partial<Block>) => void;
  tools?: ToolRow[];
  /** Referenceable upstream values for the block being edited. */
  sources: FieldSource[];
  /** Events the trigger can subscribe to (from installed modules). */
  eventTypes?: EventTypeRow[];
}

const inputCls =
  "w-full rounded border border-border bg-white px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent";
const monoInputCls = `${inputCls} font-mono`;
const labelCls = "text-[10px] uppercase tracking-wider font-semibold text-muted mb-1";
const noteCls = "rounded border border-border-subtle bg-bg px-2 py-2 text-[11px] text-muted leading-relaxed";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className={labelCls}>{label}</div>
      {children}
      {hint && <div className="text-[10px] text-muted mt-1 leading-tight">{hint}</div>}
    </label>
  );
}

export function BlockForm({ block, onChange, tools = [], sources, eventTypes = [] }: FormProps) {
  const kind = blockKind(block);
  return (
    <div className="space-y-3">
      <Field label="Label" hint="A short name shown on the canvas.">
        <input
          className={inputCls}
          value={block.name ?? ""}
          placeholder="(auto)"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Field>

      {kind === "trigger" && <TriggerForm block={block} onChange={onChange} sources={sources} eventTypes={eventTypes} />}
      {kind === "tool" && <ToolForm block={block} onChange={onChange} tools={tools} sources={sources} />}
      {kind === "condition" && <ConditionForm block={block} onChange={onChange} sources={sources} />}
      {kind === "for_each" && <ForEachForm block={block} onChange={onChange} tools={tools} sources={sources} />}
      {kind === "delay" && <DelayForm block={block} onChange={onChange} sources={sources} />}
      {kind === "transform" && <TransformForm block={block} onChange={onChange} sources={sources} />}
      {kind === "sticky" && <StickyForm block={block} onChange={onChange} sources={sources} />}
      {kind === "branch" && <BranchForm />}
      {kind === "agent" && <AgentForm block={block} onChange={onChange} tools={tools} sources={sources} />}

      <div className="pt-1 text-[9px] font-mono text-muted/70">id: {block.id}</div>
    </div>
  );
}

// ── Trigger ────────────────────────────────────────────────────────────────

function TriggerForm({ block, onChange, eventTypes = [] }: FormProps) {
  const cfg = (block.config ?? {}) as { eventType?: string };
  const event = cfg.eventType ?? "";
  const known = eventTypes.some((e) => e.type === event);
  const [custom, setCustom] = useState(!!event && !known);

  // Always carry `type: "trigger"` — the event→workflow router matches
  // on the legacy `type` field, so a trigger with only `kind` set never
  // fires.
  const setEvent = (v?: string) =>
    onChange({ type: "trigger", config: { ...cfg, eventType: v || undefined } });

  return (
    <>
      <Field
        label="Start this workflow when"
        hint="The workflow runs automatically each time this happens. It only fires while the workflow is Active."
      >
        <select
          className={inputCls}
          value={custom ? "__custom" : event}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__custom") setCustom(true);
            else {
              setCustom(false);
              setEvent(v || undefined);
            }
          }}
        >
          <option value="">Manual only — I'll run it myself</option>
          {eventTypes.map((e) => (
            <option key={e.type} value={e.type}>
              {e.description}
            </option>
          ))}
          <option value="__custom">Custom event…</option>
        </select>
      </Field>
      {custom && (
        <Field label="Custom event name" hint="The exact event type, e.g. triage.classified">
          <input
            className={monoInputCls}
            value={event}
            placeholder="module.event_name"
            onChange={(e) => setEvent(e.target.value)}
          />
        </Field>
      )}
      <div className={noteCls}>
        Later steps can use this trigger's data — pick it from the{" "}
        <span className="font-medium">+ Value</span> menu on any field.
      </div>
    </>
  );
}

// ── Tool ─────────────────────────────────────────────────────────────────

function ToolForm({ block, onChange, tools = [], sources }: FormProps) {
  const tool = tools.find((t) => t.fullName === block.tool);
  return (
    <>
      <Field label="Run this tool">
        <select
          className={monoInputCls}
          value={block.tool ?? ""}
          onChange={(e) => onChange({ tool: e.target.value })}
        >
          <option value="">— pick a tool —</option>
          {tools.map((t) => (
            <option key={t.fullName} value={t.fullName}>
              {t.fullName}
            </option>
          ))}
        </select>
        {tool?.description && <div className="text-[10px] text-muted mt-1">{tool.description}</div>}
      </Field>

      {block.tool ? (
        <div>
          <div className={labelCls}>Inputs</div>
          <FieldForm
            schema={tool?.inputSchema}
            value={block.inputs ?? {}}
            onChange={(inputs) => onChange({ inputs })}
            sources={sources}
          />
        </div>
      ) : (
        <div className={noteCls}>Choose a tool to set up its inputs.</div>
      )}
    </>
  );
}

// ── Condition ──────────────────────────────────────────────────────────────

const OPERATORS: { value: string; label: string; rhs: "text" | "number" | "list" | "none" }[] = [
  { value: "equals", label: "is", rhs: "text" },
  { value: "not_equals", label: "is not", rhs: "text" },
  { value: "contains", label: "contains", rhs: "text" },
  { value: "in", label: "is one of", rhs: "list" },
  { value: "gt", label: "is greater than", rhs: "number" },
  { value: "gte", label: "is greater than or equal to", rhs: "number" },
  { value: "lt", label: "is less than", rhs: "number" },
  { value: "lte", label: "is less than or equal to", rhs: "number" },
  { value: "truthy", label: "is set / not empty", rhs: "none" },
  { value: "falsy", label: "is empty", rhs: "none" },
];

function ConditionForm({ block, onChange, sources }: FormProps) {
  const cfg = (block.config ?? {}) as { field?: unknown; operator?: string; value?: unknown };
  const op = cfg.operator ?? "equals";
  const meta = OPERATORS.find((o) => o.value === op) ?? OPERATORS[0]!;
  const update = (patch: Partial<typeof cfg>) => onChange({ config: { ...cfg, ...patch } });

  const lhs = typeof cfg.field === "string" ? cfg.field : "";
  const sample = tokenSample(lhs, sources);
  const rhsStr = cfg.value === undefined || cfg.value === null ? "" : String(cfg.value);

  return (
    <>
      <Field label="If this value">
        <TemplateField
          value={lhs}
          onChange={(v) => update({ field: v })}
          sources={sources}
          mono
          placeholder="Pick a value with + Value →"
        />
      </Field>
      {sample !== undefined && (
        <div className="-mt-1.5 text-[10px] text-muted">
          Latest run: <span className="font-mono text-text-secondary">{sample}</span>
        </div>
      )}

      <Field label="Condition">
        <select className={inputCls} value={op} onChange={(e) => update({ operator: e.target.value })}>
          {OPERATORS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {meta.rhs === "number" && (
        <Field label="Value">
          <input
            type="number"
            className={inputCls}
            value={rhsStr}
            onChange={(e) => update({ value: e.target.value === "" ? "" : Number(e.target.value) })}
          />
        </Field>
      )}
      {meta.rhs === "list" && (
        <Field label="Any of these" hint="Comma-separated, e.g. noise, fyi">
          <TemplateField value={rhsStr} onChange={(v) => update({ value: v })} sources={sources} mono />
        </Field>
      )}
      {meta.rhs === "text" && (
        <Field label="Compared to">
          <TemplateField value={rhsStr} onChange={(v) => update({ value: v })} sources={sources} />
        </Field>
      )}

      <div className={noteCls}>
        The <span className="font-medium text-emerald-700">Yes</span> path runs when this is true; the{" "}
        <span className="font-medium text-rose-700">No</span> path runs otherwise.
      </div>
    </>
  );
}

// ── For-each ─────────────────────────────────────────────────────────────

function ForEachForm({ block, onChange, tools = [], sources }: FormProps) {
  const cfg = (block.config ?? {}) as {
    items?: string;
    tool?: string;
    inputs?: Record<string, unknown>;
  };
  const update = (patch: Partial<typeof cfg>) => onChange({ config: { ...cfg, ...patch } });
  const tool = tools.find((t) => t.fullName === cfg.tool);

  // Inside the loop, each iteration exposes the current item + index.
  const itemSources: FieldSource[] = [
    { blockId: "", label: "Current item", kind: "synthetic", fields: [{ path: "item" }, { path: "index" }] },
    ...sources,
  ];

  return (
    <>
      <Field label="For each item in" hint="A list from an earlier step — pick it with + Value.">
        <TemplateField
          value={cfg.items ?? ""}
          onChange={(v) => update({ items: v })}
          sources={sources}
          mono
          placeholder="e.g. the messages from a fetch step"
        />
      </Field>
      <Field label="Do this for each one">
        <select className={monoInputCls} value={cfg.tool ?? ""} onChange={(e) => update({ tool: e.target.value })}>
          <option value="">— pick a tool —</option>
          {tools.map((t) => (
            <option key={t.fullName} value={t.fullName}>
              {t.fullName}
            </option>
          ))}
        </select>
      </Field>
      {cfg.tool && (
        <div>
          <div className={labelCls}>Inputs (per item)</div>
          <FieldForm
            schema={tool?.inputSchema}
            value={cfg.inputs ?? {}}
            onChange={(inputs) => update({ inputs })}
            sources={itemSources}
          />
        </div>
      )}
    </>
  );
}

// ── Delay ────────────────────────────────────────────────────────────────

function DelayForm({ block, onChange }: FormProps) {
  const cfg = (block.config ?? {}) as { ms?: number };
  const ms = typeof cfg.ms === "number" ? cfg.ms : 1000;
  const seconds = Math.round(ms / 100) / 10;
  return (
    <Field label="Wait" hint="Pause before the next step runs.">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={0.5}
          className={inputCls}
          value={seconds}
          onChange={(e) => onChange({ config: { ms: Math.max(0, Number(e.target.value) || 0) * 1000 } })}
        />
        <span className="text-xs text-muted">seconds</span>
      </div>
    </Field>
  );
}

// ── Transform ────────────────────────────────────────────────────────────

function TransformForm({ block, onChange, sources }: FormProps) {
  const cfg = (block.config ?? {}) as { mapping?: Record<string, unknown> };
  return (
    <>
      <div className={labelCls}>Build a new value</div>
      <MappingEditor
        mapping={cfg.mapping ?? {}}
        onChange={(mapping) => onChange({ config: { mapping } })}
        sources={sources}
      />
    </>
  );
}

/**
 * Key/value rows for a transform's output. Local row state is seeded
 * once — BlockForm is re-mounted per block (keyed by id), so there's
 * no cross-block bleed and rows with a half-typed key stay put.
 */
function MappingEditor({
  mapping,
  onChange,
  sources,
}: {
  mapping: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
  sources: FieldSource[];
}) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(mapping).map(([k, v]) => ({
      k,
      v: typeof v === "string" ? v : JSON.stringify(v),
    })),
  );

  const commit = (next: { k: string; v: string }[]) => {
    setRows(next);
    const obj: Record<string, unknown> = {};
    for (const r of next) if (r.k.trim() !== "") obj[r.k] = r.v;
    onChange(obj);
  };

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="space-y-1 rounded border border-border-subtle p-1.5">
          <div className="flex items-center gap-1.5">
            <input
              className={`${inputCls} flex-1`}
              placeholder="field name"
              value={row.k}
              onChange={(e) => commit(rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
            />
            <button
              type="button"
              onClick={() => commit(rows.filter((_, j) => j !== i))}
              className="text-[11px] text-muted hover:text-rose-600 px-1"
              title="Remove"
            >
              ✕
            </button>
          </div>
          <TemplateField
            value={row.v}
            onChange={(v) => commit(rows.map((r, j) => (j === i ? { ...r, v } : r)))}
            sources={sources}
            mono
            placeholder="value (pick with + Value)"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => commit([...rows, { k: "", v: "" }])}
        className="text-[11px] text-muted hover:text-text px-2 py-1 rounded border border-border-subtle"
      >
        + Add field
      </button>
    </div>
  );
}

// ── Sticky ───────────────────────────────────────────────────────────────

function StickyForm({ block, onChange }: FormProps) {
  const cfg = (block.config ?? {}) as { text?: string };
  return (
    <Field label="Note" hint="A comment on the canvas — it doesn't run.">
      <textarea
        rows={6}
        className={`${inputCls} font-mono text-[11px]`}
        placeholder="Annotation visible on the canvas"
        value={cfg.text ?? ""}
        onChange={(e) => onChange({ config: { text: e.target.value } })}
      />
    </Field>
  );
}

// ── Branch ───────────────────────────────────────────────────────────────

function BranchForm() {
  return (
    <div className={noteCls}>
      A branch passes its input on to <span className="font-medium">every</span> connected path. To send
      work down one path or another based on a value, use a{" "}
      <span className="font-medium">Condition</span> step instead.
    </div>
  );
}

// ── Agent ────────────────────────────────────────────────────────────────

function AgentForm({ block, onChange, tools = [], sources }: FormProps) {
  // An agent block wakes an agent on a task via framework.agents.wake.
  const wake = tools.find((t) => t.fullName === "framework.agents.wake");
  return (
    <>
      <div className={noteCls}>Wake an agent and hand it a task to work on.</div>
      <div>
        <div className={labelCls}>Details</div>
        <FieldForm
          schema={wake?.inputSchema}
          value={block.inputs ?? {}}
          onChange={(inputs) => onChange({ inputs })}
          sources={sources}
        />
      </div>
    </>
  );
}
