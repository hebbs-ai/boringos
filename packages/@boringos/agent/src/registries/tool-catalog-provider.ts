// SPDX-License-Identifier: AGPL-3.0-or-later
//
// tool-catalog provider — emits the `## Available tools`
// section of the agent's system prompt by walking the
// ToolRegistry.
//
// Phase 3 of task_12. The framework SKILL.md (added in Phase 4)
// teaches the calling convention once; this provider just lists
// the inventory.

import type { ContextProvider, ContextBuildEvent } from "../types.js";
import type { ToolRegistry } from "./tool-registry.js";

/**
 * task_24 — tool names hidden from the agent's prompt even when
 * they're registered. Agents have direct filesystem access to the
 * same on-disk endpoint these tools wrap, so exposing them creates
 * a temptation path: the agent picks the HTTP tool (description in
 * prompt) over the equivalent Write/Read/Grep on `./drive/`. The
 * tools stay registered and dispatchable for non-agent callers
 * (the shell UI, scripts, webhooks, future remote backends) —
 * they just don't appear in the catalog the agent reads.
 */
const HIDDEN_FROM_AGENT_PROMPT: ReadonlySet<string> = new Set([
  "memory.remember",
  "memory.recall",
  "memory.forget",
]);

export interface ToolCatalogProviderDeps {
  registry: ToolRegistry;
  /**
   * Provider priority. Default 75 — same slot as 's
   * connector-actions-catalog (which it partially overlaps with;
   * cutover removes the  provider).
   */
  priority?: number;
}

export function createToolCatalogProvider(
  deps: ToolCatalogProviderDeps,
): ContextProvider {
  return {
    name: "tool-catalog",
    phase: "system",
    priority: deps.priority ?? 75,

    async provide(_event: ContextBuildEvent): Promise<string | null> {
      const tools = deps.registry
        .list()
        .filter((entry) => !HIDDEN_FROM_AGENT_PROMPT.has(entry.fullName));
      if (tools.length === 0) return null;

      const lines: string[] = [
        "## Available tools",
        "",
        "Every tool is callable at `POST $BORINGOS_CALLBACK_URL/api/tools/<name>` " +
          "with `Authorization: Bearer $BORINGOS_CALLBACK_TOKEN`. The body must " +
          "be JSON matching the tool's input schema; the response is " +
          "`{ \"ok\": true, \"result\": ... }` or `{ \"ok\": false, \"error\": { ... } }`.",
        "",
        "**Auth check — DO NOT introspect env vars.** Both " +
          "`$BORINGOS_CALLBACK_URL` and `$BORINGOS_CALLBACK_TOKEN` are " +
          "always set when you wake. Use them directly via shell " +
          "interpolation inside `curl`. Do **not** run `printenv` or " +
          "`env | grep TOKEN` to \"verify\" — some runtimes (Pi, etc.) " +
          "deliberately redact secrets from those commands and report " +
          "them as empty, which is misleading. The token IS available " +
          "to shell interpolation. If a tool call returns HTTP 401, " +
          "THEN escalate; otherwise just attempt the call.",
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
