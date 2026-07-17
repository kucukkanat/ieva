/**
 * The output of discovery: a static description of an agent directory, produced
 * WITHOUT executing any authored code. Module-backed slots carry a `modulePath`
 * that the compiler later turns into a runnable ES module.
 */
export interface AgentManifest {
  readonly name: string;
  readonly root: string;
  readonly isSubagent: boolean;
  /** Present only when agent.ts exists. */
  readonly agentModule?: string;
  /** Ordered instruction sources; flat root file first, then sorted directory entries. */
  readonly instructions: InstructionSource[];
  readonly tools: ToolEntry[];
  readonly skills: SkillEntry[];
  readonly hooks: HookEntry[];
  readonly subagents: AgentManifest[];
  readonly sandbox?: SandboxEntry;
  readonly diagnostics: Diagnostic[];
}

export interface InstructionSource {
  readonly kind: "markdown" | "module";
  readonly path: string;
}

export interface ToolEntry {
  readonly name: string;
  readonly modulePath: string;
}

export type SkillEntry =
  | { readonly name: string; readonly kind: "flat"; readonly description: string; readonly path: string }
  | { readonly name: string; readonly kind: "packaged"; readonly description: string; readonly path: string; readonly dir: string }
  | { readonly name: string; readonly kind: "module"; readonly description?: string; readonly modulePath: string };

export interface HookEntry {
  readonly name: string;
  readonly modulePath: string;
}

export interface SandboxEntry {
  /** Present when a sandbox.ts / sandbox/sandbox.ts config exists. */
  readonly modulePath?: string;
  /** Files under sandbox/workspace/** to seed into /workspace at bootstrap. */
  readonly workspaceSeeds: string[];
}

export type Severity = "error" | "warning";

export interface Diagnostic {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export function hasErrors(manifest: AgentManifest): boolean {
  return (
    manifest.diagnostics.some((d) => d.severity === "error") ||
    manifest.subagents.some(hasErrors)
  );
}

/** Flatten diagnostics across the whole tree with agent names attached. */
export function allDiagnostics(
  manifest: AgentManifest,
): Array<Diagnostic & { agent: string }> {
  return [
    ...manifest.diagnostics.map((d) => ({ ...d, agent: manifest.name })),
    ...manifest.subagents.flatMap(allDiagnostics),
  ];
}
