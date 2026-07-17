import type {
  AgentModel,
  ContentPart,
  GenerateRequest,
  GenerateResult,
  ModelMessage,
} from "ieva/runtime";

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
 * Tool-calling on small local models is unreliable, so this generates chat text only;
 * for structured tool use, prefer a cloud model. The dependency is an optional peer,
 * imported lazily.
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
  const maxNewTokens = options.maxNewTokens ?? 384;

  return {
    id: `transformers/${options.model}`,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const messages = [
        { role: "system", content: request.system },
        ...request.messages.map(toChatMessage),
      ];
      const output = await pipe(messages, { max_new_tokens: maxNewTokens, do_sample: false });
      return { text: extractText(output).trim(), toolCalls: [], finishReason: "stop" };
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

function toChatMessage(message: ModelMessage): { role: string; content: string } {
  if (typeof message.content === "string") return { role: message.role, content: message.content };
  const text = message.content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
  return { role: message.role === "tool" ? "user" : message.role, content: text };
}
