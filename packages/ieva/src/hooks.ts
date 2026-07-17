import { KIND } from "./types.ts";
import type { HookDefinition } from "./types.ts";

/**
 * Define lifecycle/stream-event subscribers. Authored at `agent/hooks/<slug>.ts`.
 *
 * Hooks are OBSERVE-ONLY: return values are ignored and they cannot block or modify
 * execution — they run after events are durably recorded. A throwing hook surfaces
 * as `turn.failed`. Supports a `"*"` wildcard handler.
 */
export function defineHook(
  config: Omit<HookDefinition, typeof KIND>,
): HookDefinition {
  return { ...config, [KIND]: "hook" };
}

export type { HookContext, HookDefinition, HookEvent, HookHandler } from "./types.ts";
