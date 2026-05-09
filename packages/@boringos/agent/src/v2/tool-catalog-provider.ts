// SPDX-License-Identifier: MIT
//
// v2 tool-catalog provider — emits the `## Available tools`
// section of the agent's system prompt by walking the
// ToolRegistry.
//
// Phase 3 of task_12. The framework SKILL.md (added in Phase 4)
// teaches the calling convention once; this provider just lists
// the inventory.

import type { ContextProvider, ContextBuildEvent } from "../types.js";
import type { ToolRegistry } from "./tool-registry.js";

export interface ToolCatalogProviderDeps {
  registry: ToolRegistry;
  /**
   * Provider priority. Default 75 — same slot as v1's
   * connector-actions-catalog (which it partially overlaps with;
   * cutover removes the v1 provider).
   */
  priority?: number;
}

export function createToolCatalogProvider(
  deps: ToolCatalogProviderDeps,
): ContextProvider {
  return {
    name: "v2-tool-catalog",
    phase: "system",
    priority: deps.priority ?? 75,

    async provide(_event: ContextBuildEvent): Promise<string | null> {
      const tools = deps.registry.list();
      if (tools.length === 0) return null;

      const lines: string[] = [
        "## Available tools",
        "",
        "Every tool is callable at `POST $BORINGOS_CALLBACK_URL/api/tools/<name>` " +
          "with `Authorization: Bearer $BORINGOS_CALLBACK_TOKEN`. The body must " +
          "be JSON matching the tool's input schema; the response is " +
          "`{ \"ok\": true, \"result\": ... }` or `{ \"ok\": false, \"error\": { ... } }`.",
        "",
      ];

      // Group by module for readability.
      type Entry = (typeof tools)[number];
      const byModule = new Map<string, Entry[]>();
      for (const entry of tools) {
        const list = byModule.get(entry.moduleId) ?? [];
        list.push(entry);
        byModule.set(entry.moduleId, list);
      }

      for (const [moduleId, entries] of byModule) {
        lines.push(`### ${moduleId}`);
        for (const entry of entries) {
          lines.push(`- \`${entry.fullName}\` — ${entry.tool.description}`);
        }
        lines.push("");
      }
      return lines.join("\n").trimEnd();
    },
  };
}
