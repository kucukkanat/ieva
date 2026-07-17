import type { AgentModel, GenerateRequest, GenerateResult } from "ieva/runtime";
import {
  buildToolSystemPrompt,
  parseToolCalls,
  toChatHistory,
  toNativeTools,
} from "./tool-prompt.ts";

export interface TransformersOptions {
  /** An ONNX model id, e.g. "onnx-community/Qwen3-0.6B-ONNX" or "onnx-community/gemma-4-E2B-it-ONNX". */
  readonly model: string;
  /** WebGPU dtype. Qwen/Gemma-4 → "q4f16"; Gemma 3 → "q4" (avoids an fp16 ORT overflow bug). */
  readonly dtype?: string;
  /** Inference device. Defaults to WebGPU; falls back handled by the runtime. */
  readonly device?: "webgpu" | "wasm";
  readonly maxNewTokens?: number;
  readonly onProgress?: (report: unknown) => void;
}

interface Pipeline {
  (input: unknown, options?: unknown): Promise<Array<{ generated_text: unknown }>>;
  dispose?: () => Promise<void>;
}

/**
 * A local, WebGPU-backed model via transformers.js (`@huggingface/transformers`, ONNX
 * Runtime Web). Loads a tiny ONNX model and runs it on-device — nothing leaves the page.
 * These models have no native tool-use channel, so tool calling is done by prompt: the
 * tools are described in the system prompt and a JSON tool call is parsed back out (see
 * `./tool-prompt.ts`). Reliability varies by model, but it works for simple single-tool
 * turns. The dependency is an optional peer, imported lazily.
 */
export async function createTransformersModel(options: TransformersOptions): Promise<AgentModel> {
  const mod = (await import("@huggingface/transformers")) as {
    pipeline: (task: string, model: string, opts?: unknown) => Promise<Pipeline>;
  };
  const pipe = await mod.pipeline("text-generation", options.model, {
    device: options.device ?? "webgpu",
    dtype: options.dtype ?? "q4f16",
    ...(options.onProgress ? { progress_callback: options.onProgress } : {}),
  });
  const maxNewTokens = options.maxNewTokens ?? 512;

  return {
    id: `transformers/${options.model}`,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      // Tools go to the chat template natively (for templates that support tool_use) and are
      // described in the system prompt as a fallback; the reply's tool call is parsed back out.
      const system = buildToolSystemPrompt(request.system, request.tools);
      const messages = toChatHistory(system, request.messages);
      const nativeTools = toNativeTools(request.tools);
      const output = await pipe(messages, {
        max_new_tokens: maxNewTokens,
        do_sample: false,
        ...(nativeTools.length > 0 ? { tools: nativeTools } : {}),
      });
      const knownTools = new Set(request.tools.map((t) => t.name));
      const { text, toolCalls } = parseToolCalls(extractText(output), knownTools);
      return {
        text,
        toolCalls,
        finishReason: toolCalls.length > 0 ? "tool-calls" : "stop",
      };
    },
  };
}

function extractText(output: Array<{ generated_text: unknown }>): string {
  const generated = output[0]?.generated_text;
  const raw =
    typeof generated === "string"
      ? generated
      : Array.isArray(generated)
        ? ((generated.at(-1) as { content?: string } | undefined)?.content ?? "")
        : "";
  // Reasoning models (e.g. Qwen3) emit a <think>…</think> block; drop it for chat output.
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
