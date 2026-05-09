// SPDX-License-Identifier: MIT
//
// v2 setting registry — in-memory aggregate of every SettingDefinition
// declared by installed apps + modules + the framework itself. The
// host shell pulls this via GET /api/admin/settings/manifest to
// auto-render the Settings → General tab; the PATCH handler validates
// incoming values against it.
//
// See task_17_tenant_settings_manifest.md for the design.

import type { SettingDefinition } from "@boringos/shared";

export interface SettingRegistry {
  /** Register a setting from a specific owner (module/app/framework). */
  register(
    ownerKind: "app" | "module" | "framework",
    ownerId: string,
    def: SettingDefinition,
  ): void;
  /** Every registered setting. */
  list(): readonly SettingDefinition[];
  /** Lookup by storage key. */
  get(key: string): SettingDefinition | undefined;
  /** Settings declared by one specific owner. */
  byOwner(ownerKind: "app" | "module" | "framework", ownerId: string): readonly SettingDefinition[];
  /**
   * Validate an incoming raw value against a key's definition.
   * Returns null on success, or a human-readable error string.
   * Unknown keys: returns null (the registry is permissive — a host
   * may store ad-hoc keys not declared by any module).
   */
  validateValue(key: string, value: unknown): string | null;
  /**
   * Map of key → string-serialised default value, for the UI to fall
   * back to when no row exists. Booleans become "true"/"false";
   * numbers stringify; secrets never carry a default.
   */
  defaults(): Record<string, string>;
  /** Drop every setting registered to this owner — used on uninstall. */
  unregisterOwner(ownerKind: "app" | "module" | "framework", ownerId: string): void;
}

export function createSettingRegistry(): SettingRegistry {
  const entries: SettingDefinition[] = [];

  const isOwner = (def: SettingDefinition, kind: string, id: string) =>
    def.ownerKind === kind && def.ownerId === id;

  return {
    register(ownerKind, ownerId, def) {
      const merged: SettingDefinition = {
        ...def,
        ownerKind,
        ownerId,
      };
      // Replace if same key already registered (last writer wins).
      const idx = entries.findIndex((e) => e.key === def.key);
      if (idx >= 0) entries[idx] = merged;
      else entries.push(merged);
    },

    list() {
      return [...entries];
    },

    get(key) {
      return entries.find((e) => e.key === key);
    },

    byOwner(kind, id) {
      return entries.filter((e) => isOwner(e, kind, id));
    },

    validateValue(key, value) {
      const def = entries.find((e) => e.key === key);
      if (!def) return null; // permissive on unknown keys
      switch (def.type) {
        case "boolean":
          if (
            value === true ||
            value === false ||
            value === "true" ||
            value === "false"
          ) {
            return null;
          }
          return `${key} expects boolean, got ${typeof value}`;
        case "number":
          if (typeof value === "number" && Number.isFinite(value)) return null;
          if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
            return null;
          }
          return `${key} expects number`;
        case "select": {
          if (!def.options || def.options.length === 0) {
            return `${key} declared as select but has no options`;
          }
          const ok = def.options.some((o) => o.value === value);
          if (!ok) {
            return `${key} expects one of: ${def.options.map((o) => o.value).join(", ")}`;
          }
          return null;
        }
        case "string":
        case "longtext":
        case "secret":
          if (typeof value === "string") return null;
          return `${key} expects string`;
        default:
          return null;
      }
    },

    defaults() {
      const out: Record<string, string> = {};
      for (const e of entries) {
        if (e.default === undefined) continue;
        if (e.type === "secret") continue; // never expose secret defaults
        out[e.key] = String(e.default);
      }
      return out;
    },

    unregisterOwner(kind, id) {
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (isOwner(entries[i]!, kind, id)) entries.splice(i, 1);
      }
    },
  };
}
