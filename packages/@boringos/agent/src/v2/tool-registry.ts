// SPDX-License-Identifier: MIT
//
// v2 tool registry — in-memory store of registered Tools.
//
// Phase 1 of the rebuild ships only registration + lookup +
// listing. Dispatch (Zod validation, audit, HTTP mounting) is
// added in subsequent phases. See task_12 §17 for the sequence.
//
// Greenfield additive — does not replace the v1 ConnectorRegistry
// or any existing handler. Lives under `src/v2/` so v1 imports
// are untouched.

import type { Tool } from "@boringos/module-sdk";

/**
 * Tool registry. Tools are addressed by their fully-qualified
 * name `<module-id>.<tool-name>` once a Module registers them.
 *
 * Phase 1 contract:
 *  - `register` adds a tool keyed on its full name.
 *  - `get` returns the tool or `undefined`.
 *  - `list` returns every registered tool in registration order.
 *  - `listByModule` returns tools for a single Module id.
 *  - `listByCapability` (future) — placeholder for capability
 *    discovery in Phase 5; throws today.
 */
export interface ToolRegistry {
  register(moduleId: string, tool: Tool): void;
  get(fullName: string): Tool | undefined;
  list(): readonly RegisteredTool[];
  listByModule(moduleId: string): readonly RegisteredTool[];
  /** Reserved for capability resolution; not implemented in
   * Phase 1. Throws if called. */
  listByCapability(capability: string): readonly RegisteredTool[];
  /** Remove every tool registered by this Module. Used at
   * uninstall. */
  unregisterModule(moduleId: string): void;
}

/**
 * A Tool plus its owning Module's id. Returned from registry
 * lookups so callers can inspect both pieces.
 */
export interface RegisteredTool {
  moduleId: string;
  fullName: string;
  tool: Tool;
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();

  const fqName = (moduleId: string, toolName: string) =>
    `${moduleId}.${toolName}`;

  return {
    register(moduleId, tool) {
      const fullName = fqName(moduleId, tool.name);
      if (tools.has(fullName)) {
        throw new Error(
          `Tool "${fullName}" already registered. Each tool name ` +
            "must be unique within its Module.",
        );
      }
      tools.set(fullName, { moduleId, fullName, tool });
    },

    get(fullName) {
      return tools.get(fullName)?.tool;
    },

    list() {
      return Array.from(tools.values());
    },

    listByModule(moduleId) {
      return Array.from(tools.values()).filter(
        (entry) => entry.moduleId === moduleId,
      );
    },

    listByCapability() {
      throw new Error(
        "listByCapability is reserved for Phase 5 (capability " +
          "resolution). Not available in Phase 1.",
      );
    },

    unregisterModule(moduleId) {
      for (const [fullName, entry] of tools.entries()) {
        if (entry.moduleId === moduleId) tools.delete(fullName);
      }
    },
  };
}
