/**
 * Publish the host's single `ieva` runtime instance to a global, so compiled agent
 * modules (loaded as blob URLs) re-export from the SAME modules the harness uses. This
 * is what makes `defineState` correct — one shared context register, not two copies.
 *
 * The keys here must match the subpaths the esbuild loader shims (DEFAULT_IEVA_EXPORTS).
 */
import * as ieva from "ieva";
import * as context from "ieva/context";
import * as hooks from "ieva/hooks";
import * as instructions from "ieva/instructions";
import * as sandbox from "ieva/sandbox";
import * as skills from "ieva/skills";
import * as approval from "ieva/tools/approval";
import * as tools from "ieva/tools";

export const IEVA_RUNTIME_GLOBAL = "__IEVA_RUNTIME__";

export function installRuntimeGlobal(): void {
  (globalThis as Record<string, unknown>)[IEVA_RUNTIME_GLOBAL] = {
    ieva,
    "ieva/tools": tools,
    "ieva/tools/approval": approval,
    "ieva/skills": skills,
    "ieva/instructions": instructions,
    "ieva/hooks": hooks,
    "ieva/sandbox": sandbox,
    "ieva/context": context,
  };
}
