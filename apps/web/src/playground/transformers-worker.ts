/**
 * The transformers.js inference worker. Runs ONNX Runtime Web (WebGPU) off the main
 * thread so weight loading and token generation never block the UI. Vite bundles this
 * via the `new Worker(new URL(...), { type: "module" })` reference in local-model.ts.
 *
 * Protocol (main → worker):
 *   { type: "load", modelId, dtype }                     → progress* then "ready" | "error"
 *   { type: "generate", id, messages, maxTokens, tools } → "token"* then "result" | "error"
 *   { type: "unload" }
 *
 * `tools` (OpenAI function shape) is forwarded to the chat template; models whose template
 * declares `tool_use` render them in their trained tool-calling format.
 */
import { type TextGenerationPipeline, TextStreamer, pipeline } from "@huggingface/transformers";

let generator: TextGenerationPipeline | undefined;

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;
  try {
    if (msg.type === "load") {
      generator = (await pipeline("text-generation", msg.modelId, {
        device: "webgpu",
        dtype: msg.dtype,
        progress_callback: (report: unknown) => self.postMessage({ type: "progress", report }),
      })) as TextGenerationPipeline;
      self.postMessage({ type: "ready" });
    } else if (msg.type === "generate") {
      if (!generator) throw new Error("No model loaded");
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => self.postMessage({ type: "token", id: msg.id, text }),
      });
      const output = (await generator(msg.messages, {
        max_new_tokens: msg.maxTokens ?? 256,
        do_sample: false,
        streamer,
        ...(msg.tools && msg.tools.length > 0 ? { tools: msg.tools } : {}),
      })) as Array<{ generated_text: unknown }>;
      self.postMessage({ type: "result", id: msg.id, text: extractText(output) });
    } else if (msg.type === "unload") {
      await generator?.dispose?.();
      generator = undefined;
    }
  } catch (error) {
    self.postMessage({ type: "error", id: msg.id, error: String(error) });
  }
};

/** A chat-formatted generation returns the full message array; the last one is the reply. */
function extractText(output: Array<{ generated_text: unknown }>): string {
  const generated = output[0]?.generated_text;
  const raw =
    typeof generated === "string"
      ? generated
      : Array.isArray(generated)
        ? ((generated.at(-1) as { content?: string } | undefined)?.content ?? "")
        : "";
  // Qwen3 and other reasoning models emit a <think>…</think> block; drop it for chat.
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
