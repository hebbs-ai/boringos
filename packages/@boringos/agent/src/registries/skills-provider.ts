// SPDX-License-Identifier: AGPL-3.0-or-later
//
// skills provider — emits the `## Skills` section of the
// agent's system prompt by walking the SkillRegistry.
//
// Phase 3 of task_12. Registered
// providers when modules are present. Doesn't replace any
// provider yet (the existing memory-skill / drive-skill / etc.
// providers continue to emit their content). Cutover removes the
//  providers; until then the prompt may carry both.

import type { ContextProvider, ContextBuildEvent } from "../types.js";
import type { SkillRegistry } from "./skill-registry.js";

export interface SkillsProviderDeps {
  registry: SkillRegistry;
  /**
   * Provider priority. Default 80 — between approvals-skill (70)
   * and api-catalog (110), so skills land in the same band as
   * 's hand-written skill providers.
   */
  priority?: number;
}

export function createSkillsProvider(deps: SkillsProviderDeps): ContextProvider {
  return {
    name: "skills",
    phase: "system",
    priority: deps.priority ?? 80,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      const skills = deps.registry.listApplicable({
        tenantId: event.tenantId,
        agentId: event.agent.id,
        agentRole: event.agent.role,
        taskId: event.taskId,
        taskOriginKind: event.taskOriginKind,
      });
      if (skills.length === 0) return null;

      const lines: string[] = ["## Skills", ""];
      for (const entry of skills) {
        lines.push(`### ${entry.skill.id}`);
        lines.push(entry.skill.body.trim());
        lines.push("");
      }
      return lines.join("\n").trimEnd();
    },
  };
}
