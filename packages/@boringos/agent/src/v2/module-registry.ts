// SPDX-License-Identifier: MIT
//
// v2 module registry — knows which Modules the host has
// registered, walks their tools + skills + routines into the
// per-domain registries, and exposes capability resolution.
//
// Phase 1 contract:
//  - `register` records a Module and forwards its tools/skills
//    into the supplied registries.
//  - `get` / `list` for lookup.
//  - `byCapability` answers capability resolution queries.
//  - `unregister` removes everything the Module pushed.
//
// Per-tenant install state (which Modules are turned on for which
// tenant) lives in the DB, not here. This registry is the
// host-process catalog of Modules the host application has
// imported.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { Module, Skill } from "@boringos/module-sdk";
import type { ToolRegistry } from "./tool-registry.js";
import type { SkillRegistry } from "./skill-registry.js";

/**
 * Parse minimal YAML frontmatter at the start of a markdown
 * string. Recognised keys (all optional):
 *   id: <string>
 *   priority: <number>
 *   roles: [role1, role2]      (becomes appliesTo gating)
 *   requires: [tool.name, ...]
 * The body is everything after the closing `---` marker; if no
 * frontmatter is present, the whole string is the body.
 */
function parseSkillFile(
  raw: string,
  fallbackId: string,
): {
  id: string;
  body: string;
  priority?: number;
  appliesTo?: Skill["appliesTo"];
  requires?: string[];
} {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return { id: fallbackId, body: raw.trim() };
  }
  const fmText = match[1];
  const body = match[2].trim();
  const meta: Record<string, unknown> = {};
  for (const line of fmText.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    // Array form: roles: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (/^\d+$/.test(value)) {
      meta[key] = Number(value);
    } else {
      // Strip surrounding quotes if present.
      meta[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
  const id = typeof meta.id === "string" ? meta.id : fallbackId;
  const priority = typeof meta.priority === "number" ? meta.priority : undefined;
  const requires = Array.isArray(meta.requires) ? (meta.requires as string[]) : undefined;
  const roles = Array.isArray(meta.roles) ? (meta.roles as string[]) : undefined;
  const appliesTo: Skill["appliesTo"] | undefined = roles
    ? (event) => Boolean(event.agentRole && roles.includes(event.agentRole))
    : undefined;
  return { id, body, priority, appliesTo, requires };
}

export interface ModuleRegistry {
  register(mod: Module): void;
  get(id: string): Module | undefined;
  list(): readonly Module[];
  byCapability(capability: string): readonly Module[];
  unregister(id: string): void;
}

export interface ModuleRegistryDeps {
  tools: ToolRegistry;
  skills: SkillRegistry;
}

export function createModuleRegistry(deps: ModuleRegistryDeps): ModuleRegistry {
  const modules = new Map<string, Module>();

  return {
    register(mod) {
      if (modules.has(mod.id)) {
        throw new Error(
          `Module "${mod.id}" already registered. Module ids must ` +
            "be unique within a host process.",
        );
      }

      // Phase 9 capability resolution — validate dependencies
      // before accepting the registration. We check against
      // already-registered modules; that means dependents must
      // be registered AFTER their concrete deps. Capability deps
      // are looser (any provider satisfies them), so order
      // matters less but the check is still in registration
      // order.
      for (const dep of mod.dependsOn ?? []) {
        if (dep.optional) continue;
        if ("moduleId" in dep) {
          if (!modules.has(dep.moduleId)) {
            throw new Error(
              `Module "${mod.id}" requires "${dep.moduleId}", but that ` +
                "module isn't registered. Register dependencies first.",
            );
          }
        } else {
          const providers = Array.from(modules.values()).filter((m) =>
            (m.provides ?? []).includes(dep.capability),
          );
          if (providers.length === 0) {
            throw new Error(
              `Module "${mod.id}" requires capability "${dep.capability}", ` +
                "but no registered module provides it. Register a provider first " +
                "or mark the dependency as optional.",
            );
          }
        }
      }

      modules.set(mod.id, mod);

      for (const tool of mod.tools ?? []) {
        deps.tools.register(mod.id, tool);
      }

      for (const skillRef of mod.skills ?? []) {
        if (typeof skillRef === "string") {
          // Disk loading: read the file relative to the module's
          // home dir (set by the factory via __moduleDir), parse
          // YAML frontmatter, build a Skill record. If the file
          // can't be read, log + skip — better than crashing the
          // whole boot. Modules that ship SKILL.md files should
          // set __moduleDir; if missing, we fall back to cwd.
          const baseDir = mod.__moduleDir ?? process.cwd();
          const path = resolvePath(baseDir, skillRef);
          let raw: string;
          try {
            raw = readFileSync(path, "utf8");
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(
              `[v2-module-registry] failed to read skill file ${path} for module ${mod.id}:`,
              e instanceof Error ? e.message : e,
            );
            continue;
          }
          const parsed = parseSkillFile(raw, `${mod.id}.skill`);
          deps.skills.register(mod.id, {
            id: parsed.id,
            source: "module",
            body: parsed.body,
            priority: parsed.priority,
            appliesTo: parsed.appliesTo,
            requires: parsed.requires,
          });
          continue;
        }
        deps.skills.register(mod.id, skillRef);
      }
    },

    get(id) {
      return modules.get(id);
    },

    list() {
      return Array.from(modules.values());
    },

    byCapability(capability) {
      return Array.from(modules.values()).filter((mod) =>
        (mod.provides ?? []).includes(capability),
      );
    },

    unregister(id) {
      const mod = modules.get(id);
      if (!mod) return;
      deps.tools.unregisterModule(id);
      deps.skills.unregisterModule(id);
      modules.delete(id);
    },
  };
}
