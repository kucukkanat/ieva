import { KIND } from "./types.ts";
import type { InstructionsDefinition } from "./types.ts";

/**
 * Define instructions in code. Authored at `agent/instructions.ts`. The module runs
 * ONCE at build time; the resulting markdown is captured into the manifest and the
 * runtime never re-runs it.
 */
export function defineInstructions(
  config: Omit<InstructionsDefinition, typeof KIND>,
): InstructionsDefinition {
  return { ...config, [KIND]: "instructions" };
}

export type { InstructionsDefinition } from "./types.ts";
