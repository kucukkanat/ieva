import type {
  AgentLimits,
  HookDefinition,
  ModelReference,
  SandboxHandle,
  ToolDefinition,
} from "../types.ts";

/**
 * A discovered manifest whose module-backed slots have been compiled and imported.
 * This is what the compiler hands the harness; in tests it is constructed directly
 * with plain functions, keeping the loop testable without a bundler.
 */
export interface LoadedAgent {
  readonly name: string;
  /** Fully assembled base instructions (root flat file + directory sources joined). */
  readonly instructions: string;
  readonly model: ModelReference;
  readonly tools: Map<string, ToolDefinition>;
  /** Tool names explicitly disabled via `disableTool()`. */
  readonly disabledTools: ReadonlySet<string>;
  readonly skills: Map<string, LoadedSkill>;
  readonly hooks: HookDefinition[];
  readonly subagents: Map<string, LoadedAgent>;
  readonly compaction: { readonly thresholdPercent: number } | false;
  readonly limits: AgentLimits;
  /** Opens (or reattaches) the single sandbox for this session, if configured. */
  readonly openSandbox?: () => Promise<SandboxHandle>;
}

export interface LoadedSkill {
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
  readonly files: Readonly<Record<string, string>>;
}
