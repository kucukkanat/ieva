import { KIND } from "./types.ts";
import type {
  AgentDefinition,
  DynamicModel,
  DynamicResolver,
  DynamicScope,
} from "./types.ts";

/**
 * Define an agent's runtime config. Authored at `agent/agent.ts` as the default export.
 *
 * Identity is NOT set here — the root agent's name comes from `package.json#name`
 * (falling back to the directory name), and a subagent's name comes from its directory.
 */
export function defineAgent(
  config: Omit<AgentDefinition, typeof KIND>,
): AgentDefinition {
  return { ...config, [KIND]: "agent" };
}

/**
 * A model that resolves per session/turn/step. Precedence at resolve time is
 * step > turn > session > fallback. Resolver failures degrade to the fallback and
 * never fail the turn.
 */
export function defineDynamic(config: {
  fallback: string;
  events: Partial<Record<DynamicScope, DynamicResolver>>;
}): DynamicModel {
  return {
    kind: "dynamic-model",
    fallback: config.fallback,
    events: config.events,
  } as DynamicModel;
}

export { KIND } from "./types.ts";
export type {
  AgentDefinition,
  AgentLimits,
  HookDefinition,
  ModelReference,
  ReasoningEffort,
  SessionInfo,
  SkillDefinition,
  ToolDefinition,
} from "./types.ts";
