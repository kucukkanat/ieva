import { describe, expect, test } from "bun:test";
import type { GenerateRequest, ModelMessage } from "ieva/runtime";
import { createOpenAIModel } from "./openai.ts";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fetch stub that records the request and returns a canned Chat Completions response. */
function stubFetch(response: unknown, status = 200): { fetch: typeof fetch; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    captured.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
      text: async () => JSON.stringify(response),
    } as Response;
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, captured };
}

const baseRequest = (overrides: Partial<GenerateRequest> = {}): GenerateRequest => ({
  system: "You are a bot.",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
  ...overrides,
});

const signal = new AbortController().signal;

describe("createOpenAIModel", () => {
  test("normalizes the gateway id and posts to /chat/completions", async () => {
    const { fetch, captured } = stubFetch({
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
    });
    const model = createOpenAIModel({ apiKey: "sk-test", model: "openai/gpt-4o-mini", fetch });

    expect(model.id).toBe("openai/gpt-4o-mini");
    const result = await model.generate(baseRequest(), signal);

    expect(result).toEqual({ text: "hello", toolCalls: [], finishReason: "stop" });
    expect(captured[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured[0]?.headers.authorization).toBe("Bearer sk-test");
    expect(captured[0]?.body.model).toBe("gpt-4o-mini");
    // System prompt is sent as the first message.
    expect((captured[0]?.body.messages as unknown[])[0]).toEqual({
      role: "system",
      content: "You are a bot.",
    });
  });

  test("routes to a custom OpenAI-compatible baseUrl and sends extra headers", async () => {
    const { fetch, captured } = stubFetch({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    });
    const model = createOpenAIModel({
      apiKey: "gk",
      model: "llama-3.3-70b-versatile",
      baseUrl: "https://api.groq.com/openai/v1/",
      headers: { "x-title": "ieva" },
      fetch,
    });
    await model.generate(baseRequest(), signal);

    // Trailing slash is collapsed, not doubled.
    expect(captured[0]?.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(captured[0]?.headers["x-title"]).toBe("ieva");
  });

  test("advertises tools in OpenAI function shape", async () => {
    const { fetch, captured } = stubFetch({
      choices: [{ message: { content: "" }, finish_reason: "stop" }],
    });
    const model = createOpenAIModel({ apiKey: "k", model: "gpt-4o", fetch });
    await model.generate(
      baseRequest({
        tools: [
          {
            name: "multiply",
            description: "Multiply two numbers.",
            inputSchema: { type: "object", properties: { a: { type: "number" } } },
          },
        ],
      }),
      signal,
    );

    expect(captured[0]?.body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "multiply",
          description: "Multiply two numbers.",
          parameters: { type: "object", properties: { a: { type: "number" } } },
        },
      },
    ]);
  });

  test("parses tool calls with JSON-string arguments", async () => {
    const { fetch } = stubFetch({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "call_1", function: { name: "multiply", arguments: '{"a":6,"b":7}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });
    const model = createOpenAIModel({ apiKey: "k", model: "gpt-4o", fetch });
    const result = await model.generate(baseRequest(), signal);

    expect(result.finishReason).toBe("tool-calls");
    expect(result.toolCalls).toEqual([
      { callId: "call_1", name: "multiply", input: { a: 6, b: 7 } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  test("round-trips assistant tool calls and tool results into OpenAI messages", async () => {
    const { fetch, captured } = stubFetch({
      choices: [{ message: { content: "42" }, finish_reason: "stop" }],
    });
    const messages: ModelMessage[] = [
      { role: "user", content: "6 times 7?" },
      {
        role: "assistant",
        content: [{ type: "tool-call", callId: "c1", name: "multiply", input: { a: 6, b: 7 } }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", callId: "c1", name: "multiply", output: 42 }],
      },
    ];
    const model = createOpenAIModel({ apiKey: "k", model: "gpt-4o", fetch });
    await model.generate(baseRequest({ messages }), signal);

    const sent = captured[0]?.body.messages as Array<Record<string, unknown>>;
    // [system, user, assistant(tool_calls), tool]
    expect(sent[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "c1", type: "function", function: { name: "multiply", arguments: '{"a":6,"b":7}' } },
      ],
    });
    expect(sent[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "42" });
  });

  test("throws with status and body on an error response", async () => {
    const { fetch } = stubFetch({ error: { message: "bad key" } }, 401);
    const model = createOpenAIModel({ apiKey: "k", model: "gpt-4o", fetch });
    await expect(model.generate(baseRequest(), signal)).rejects.toThrow("OpenAI API error 401");
  });
});
