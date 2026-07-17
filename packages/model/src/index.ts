import type { AgentModel, ModelRegistry } from "ieva/runtime";
import { type AnthropicOptions, createAnthropicModel } from "./anthropic.ts";
import { createWebLLMModel, type WebLLMOptions } from "./webllm.ts";

export { createAnthropicModel, type AnthropicOptions } from "./anthropic.ts";
export { createWebLLMModel, type WebLLMOptions } from "./webllm.ts";

export interface RegistryOptions {
  /** BYOK keys per provider prefix, e.g. { anthropic: "sk-ant-..." }. Stored by the host. */
  readonly apiKeys?: Readonly<Record<string, string>>;
  /** Options for a local web-llm model id (prefixed "webllm/"). */
  readonly webllm?: Omit<WebLLMOptions, "model">;
  /** Per-provider overrides (proxy fetch/baseUrl). */
  readonly anthropic?: Partial<Omit<AnthropicOptions, "apiKey" | "model">>;
}

/**
 * Resolve a gateway-style model id string to a runnable model. Recognizes
 * `anthropic/<model>` (BYOK cloud) and `webllm/<model>` (local WebGPU). Resolved models
 * are cached so repeated turns reuse the same engine — important for web-llm, whose
 * engine load is expensive.
 */
export function createModelRegistry(options: RegistryOptions): ModelRegistry {
  const cache = new Map<string, Promise<AgentModel>>();

  return {
    resolve(reference: string): Promise<AgentModel> {
      const existing = cache.get(reference);
      if (existing) return existing;

      const created = build(reference, options);
      cache.set(reference, created);
      return created;
    },
  };
}

async function build(reference: string, options: RegistryOptions): Promise<AgentModel> {
  if (reference.startsWith("webllm/")) {
    return createWebLLMModel({ model: reference.slice("webllm/".length), ...options.webllm });
  }
  // Default provider is Anthropic; a bare or "anthropic/"-prefixed id routes here.
  const apiKey = options.apiKeys?.anthropic;
  if (!apiKey) {
    throw new Error(`No API key configured for model "${reference}". Provide apiKeys.anthropic.`);
  }
  return createAnthropicModel({ apiKey, model: reference, ...options.anthropic });
}
