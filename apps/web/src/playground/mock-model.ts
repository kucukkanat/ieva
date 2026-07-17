import type {
  AgentModel,
  GenerateRequest,
  GenerateResult,
  ModelMessage,
  ModelToolSpec,
} from "ieva/runtime";

/**
 * A deterministic, offline model for demoing and browser-verifying the full pipeline
 * without a network key. It reads the first tool's JSON-schema properties and synthesizes
 * inputs from the user message — numbers for number props, salient text for string props —
 * then reports the tool's result. This exercises the real tool round-trip across examples.
 */
export function createMockModel(): AgentModel {
  return {
    id: "mock/demo",
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const toolResult = findLastToolResult(request.messages);
      if (toolResult !== undefined) {
        return {
          text: `Done. The tool returned ${JSON.stringify(toolResult)}.`,
          toolCalls: [],
          finishReason: "stop",
        };
      }

      const userText = lastUserText(request.messages);
      const tool = request.tools.find((t) => t.name !== "load_skill");
      if (tool) {
        const input = synthesizeInput(tool, userText);
        if (input) {
          return {
            text: "",
            toolCalls: [{ callId: `mock-${tool.name}`, name: tool.name, input }],
            finishReason: "tool-calls",
          };
        }
      }

      return {
        text: `You said: "${userText}". I have ${request.tools.length} tool(s) available.`,
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
}

/** Build a tool input from its JSON-schema properties and the user's message. */
function synthesizeInput(tool: ModelToolSpec, message: string): Record<string, unknown> | undefined {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
  const properties = schema.properties;
  if (!properties) return undefined;

  const order = schema.required?.length ? schema.required : Object.keys(properties);
  const numbers = [...message.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  let numberIdx = 0;
  const input: Record<string, unknown> = {};

  for (const key of order) {
    const type = properties[key]?.type;
    if (type === "number" || type === "integer") {
      input[key] = numbers[numberIdx++] ?? 0;
    } else if (type === "boolean") {
      input[key] = true;
    } else {
      input[key] = salientText(message);
    }
  }
  return input;
}

/** The meaningful part of a message: after a colon, else after " in ", else the whole thing. */
function salientText(message: string): string {
  const trimmed = message.trim();
  const colon = trimmed.indexOf(":");
  if (colon !== -1) return trimmed.slice(colon + 1).trim();
  const inIdx = trimmed.toLowerCase().lastIndexOf(" in ");
  if (inIdx !== -1) return stripTrailing(trimmed.slice(inIdx + 4).trim());
  return stripTrailing(trimmed);
}

function stripTrailing(text: string): string {
  return text.replace(/[?.!,]+$/, "");
}

function lastUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

function findLastToolResult(messages: ModelMessage[]): unknown {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.role === "tool" && Array.isArray(m.content)) {
      const part = m.content.find((p) => p.type === "tool-result");
      if (part && part.type === "tool-result") return part.output;
    }
  }
  return undefined;
}
