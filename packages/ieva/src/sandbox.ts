import { KIND } from "./types.ts";
import type { SandboxDefinition } from "./types.ts";

/**
 * Configure the agent's sandbox. Authored at `agent/sandbox.ts` (definition-only) or
 * `agent/sandbox/sandbox.ts` (alongside `agent/sandbox/workspace/**` seed files).
 *
 * `bootstrap` runs once per template (keyed by `revalidationKey`); `onSession` runs
 * per durable session for credentials and network policy.
 */
export function defineSandbox(
  config: Omit<SandboxDefinition, typeof KIND>,
): SandboxDefinition {
  return { ...config, [KIND]: "sandbox" };
}

export type {
  SandboxDefinition,
  SandboxHandle,
  SandboxNetworkPolicy,
  SandboxRunResult,
} from "./types.ts";
