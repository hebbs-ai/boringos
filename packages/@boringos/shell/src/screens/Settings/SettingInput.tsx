// SPDX-License-Identifier: BUSL-1.1
//
// Generic widget for a single SettingDefinition. Switches on `type`.
// Used by ManifestSection to auto-render the General tab from the
// settings manifest.
//
// Values flow through the parent: receives the current string value
// (or null when no row exists), emits string-or-null on change. The
// parent debounces / batches and calls PATCH /api/admin/settings.

import { useState } from "react";
import type { SettingDefinition } from "@boringos/ui";
import { Switch } from "../../components/ui/switch.js";

export function SettingInput({
  def,
  value,
  onChange,
  busy,
}: {
  def: SettingDefinition;
  value: string | null;
  onChange: (next: string | null) => void;
  busy: boolean;
}) {
  switch (def.type) {
    case "boolean":
      return <BooleanInput def={def} value={value} onChange={onChange} busy={busy} />;
    case "select":
      return <SelectInput def={def} value={value} onChange={onChange} busy={busy} />;
    case "longtext":
      return <LongTextInput def={def} value={value} onChange={onChange} busy={busy} />;
    case "number":
      return <NumberInput def={def} value={value} onChange={onChange} busy={busy} />;
    case "secret":
      return <SecretInput def={def} value={value} onChange={onChange} busy={busy} />;
    default:
      return <StringInput def={def} value={value} onChange={onChange} busy={busy} />;
  }
}

function BooleanInput({
  def,
  value,
  onChange,
  busy,
}: {
  def: SettingDefinition;
  value: string | null;
  onChange: (next: string | null) => void;
  busy: boolean;
}) {
  const checked = value === "true" || (value === null && def.default === true);
  return (
    <Switch
      checked={checked}
      onCheckedChange={(v) => onChange(v ? "true" : "false")}
      disabled={busy}
      aria-label={def.label}
    />
  );
}

function SelectInput({
  def,
  value,
  onChange,
  busy,
}: {
  def: SettingDefinition;
  value: string | null;
  onChange: (next: string | null) => void;
  busy: boolean;
}) {
  const current = value ?? (def.default !== undefined ? String(def.default) : "");
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={busy}
      className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text disabled:opacity-50"
    >
      {(def.options ?? []).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function LongTextInput({
  def,
  value,
  onChange,
  busy,
}: {
  def: SettingDefinition;
  value: string | null;
  onChange: (next: string | null) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const dirty = (value ?? "") !== draft;
  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        disabled={busy}
        className="w-full max-w-md rounded-md border border-border bg-white px-2 py-1.5 text-xs text-text disabled:opacity-50"
      />
      {dirty && (
        <button
          type="button"
          onClick={() => onChange(draft)}
          className="self-start rounded-md bg-accent px-2 py-1 text-[11px] text-white hover:bg-accent-light"
          aria-label={`Save ${def.label}`}
        >
          Save
        </button>
      )}
    </div>
  );
}

function NumberInput({
  def,
  value,
  onChange,
  busy,
}: {
  def: SettingDefinition;
  value: string | null;
  onChange: (next: string | null) => void;
  busy: boolean;
}) {
  return (
    <input
      type="number"
      defaultValue={value ?? (def.default !== undefined ? String(def.default) : "")}
      onBlur={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      disabled={busy}
      className="w-32 rounded-md border border-border bg-white px-2 py-1 text-xs text-text disabled:opacity-50"
    />
  );
}

function StringInput({
  def,
  value,
  onChange,
  busy,
}: {
  def: SettingDefinition;
  value: string | null;
  onChange: (next: string | null) => void;
  busy: boolean;
}) {
  return (
    <input
      type="text"
      defaultValue={value ?? (def.default !== undefined ? String(def.default) : "")}
      onBlur={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      disabled={busy}
      placeholder={def.default !== undefined ? String(def.default) : undefined}
      className="w-full max-w-sm rounded-md border border-border bg-white px-2 py-1 text-xs text-text disabled:opacity-50"
    />
  );
}

function SecretInput({
  def,
  value,
  onChange,
  busy,
}: {
  def: SettingDefinition;
  value: string | null;
  onChange: (next: string | null) => void;
  busy: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex max-w-sm items-center gap-2">
      <input
        type={shown ? "text" : "password"}
        defaultValue={value ?? ""}
        onBlur={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        disabled={busy}
        placeholder={value ? "(hidden — type to replace)" : "(empty)"}
        aria-label={def.label}
        className="flex-1 rounded-md border border-border bg-white px-2 py-1 font-mono text-xs text-text disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="text-[11px] text-muted hover:text-text"
      >
        {shown ? "hide" : "show"}
      </button>
    </div>
  );
}
