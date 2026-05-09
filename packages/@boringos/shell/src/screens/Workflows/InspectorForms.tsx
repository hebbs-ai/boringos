// SPDX-License-Identifier: BUSL-1.1
//
// Per-kind block config forms. Hand-coded for control flow + tool;
// in v2.2 these become Zod-driven.

import { useMemo } from "react";

import type { ToolRow, V2Block } from "./types.js";
import { blockKind } from "./utils.js";

export interface FormProps {
  block: V2Block;
  onChange: (patch: Partial<V2Block>) => void;
  tools?: ToolRow[];
}

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
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted mb-1">
        {label}
      </div>
      {children}
      {hint && <div className="text-[10px] text-muted mt-1 leading-tight">{hint}</div>}
    </label>
  );
}

const inputCls =
  "w-full rounded border border-border bg-white px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent";
const monoInputCls =
  "w-full rounded border border-border bg-white px-2 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-accent";
const textareaCls =
  "w-full rounded border border-border bg-white px-2 py-1.5 text-[11px] font-mono text-text focus:outline-none focus:border-accent";

export function BlockForm({ block, onChange, tools = [] }: FormProps) {
  const kind = blockKind(block);
  return (
    <div className="space-y-3">
      <Field label="Label">
        <input
          className={inputCls}
          value={block.name ?? ""}
          placeholder="(auto)"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Field>
      <Field label="Block id">
        <code className="block text-[11px] font-mono text-muted">{block.id}</code>
      </Field>

      {kind === "trigger" && <TriggerForm block={block} onChange={onChange} />}
      {kind === "tool" && <ToolForm block={block} onChange={onChange} tools={tools} />}
      {kind === "condition" && <ConditionForm block={block} onChange={onChange} />}
      {kind === "for_each" && <ForEachForm block={block} onChange={onChange} tools={tools} />}
      {kind === "delay" && <DelayForm block={block} onChange={onChange} />}
      {kind === "transform" && <TransformForm block={block} onChange={onChange} />}
      {kind === "sticky" && <StickyForm block={block} onChange={onChange} />}
    </div>
  );
}

function TriggerForm(_p: FormProps) {
  return (
    <div className="rounded border border-border-subtle bg-bg px-2 py-2 text-[11px] text-muted leading-relaxed">
      Trigger blocks emit the run's <code className="font-mono">payload</code> as their
      output. Reference upstream values as <code className="font-mono">{"{{trigger.field}}"}</code>.
    </div>
  );
}

function ToolForm({ block, onChange, tools }: FormProps) {
  const tool = useMemo(() => tools?.find((t) => t.fullName === block.tool), [tools, block.tool]);
  const inputsJson = useMemo(() => {
    try {
      return JSON.stringify(block.inputs ?? {}, null, 2);
    } catch {
      return "{}";
    }
  }, [block.inputs]);

  return (
    <>
      <Field label="Tool">
        <select
          className={monoInputCls}
          value={block.tool ?? ""}
          onChange={(e) => onChange({ tool: e.target.value })}
        >
          <option value="">— pick a tool —</option>
          {tools?.map((t) => (
            <option key={t.fullName} value={t.fullName}>
              {t.fullName}
            </option>
          ))}
        </select>
        {tool && <div className="text-[10px] text-muted mt-1">{tool.description}</div>}
      </Field>

      <Field
        label="Inputs (JSON)"
        hint="Reference upstream blocks with {{blockId.field}}; whole-string templates preserve type."
      >
        <textarea
          rows={8}
          spellCheck={false}
          className={textareaCls}
          value={inputsJson}
          onChange={(e) => {
            const txt = e.target.value;
            try {
              const parsed = JSON.parse(txt) as Record<string, unknown>;
              onChange({ inputs: parsed });
            } catch {
              // keep typing — don't update inputs until valid JSON
            }
          }}
        />
      </Field>
    </>
  );
}

function ConditionForm({ block, onChange }: FormProps) {
  const cfg = (block.config ?? {}) as {
    field?: string;
    operator?: string;
    value?: string | number | boolean;
  };
  const update = (patch: Partial<typeof cfg>) =>
    onChange({ config: { ...cfg, ...patch } });
  return (
    <>
      <Field label="LHS (field/template)" hint="Usually {{nodeId.field}}">
        <input
          className={monoInputCls}
          value={String(cfg.field ?? "")}
          placeholder="{{fetch.count}}"
          onChange={(e) => update({ field: e.target.value })}
        />
      </Field>
      <Field label="Operator">
        <select
          className={inputCls}
          value={cfg.operator ?? "truthy"}
          onChange={(e) => update({ operator: e.target.value })}
        >
          {["truthy", "falsy", "equals", "not_equals", "contains", "gt", "gte", "lt", "lte"].map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </Field>
      <Field label="RHS">
        <input
          className={monoInputCls}
          value={String(cfg.value ?? "")}
          onChange={(e) => update({ value: e.target.value })}
        />
      </Field>
    </>
  );
}

function ForEachForm({ block, onChange, tools }: FormProps) {
  const cfg = (block.config ?? {}) as {
    items?: string;
    tool?: string;
    inputs?: Record<string, unknown>;
  };
  const inputsJson = useMemo(() => {
    try {
      return JSON.stringify(cfg.inputs ?? {}, null, 2);
    } catch {
      return "{}";
    }
  }, [cfg.inputs]);
  const update = (patch: Partial<typeof cfg>) =>
    onChange({ config: { ...cfg, ...patch } });
  return (
    <>
      <Field label="Items" hint="An array template — e.g. {{fetch.messages}}">
        <input
          className={monoInputCls}
          value={cfg.items ?? ""}
          placeholder="{{upstream.messages}}"
          onChange={(e) => update({ items: e.target.value })}
        />
      </Field>
      <Field label="Per-item tool">
        <select
          className={monoInputCls}
          value={cfg.tool ?? ""}
          onChange={(e) => update({ tool: e.target.value })}
        >
          <option value="">— pick a tool —</option>
          {tools?.map((t) => (
            <option key={t.fullName} value={t.fullName}>
              {t.fullName}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Per-item inputs (JSON)"
        hint="Use {{item}} and {{index}} alongside upstream refs."
      >
        <textarea
          rows={6}
          spellCheck={false}
          className={textareaCls}
          value={inputsJson}
          onChange={(e) => {
            try {
              update({ inputs: JSON.parse(e.target.value) as Record<string, unknown> });
            } catch {
              /* wait for valid JSON */
            }
          }}
        />
      </Field>
    </>
  );
}

function DelayForm({ block, onChange }: FormProps) {
  const cfg = (block.config ?? {}) as { ms?: number };
  return (
    <Field label="Wait (ms)">
      <input
        type="number"
        min={0}
        className={inputCls}
        value={typeof cfg.ms === "number" ? cfg.ms : 1000}
        onChange={(e) => onChange({ config: { ms: Number(e.target.value) || 0 } })}
      />
    </Field>
  );
}

function TransformForm({ block, onChange }: FormProps) {
  const cfg = (block.config ?? {}) as { mapping?: Record<string, unknown> };
  const json = useMemo(() => {
    try {
      return JSON.stringify(cfg.mapping ?? {}, null, 2);
    } catch {
      return "{}";
    }
  }, [cfg.mapping]);
  return (
    <Field
      label="Mapping (JSON)"
      hint='e.g. { "subject": "{{fetch.0.subject}}", "from": "{{fetch.0.from}}" }'
    >
      <textarea
        rows={8}
        spellCheck={false}
        className={textareaCls}
        value={json}
        onChange={(e) => {
          try {
            onChange({ config: { mapping: JSON.parse(e.target.value) as Record<string, unknown> } });
          } catch {
            /* wait */
          }
        }}
      />
    </Field>
  );
}

function StickyForm({ block, onChange }: FormProps) {
  const cfg = (block.config ?? {}) as { text?: string };
  return (
    <Field label="Note">
      <textarea
        rows={6}
        className={textareaCls}
        placeholder="Annotation visible on the canvas"
        value={cfg.text ?? ""}
        onChange={(e) => onChange({ config: { text: e.target.value } })}
      />
    </Field>
  );
}
