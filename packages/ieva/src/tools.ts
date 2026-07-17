import type { AnySchema } from "./schema.ts";
import { KIND } from "./types.ts";
import type { DisabledTool, ToolContext, ToolDefinition } from "./types.ts";

/**
 * Define a tool. Authored at `agent/tools/<name>.ts` as the default export; the
 * filename (snake_case ASCII) becomes the model-facing tool name.
 *
 * Tools run in the trusted runtime with access to `fetch` and host-provided config,
 * not in the sandbox. Reach the sandbox via `ctx.getSandbox()`.
 */
export function defineTool<
  Schema extends AnySchema,
  Out extends AnySchema | undefined = undefined,
>(
  config: Omit<ToolDefinition<Schema, Out>, typeof KIND>,
): ToolDefinition<Schema, Out> {
  return { ...config, [KIND]: "tool" };
}

/** Disable a built-in tool by authoring `agent/tools/<builtin>.ts` that exports this. */
export function disableTool(): DisabledTool {
  return { [KIND]: "tool-disabled" };
}

export type { ToolContext, ToolDefinition, DisabledTool } from "./types.ts";
export type { ModelToolOutput } from "./types.ts";
