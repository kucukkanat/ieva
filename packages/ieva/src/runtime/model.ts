/**
 * The model contract the harness drives. Kept deliberately narrow so it can be backed
 * by an AI SDK LanguageModel (cloud BYOK) or a local transformers.js provider, and stubbed in
 * tests. Streaming is optional; when a model only implements `generate`, the harness
 * synthesizes a single cumulative append.
 */
export interface AgentModel {
  readonly id: string;
  generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResult>;
  stream?: (request: GenerateRequest, signal: AbortSignal) => AsyncIterable<StreamPart>;
}

export interface GenerateRequest {
  readonly system: string;
  readonly messages: ModelMessage[];
  readonly tools: ModelToolSpec[];
}

export interface ModelMessage {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string | ContentPart[];
}

export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool-call"; readonly callId: string; readonly name: string; readonly input: unknown }
  | { readonly type: "tool-result"; readonly callId: string; readonly name: string; readonly output: unknown };

export interface ModelToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool input, as the model expects it. */
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  readonly callId: string;
  readonly name: string;
  readonly input: unknown;
}

export interface GenerateResult {
  readonly text: string;
  readonly toolCalls: ToolCall[];
  readonly finishReason: "stop" | "tool-calls" | "length";
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

export type StreamPart =
  | { readonly type: "text-delta"; readonly delta: string }
  | { readonly type: "tool-call"; readonly call: ToolCall }
  | { readonly type: "finish"; readonly finishReason: GenerateResult["finishReason"] };

/** Resolve a model id or object through a registry (BYOK cloud, local, or a mock). */
export interface ModelRegistry {
  resolve(reference: string): Promise<AgentModel>;
}
