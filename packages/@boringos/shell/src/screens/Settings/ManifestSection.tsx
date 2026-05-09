// SPDX-License-Identifier: BUSL-1.1
//
// Auto-renders the tenant settings manifest in the Settings → General
// tab. Groups by ownerId so each module/app gets its own subsection.

import { useMemo } from "react";
import { useSettings, useSettingsManifest } from "@boringos/ui";
import type { SettingDefinition } from "@boringos/ui";

import { SettingInput } from "./SettingInput.js";

export function ManifestSection() {
  const { manifest, isLoading: manifestLoading } = useSettingsManifest();
  const { settings, updateSettings, isUpdating } = useSettings();

  const groups = useMemo(() => {
    const byOwner = new Map<string, SettingDefinition[]>();
    for (const def of manifest.settings) {
      const ownerKey = `${def.ownerKind ?? "framework"}:${def.ownerId ?? "framework"}`;
      let bucket = byOwner.get(ownerKey);
      if (!bucket) {
        bucket = [];
        byOwner.set(ownerKey, bucket);
      }
      bucket.push(def);
    }
    return [...byOwner.entries()]
      .map(([k, defs]) => {
        const [kind, id] = k.split(":");
        return { kind: kind ?? "framework", id: id ?? "framework", defs };
      })
      .sort((a, b) => {
        // Framework first, then modules alphabetically.
        if (a.kind !== b.kind) return a.kind === "framework" ? -1 : 1;
        return a.id.localeCompare(b.id);
      });
  }, [manifest.settings]);

  if (manifestLoading) {
    return <div className="text-xs text-muted">Loading settings…</div>;
  }
  if (manifest.settings.length === 0) {
    return null; // legitimate when no modules contribute settings
  }

  const handleChange = async (key: string, next: string | null) => {
    await updateSettings({ [key]: next });
  };

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={`${g.kind}:${g.id}`}>
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">
            {g.kind === "framework" ? "Framework" : g.id}
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-white">
            <ul className="divide-y divide-border-subtle">
              {g.defs.map((def) => (
                <li key={def.key} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text">{def.label}</div>
                    {def.description && (
                      <p className="mt-0.5 text-xs text-muted">{def.description}</p>
                    )}
                    <div className="mt-1 font-mono text-[10px] text-muted">
                      {def.key}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <SettingInput
                      def={def}
                      value={settings[def.key] ?? null}
                      onChange={(next) => void handleChange(def.key, next)}
                      busy={isUpdating}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
