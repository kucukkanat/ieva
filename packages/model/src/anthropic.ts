import type {
  AgentModel,
  ContentPart,
  GenerateRequest,
  GenerateResult,
  ModelMessage,
  ToolCall,
} from "ieva/runtime";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 16000;

export interface AnthropicOptions {
  readonly apiKey: string;
  /** API model id, e.g. "claude-sonnet-5". A gateway id ("anthropic/claude-sonnet-5") is normalized. */
  readonly model: string;
  readonly maxTokens?: number;
  /** Override for a proxy/gateway. Defaults to Anthropic's public endpoint. */
  readonly baseUrl?: string;
  /** Extra fetch, for a proxy that injects the key server-side (production embedders). */
  readonly fetch?: typeof fetch;
}

/**
 * A BYOK Anthropic model that calls the Messages API directly from the browser via
 * `anthropic-dangerous-direct-browser-access`. Non-streaming; the harness synthesizes a
 * single cumulative append. Production embedders can pass a custom `fetch`/`baseUrl` to
 * route through their own proxy instead of shipping a key to the client.
 */
export function createAnthropicModel(options: AnthropicOptions): AgentModel {
  const modelId = options.model.replace(/^anthropic\//, "");
  const doFetch = options.fetch ?? fetch;
  const url = options.baseUrl ?? API_URL;

  return {
    id: `anthropic/${modelId}`,
    async generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResult> {
      const body = {
        model: modelId,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
              })),
            }
          : {}),
      };

      const response = await doFetch(url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${detail}`);
      }

      const data = (await response.json()) as AnthropicResponse;
      return parseResponse(data);
    },
  };
}

interface AnthropicResponse {
  content: Array<{ type: string; [k: string]: unknown }>;
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

function parseResponse(data: AnthropicResponse): GenerateResult {
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of data.content) {
    if (block.type === "text") {
      text += String(block.text ?? "");
    } else if (block.type === "tool_use") {
      toolCalls.push({
        callId: String(block.id),
        name: String(block.name),
        input: block.input,
      });
    }
  }
  const finishReason: GenerateResult["finishReason"] =
    data.stop_reason === "tool_use"
      ? "tool-calls"
      : data.stop_reason === "max_tokens"
        ? "length"
        : "stop";
  return {
    text,
    toolCalls,
    finishReason,
    ...(data.usage
      ? { usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } }
      : {}),
  };
}

/**
 * Map ieva's neutral message shape to Anthropic's wire format. The important
 * conversion: a `tool` role becomes a `user` message carrying `tool_result` blocks,
 * which is where Anthropic requires them.
 */
function toAnthropicMessages(messages: ModelMessage[]): Array<{ role: string; content: unknown }> {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "user", content: toolResultBlocks(message.content) };
    }
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
    }
    return { role: message.role, content: message.content.map(toAnthropicBlock) };
  });
}

function toAnthropicBlock(part: ContentPart): unknown {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "tool-call":
      return { type: "tool_use", id: part.callId, name: part.name, input: part.input };
    case "tool-result":
      return {
        type: "tool_result",
        tool_use_id: part.callId,
        content: stringifyOutput(part.output),
      };
  }
}

function toolResultBlocks(content: ModelMessage["content"]): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map(toAnthropicBlock);
}

function stringifyOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output);
}
