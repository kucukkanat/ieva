import type {
  AgentModel,
  ContentPart,
  GenerateRequest,
  GenerateResult,
  ModelMessage,
  ToolCall,
} from "ieva/runtime";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_TOKENS = 4096;

export interface OpenAIOptions {
  readonly apiKey: string;
  /** Model id, e.g. "gpt-4o-mini". A gateway id ("openai/gpt-4o-mini") is normalized. */
  readonly model: string;
  readonly maxTokens?: number;
  /**
   * API root for the Chat Completions endpoint. Defaults to OpenAI's. Point it at any
   * OpenAI-compatible provider — Groq, Together, OpenRouter, Fireworks, a local Ollama /
   * LM Studio server, or your own proxy. `/chat/completions` is appended.
   */
  readonly baseUrl?: string;
  /** Extra fetch, for a proxy that injects the key server-side. */
  readonly fetch?: typeof fetch;
  /** Extra headers (e.g. OpenRouter's `HTTP-Referer`/`X-Title`). */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A model backed by the OpenAI Chat Completions API — and by the many providers that speak
 * the same wire format. Uses the provider's native tool-use protocol, so tool calling is
 * reliable. Non-streaming; the harness synthesizes a single cumulative append. Set
 * `baseUrl`/`fetch` to route through a compatible endpoint or a key-injecting proxy.
 */
export function createOpenAIModel(options: OpenAIOptions): AgentModel {
  const modelId = options.model.replace(/^openai\//, "");
  const doFetch = options.fetch ?? fetch;
  const url = `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/chat/completions`;

  return {
    id: `openai/${modelId}`,
    async generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResult> {
      const body = {
        model: modelId,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: toOpenAIMessages(request.system, request.messages),
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                },
              })),
            }
          : {}),
      };

      const response = await doFetch(url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
          ...options.headers,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${detail}`);
      }

      return parseResponse((await response.json()) as OpenAIResponse);
    },
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function parseResponse(data: OpenAIResponse): GenerateResult {
  const choice = data.choices[0];
  const message = choice?.message;
  const text = message?.content ?? "";
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((c) => ({
    callId: c.id,
    name: c.function.name,
    input: parseArguments(c.function.arguments),
  }));
  const finishReason: GenerateResult["finishReason"] =
    toolCalls.length > 0 ? "tool-calls" : choice?.finish_reason === "length" ? "length" : "stop";
  return {
    text,
    toolCalls,
    finishReason,
    ...(data.usage
      ? {
          usage: {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          },
        }
      : {}),
  };
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * Map ieva's neutral message shape to OpenAI's. The important conversions: an assistant
 * `tool-call` part becomes a `tool_calls` entry with stringified JSON arguments, and a
 * `tool` role message fans out to one `{ role: "tool", tool_call_id }` message per result.
 */
function toOpenAIMessages(system: string, messages: ModelMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "tool") {
      for (const part of asParts(message.content)) {
        if (part.type === "tool-result") {
          out.push({
            role: "tool",
            tool_call_id: part.callId,
            content: stringifyOutput(part.output),
          });
        }
      }
      continue;
    }
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    const text = message.content
      .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
    const toolCalls = message.content
      .filter((p): p is Extract<ContentPart, { type: "tool-call" }> => p.type === "tool-call")
      .map((p) => ({
        id: p.callId,
        type: "function" as const,
        function: { name: p.name, arguments: JSON.stringify(p.input) },
      }));
    out.push({
      role: message.role,
      content: text || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }
  return out;
}

function asParts(content: ModelMessage["content"]): ContentPart[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function stringifyOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output);
}
