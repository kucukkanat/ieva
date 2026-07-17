import type { AnySchema, InferInput, InferOutput } from "./schema.ts";

/**
 * A brand attached to every `define*` result so discovery can tell what a module's
 * default export is without executing intent. Identity (name/id) is NEVER on these
 * objects — it comes from the file path, exactly as in eve.
 */
export const KIND = Symbol.for("ieva.kind");

export type Kind =
  | "agent"
  | "tool"
  | "tool-disabled"
  | "skill"
  | "instructions"
  | "hook"
  | "sandbox";

export interface Branded<K extends Kind> {
  readonly [KIND]: K;
}

// ─── Models ──────────────────────────────────────────────────────────────────

/**
 * A gateway-style model id (`"anthropic/claude-sonnet-5"`), an AI SDK LanguageModel
 * object, or a dynamic resolver. In the browser the id string is resolved by the
 * host-provided model registry (BYOK cloud or a local web-llm provider).
 */
export type ModelReference = string | LanguageModelLike | DynamicModel;

/** Structural stand-in for an AI SDK LanguageModelV2/V3 — avoids a hard type dep. */
export interface LanguageModelLike {
  readonly specificationVersion: string;
  readonly modelId: string;
  readonly provider: string;
}

export interface DynamicModel extends Branded<never> {
  readonly kind: "dynamic-model";
  readonly fallback: string;
  readonly events: Partial<Record<DynamicScope, DynamicResolver>>;
}

export type DynamicScope = "session.started" | "turn.started" | "step.started";
export type DynamicResolver = (
  event: unknown,
  ctx: DynamicContext,
) => ModelReference | null | Promise<ModelReference | null>;

export interface DynamicContext {
  readonly session: SessionInfo;
}

export type ReasoningEffort =
  | "provider-default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface AgentDefinition extends Branded<"agent"> {
  /** Required when `agent.ts` exists; defaults to `anthropic/claude-sonnet-5` when absent. */
  readonly model?: ModelReference;
  /** Required on subagents only — the parent reads it to decide whether to delegate. */
  readonly description?: string;
  readonly reasoning?: ReasoningEffort;
  readonly modelOptions?: Record<string, unknown>;
  readonly compaction?: { readonly thresholdPercent: number } | false;
  readonly limits?: AgentLimits;
  readonly outputSchema?: AnySchema;
}

export interface AgentLimits {
  readonly maxInputTokensPerSession?: number | false;
  readonly maxOutputTokensPerSession?: number | false;
  readonly maxSteps?: number;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export type ToolApproval =
  | { readonly mode: "never" }
  | { readonly mode: "once" }
  | { readonly mode: "always" }
  | { readonly policy: ApprovalPolicy };

export type ApprovalDecision =
  | "user-approval"
  | "not-applicable"
  | "approved"
  | "denied";
export type ApprovalPolicy = (input: {
  readonly session: SessionInfo;
  readonly toolName: string;
  readonly toolInput: unknown;
}) => ApprovalDecision | Promise<ApprovalDecision>;

export type ModelToolOutput =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "json"; readonly value: unknown };

export interface ToolDefinition<
  Schema extends AnySchema = AnySchema,
  Out extends AnySchema | undefined = AnySchema | undefined,
> extends Branded<"tool"> {
  readonly description: string;
  readonly inputSchema: Schema;
  readonly outputSchema?: Out;
  readonly approval?: ToolApproval;
  readonly execute: (
    input: InferInput<Schema>,
    ctx: ToolContext,
  ) => ToolReturn<Out> | Promise<ToolReturn<Out>>;
  readonly toModelOutput?: (output: ToolReturn<Out>) => ModelToolOutput;
}

export type ToolReturn<Out extends AnySchema | undefined> = Out extends AnySchema
  ? InferOutput<Out>
  : unknown;

export interface DisabledTool extends Branded<"tool-disabled"> {}

export interface ToolContext {
  readonly session: SessionInfo;
  readonly callId: string;
  /** The final runtime name the model called, including any `<connection>__<tool>` qualifier. */
  readonly toolName: string;
  readonly abortSignal: AbortSignal;
  readonly getSandbox: () => Promise<SandboxHandle>;
  readonly getSkill: (id: string) => SkillHandle;
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export interface SkillDefinition extends Branded<"skill"> {
  /** A routing hint written as the task that should trigger activation. */
  readonly description: string;
  readonly markdown: string;
  /** Bundled sibling files, keyed by package-relative path. */
  readonly files?: Readonly<Record<string, string>>;
}

export interface SkillHandle {
  readonly name: string;
  readonly file: (relativePath: string) => { text: () => Promise<string> };
}

// ─── Instructions ──────────────────────────────────────────────────────────────

export interface InstructionsDefinition extends Branded<"instructions"> {
  readonly markdown: string;
}

// ─── Hooks (observe-only) ──────────────────────────────────────────────────────

export interface HookDefinition extends Branded<"hook"> {
  readonly events: Partial<Record<string, HookHandler>> & {
    readonly ["*"]?: HookHandler;
  };
}

export type HookHandler = (
  event: HookEvent,
  ctx: HookContext,
) => void | Promise<void>;

export interface HookEvent {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export interface HookContext {
  readonly agent: { readonly name: string; readonly nodeId?: string };
  readonly session: { readonly id: string };
}

// ─── Sandbox ─────────────────────────────────────────────────────────────────

export interface SandboxDefinition extends Branded<"sandbox"> {
  readonly bootstrap?: (args: { use: () => Promise<SandboxHandle> }) => Promise<void>;
  readonly onSession?: (args: {
    use: (opts?: { networkPolicy?: SandboxNetworkPolicy }) => Promise<SandboxHandle>;
  }) => Promise<void>;
  readonly revalidationKey?: () => string;
}

export type SandboxNetworkPolicy = "deny-all" | "allow-all";

export interface SandboxRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface SandboxHandle {
  readonly id: string;
  run: (opts: { command: string; cwd?: string }) => Promise<SandboxRunResult>;
  readTextFile: (opts: { path: string }) => Promise<string>;
  writeTextFile: (opts: { path: string; content: string }) => Promise<void>;
  removePath: (opts: { path: string; recursive?: boolean }) => Promise<void>;
  resolvePath: (path: string) => string;
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface SessionInfo {
  readonly id: string;
  readonly turn: number;
  readonly auth?: Record<string, unknown>;
  readonly parent?: { readonly sessionId: string; readonly agent: string };
}
