// SPDX-License-Identifier: MIT
//
// v2 skills provider — emits the `## Skills` section of the
// agent's system prompt by walking the SkillRegistry.
//
// Phase 3 of task_12. Additive: registered alongside v1's
// providers when v2 modules are present. Doesn't replace any v1
// provider yet (the existing memory-skill / drive-skill / etc.
// providers continue to emit their content). Cutover removes the
// v1 providers; until then the prompt may carry both.

import type { ContextProvider, ContextBuildEvent } from "../types.js";
import type { SkillRegistry } from "./skill-registry.js";

export interface SkillsProviderDeps {
  registry: SkillRegistry;
  /**
   * Provider priority. Default 80 — between approvals-skill (70)
   * and api-catalog (110), so v2 skills land in the same band as
   * v1's hand-written skill providers.
   */
  priority?: number;
}

export function createSkillsProvider(deps: SkillsProviderDeps): ContextProvider {
  return {
    name: "v2-skills",
    phase: "system",
    priority: deps.priority ?? 80,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      const skills = deps.registry.listApplicable({
        tenantId: event.tenantId,
        agentId: event.agent.id,
        agentRole: event.agent.role,
        taskId: event.taskId,
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
