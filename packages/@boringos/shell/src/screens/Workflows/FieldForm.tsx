// SPDX-License-Identifier: AGPL-3.0-or-later
//
// FieldForm — renders a typed, labelled form from a tool's JSON Schema
// (emitted by GET /api/admin/tools) instead of a raw-JSON box. One
// field per property; type inferred from the schema (text / number /
// toggle / dropdown), descriptions become hints, required fields are
// marked and validated inline. The ValuePicker rides on every text
// field so authors reference upstream outputs without typing `{{ }}`.
// A power-user "Advanced (raw JSON)" disclosure stays available for
// anything the form can't express.

import { useEffect, useMemo, useState } from "react";

import type { JsonSchema } from "./types.js";
import { TemplateField, type FieldSource } from "./ValuePicker.js";

export interface FieldFormProps {
  schema?: JsonSchema | null;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  sources: FieldSource[];
}

const labelCls = "text-[10px] uppercase tracking-wider font-semibold text-muted mb-1 flex items-center gap-1";
const hintCls = "text-[10px] text-muted mt-1 leading-tight";
const inputCls =
  "w-full rounded border border-border bg-white px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent";

/** assigneeAgentId → "Assignee agent id"; reply_drafts → "Reply drafts". */
function humanize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The renderable type for a property, collapsing nullable unions. */
function primaryType(schema: JsonSchema): string {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "enum";
  const t = schema.type;
  if (Array.isArray(t)) return (t.find((x) => x !== "null") as string) ?? "string";
  if (typeof t === "string") return t;
  if (schema.properties) return "object";
  return "string";
}

function FieldShell({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className={labelCls}>
        <span>{label}</span>
        {required && <span className="text-rose-500">*</span>}
      </div>
      {children}
      {error ? (
        <div className="text-[10px] text-rose-600 mt-1 leading-tight">{error}</div>
      ) : (
        hint && <div className={hintCls}>{hint}</div>
      )}
    </label>
  );
}

export function FieldForm({ schema, value, onChange, sources }: FieldFormProps) {
  const safeValue = value && typeof value === "object" ? value : {};
  const props = schema?.properties;
  const required = new Set(schema?.required ?? []);

  const set = (key: string, next: unknown) => {
    const copy = { ...safeValue };
    if (next === undefined || next === "") delete copy[key];
    else copy[key] = next;
    onChange(copy);
  };

  // No usable schema → the raw-JSON editor is the whole form.
  if (!props || Object.keys(props).length === 0) {
    return (
      <div className="space-y-2">
        <div className="text-[10px] text-muted leading-tight">
          No field details for this tool — edit its inputs as JSON.
        </div>
        <JsonEditor value={safeValue} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Object.entries(props).map(([key, propSchema]) => {
        const type = primaryType(propSchema);
        const isRequired = required.has(key);
        const raw = safeValue[key];
        const hint = propSchema.description;
        const missing = isRequired && (raw === undefined || raw === "");
        const error = missing ? "Required" : undefined;

        if (type === "enum") {
          const options = (propSchema.enum ?? []).map((o) => String(o));
          return (
            <FieldShell key={key} label={humanize(key)} required={isRequired} hint={hint} error={error}>
              <select
                className={`${inputCls} ${missing ? "border-rose-300" : ""}`}
                value={raw === undefined ? "" : String(raw)}
                onChange={(e) => set(key, e.target.value)}
              >
                <option value="">{isRequired ? "— choose —" : "— none —"}</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </FieldShell>
          );
        }

        if (type === "boolean") {
          return (
            <label key={key} className="flex items-center gap-2 cursor-pointer py-0.5">
              <input
                type="checkbox"
                checked={raw === true}
                onChange={(e) => set(key, e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-xs text-text">{humanize(key)}</span>
              {hint && <span className="text-[10px] text-muted">— {hint}</span>}
            </label>
          );
        }

        if (type === "number" || type === "integer") {
          return (
            <FieldShell key={key} label={humanize(key)} required={isRequired} hint={hint} error={error}>
              <input
                type="number"
                className={`${inputCls} ${missing ? "border-rose-300" : ""}`}
                value={typeof raw === "number" ? raw : raw === undefined ? "" : String(raw)}
                onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))}
              />
            </FieldShell>
          );
        }

        if (type === "object") {
          // Nested objects aren't worth a bespoke form — give them a
          // small JSON box rather than dropping the field entirely.
          return (
            <FieldShell key={key} label={humanize(key)} required={isRequired} hint={hint} error={error}>
              <JsonEditor
                value={(raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>}
                onChange={(v) => set(key, v)}
                rows={4}
              />
            </FieldShell>
          );
        }

        // string, array, and anything else → a template-capable text
        // field. Arrays accept "{{upstream.list}}" or a comma list.
        const multiline = type === "string" && (key.toLowerCase().includes("body") || key.toLowerCase().includes("description") || key.toLowerCase().includes("content"));
        return (
          <FieldShell
            key={key}
            label={humanize(key)}
            required={isRequired}
            hint={hint ?? (type === "array" ? "An array — reference {{a.list}} or type comma-separated values." : undefined)}
            error={error}
          >
            <TemplateField
              value={raw === undefined || raw === null ? "" : String(raw)}
              onChange={(v) => set(key, v)}
              sources={sources}
              multiline={multiline}
              mono={type === "array"}
              invalid={missing}
            />
          </FieldShell>
        );
      })}

      <details className="pt-1">
        <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted font-semibold">
          Advanced (raw JSON)
        </summary>
        <div className="mt-2">
          <JsonEditor value={safeValue} onChange={onChange} />
        </div>
      </details>
    </div>
  );
}

/**
 * Controlled JSON editor that never swallows bad input — it shows an
 * inline parse error and only lifts state up when the text is valid.
 */
function JsonEditor({
  value,
  onChange,
  rows = 8,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  rows?: number;
}) {
  const serialized = useMemo(() => {
    try {
      return JSON.stringify(value ?? {}, null, 2);
    } catch {
      return "{}";
    }
  }, [value]);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the value changes from outside (e.g. a sibling field
  // edit) — but not while the user is mid-typing valid JSON that
  // already represents the same object, or the textarea would reformat
  // under the cursor.
  useEffect(() => {
    setText((prev) => {
      try {
        if (JSON.stringify(JSON.parse(prev)) === JSON.stringify(value ?? {})) return prev;
      } catch {
        /* prev is mid-edit / invalid — adopt the canonical form */
      }
      return serialized;
    });
    setError(null);
  }, [serialized, value]);

  return (
    <div>
      <textarea
        rows={rows}
        spellCheck={false}
        className={`w-full rounded border bg-white px-2 py-1.5 text-[11px] font-mono text-text focus:outline-none ${
          error ? "border-rose-300 focus:border-rose-400" : "border-border focus:border-accent"
        }`}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          try {
            const parsed = JSON.parse(next) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              setError("Must be a JSON object");
              return;
            }
            setError(null);
            onChange(parsed as Record<string, unknown>);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid JSON");
          }
        }}
      />
      {error && <div className="text-[10px] text-rose-600 mt-1">{error}</div>}
    </div>
  );
}
