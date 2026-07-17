import type {
  AgentModel,
  ContentPart,
  GenerateRequest,
  GenerateResult,
  ModelMessage,
  ToolCall,
} from "ieva/runtime";

/** Structural view of the web-llm engine surface we use (OpenAI-compatible). */
interface MLCEngine {
  chat: {
    completions: {
      create(request: ChatRequest): Promise<ChatResponse>;
    };
  };
}
interface ChatRequest {
  messages: Array<{ role: string; content: string; tool_call_id?: string }>;
  tools?: Array<{ type: "function"; function: { name: string; description: string; parameters: unknown } }>;
  tool_choice?: "auto";
}
interface ChatResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
}

export interface WebLLMOptions {
  /** An MLC model id, e.g. "Llama-3.1-8B-Instruct-q4f32_1-MLC". */
  readonly model: string;
  /** Progress callback for the (large) initial weight download. */
  readonly onProgress?: (report: { progress: number; text: string }) => void;
}

/**
 * A local, WebGPU-backed model via web-llm. Tool calling is emerging in web-llm; we pass
 * tools through the OpenAI-compatible surface and parse `tool_calls`. If a chosen model
 * cannot emit structured tool calls, fall back to a JSON-instructed prompt (documented).
 * `@mlc-ai/web-llm` is an optional peer dependency, imported lazily.
 */
export async function createWebLLMModel(options: WebLLMOptions): Promise<AgentModel> {
  const mod = (await import("@mlc-ai/web-llm")) as {
    CreateMLCEngine: (
      model: string,
      config?: { initProgressCallback?: (r: { progress: number; text: string }) => void },
    ) => Promise<MLCEngine>;
  };
  const engine = await mod.CreateMLCEngine(options.model, {
    ...(options.onProgress ? { initProgressCallback: options.onProgress } : {}),
  });

  return {
    id: `webllm/${options.model}`,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const messages = [
        { role: "system", content: request.system },
        ...request.messages.map(toOpenAiMessage),
      ];
      const response = await engine.chat.completions.create({
        messages,
        ...(request.tools.length > 0
          ? {
              tool_choice: "auto" as const,
              tools: request.tools.map((t) => ({
                type: "function" as const,
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
            }
          : {}),
      });
      return parseChatResponse(response);
    },
  };
}

function parseChatResponse(response: ChatResponse): GenerateResult {
  const choice = response.choices[0];
  const text = choice?.message.content ?? "";
  const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((c) => ({
    callId: c.id,
    name: c.function.name,
    input: safeParse(c.function.arguments),
  }));
  const finishReason: GenerateResult["finishReason"] =
    toolCalls.length > 0 || choice?.finish_reason === "tool_calls"
      ? "tool-calls"
      : choice?.finish_reason === "length"
        ? "length"
        : "stop";
  return { text, toolCalls, finishReason };
}

function toOpenAiMessage(message: ModelMessage): { role: string; content: string; tool_call_id?: string } {
  if (message.role === "tool") {
    const part = asParts(message.content).find((p) => p.type === "tool-result");
    return {
      role: "tool",
      content: part && part.type === "tool-result" ? stringify(part.output) : "",
      ...(part && part.type === "tool-result" ? { tool_call_id: part.callId } : {}),
    };
  }
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  const text = message.content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
  return { role: message.role, content: text };
}

function asParts(content: ModelMessage["content"]): ContentPart[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}
function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
