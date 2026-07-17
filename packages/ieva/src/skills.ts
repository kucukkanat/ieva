import { KIND } from "./types.ts";
import type { SkillDefinition } from "./types.ts";

/**
 * Define a skill in code. Authored at `agent/skills/<name>.ts`. The framework
 * generates a `SKILL.md` from `markdown` and materializes each `files` entry as a
 * package-relative sibling.
 *
 * Loading a skill adds instructions to the active turn — never a new execution
 * surface. Tools stay visible whether a skill is loaded or not.
 */
export function defineSkill(
  config: Omit<SkillDefinition, typeof KIND>,
): SkillDefinition {
  return { ...config, [KIND]: "skill" };
}

export type { SkillDefinition, SkillHandle } from "./types.ts";
