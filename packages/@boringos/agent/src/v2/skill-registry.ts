// SPDX-License-Identifier: MIT
//
// v2 skill registry — in-memory store of loaded Skills.
//
// A Skill is markdown that lands in the agent's prompt under the
// `## Skills` section. Skills come from multiple sources (Module
// SKILL.md, persona, agent instructions, tenant override); the
// registry holds them all uniformly.
//
// Phase 1 ships register + list + filter. Prompt assembly (the
// actual `skills` context provider) is added in Phase 3.

import type { Skill, SkillApplicabilityEvent } from "@boringos/module-sdk";

export interface SkillRegistry {
  register(moduleId: string, skill: Skill): void;
  list(): readonly RegisteredSkill[];
  /** Skills for a Module id, sorted by priority ascending. */
  listByModule(moduleId: string): readonly RegisteredSkill[];
  /** Skills that apply to the given event, ordered by priority. */
  listApplicable(event: SkillApplicabilityEvent): readonly RegisteredSkill[];
  unregisterModule(moduleId: string): void;
}

export interface RegisteredSkill {
  moduleId: string;
  skill: Skill;
}

export function createSkillRegistry(): SkillRegistry {
  const skills: RegisteredSkill[] = [];

  const sortByPriority = (a: RegisteredSkill, b: RegisteredSkill) => {
    const pa = a.skill.priority ?? 100;
    const pb = b.skill.priority ?? 100;
    return pa - pb;
  };

  return {
    register(moduleId, skill) {
      skills.push({ moduleId, skill });
    },

    list() {
      return [...skills].sort(sortByPriority);
    },

    listByModule(moduleId) {
      return skills
        .filter((entry) => entry.moduleId === moduleId)
        .sort(sortByPriority);
    },

    listApplicable(event) {
      return skills
        .filter((entry) => {
          const test = entry.skill.appliesTo;
          return test ? test(event) : true;
        })
        .sort(sortByPriority);
    },

    unregisterModule(moduleId) {
      for (let i = skills.length - 1; i >= 0; i -= 1) {
        if (skills[i].moduleId === moduleId) skills.splice(i, 1);
      }
    },
  };
}
