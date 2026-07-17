import { describe, expect, test } from "bun:test";
import type { ModelMessage, ModelToolSpec } from "ieva/runtime";
import { buildToolSystemPrompt, parseToolCalls, toChatHistory } from "./tool-prompt.ts";

const MULTIPLY: ModelToolSpec = {
  name: "multiply",
  description: "Multiply two numbers.",
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
};

const known = new Set(["multiply"]);
const ids = () => {
  let n = 0;
  return () => `id_${n++}`;
};

describe("buildToolSystemPrompt", () => {
  test("returns the base prompt untouched when there are no tools", () => {
    expect(buildToolSystemPrompt("base", [])).toBe("base");
  });

  test("embeds the tool name, description, and schema", () => {
    const prompt = buildToolSystemPrompt("You are a bot.", [MULTIPLY]);
    expect(prompt).toContain("You are a bot.");
    expect(prompt).toContain("### multiply");
    expect(prompt).toContain("Multiply two numbers.");
    expect(prompt).toContain('"required":["a","b"]');
    expect(prompt).toContain('{"tool_call":');
  });

  test("includes a one-shot example whose arguments match the schema shape", () => {
    const prompt = buildToolSystemPrompt("base", [MULTIPLY]);
    // The example uses the tool's own property names with placeholder values.
    expect(prompt).toContain('{"tool_call":{"name":"multiply","arguments":{"a":0,"b":0}}}');
  });
});

describe("parseToolCalls", () => {
  test("parses the wrapped tool_call form", () => {
    const { text, toolCalls } = parseToolCalls(
      '{"tool_call": {"name": "multiply", "arguments": {"a": 6, "b": 7}}}',
      known,
      ids(),
    );
    expect(text).toBe("");
    expect(toolCalls).toEqual([{ callId: "id_0", name: "multiply", input: { a: 6, b: 7 } }]);
  });

  test("parses the bare {name, arguments} form", () => {
    const { toolCalls } = parseToolCalls(
      '{"name": "multiply", "arguments": {"a": 2, "b": 3}}',
      known,
      ids(),
    );
    expect(toolCalls[0]).toEqual({ callId: "id_0", name: "multiply", input: { a: 2, b: 3 } });
  });

  test("parses a call inside a ```json fence and keeps surrounding prose", () => {
    const { text, toolCalls } = parseToolCalls(
      'Let me compute that.\n```json\n{"tool_call": {"name": "multiply", "arguments": {"a": 2600, "b": 53}}}\n```',
      known,
      ids(),
    );
    expect(toolCalls[0]?.input).toEqual({ a: 2600, b: 53 });
    expect(text).toBe("Let me compute that.");
  });

  test("coerces stringified arguments", () => {
    const { toolCalls } = parseToolCalls(
      '{"name": "multiply", "arguments": "{\\"a\\": 1, \\"b\\": 2}"}',
      known,
      ids(),
    );
    expect(toolCalls[0]?.input).toEqual({ a: 1, b: 2 });
  });

  test("ignores unknown tool names", () => {
    const { toolCalls } = parseToolCalls(
      '{"tool_call": {"name": "divide", "arguments": {"a": 1, "b": 2}}}',
      known,
      ids(),
    );
    expect(toolCalls).toEqual([]);
  });

  test("returns plain text unchanged when there is no tool call", () => {
    const { text, toolCalls } = parseToolCalls("The answer is 42.", known, ids());
    expect(text).toBe("The answer is 42.");
    expect(toolCalls).toEqual([]);
  });

  test("does not mistake JSON-looking prose braces for a call", () => {
    const { text, toolCalls } = parseToolCalls(
      "Use {a} and {b} as placeholders, no call here.",
      known,
      ids(),
    );
    expect(toolCalls).toEqual([]);
    expect(text).toContain("{a}");
  });

  test("handles nested-object arguments via balanced-brace scanning", () => {
    const { toolCalls } = parseToolCalls(
      '{"tool_call": {"name": "multiply", "arguments": {"a": 1, "b": 2, "meta": {"note": "x"}}}}',
      known,
      ids(),
    );
    expect(toolCalls[0]?.input).toEqual({ a: 1, b: 2, meta: { note: "x" } });
  });

  describe("lenient fallback for near-JSON from tiny models", () => {
    test("parses Gemma-style call:multiply{a:739,b:48}", () => {
      const { text, toolCalls } = parseToolCalls("call:multiply{a:739,b:48}", known, ids());
      expect(toolCalls).toEqual([{ callId: "id_0", name: "multiply", input: { a: 739, b: 48 } }]);
      expect(text).toBe("");
    });

    test("parses Python-style multiply(a=739, b=48)", () => {
      const { toolCalls } = parseToolCalls("multiply(a=739, b=48)", known, ids());
      expect(toolCalls[0]?.input).toEqual({ a: 739, b: 48 });
    });

    test("parses unquoted string and boolean argument values", () => {
      const search = new Set(["search"]);
      const { toolCalls } = parseToolCalls(
        "search{query: hello world, exact: true}",
        search,
        ids(),
      );
      expect(toolCalls[0]).toEqual({
        callId: "id_0",
        name: "search",
        input: { query: "hello world", exact: true },
      });
    });

    test("does not fire when the loose braces belong to prose, not a tool name", () => {
      const { toolCalls } = parseToolCalls("The result {a:1} is unrelated.", known, ids());
      expect(toolCalls).toEqual([]);
    });

    test("prefers strict JSON over the lenient path when both could match", () => {
      const { toolCalls } = parseToolCalls(
        '{"name": "multiply", "arguments": {"a": 5, "b": 6}}',
        known,
        ids(),
      );
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.input).toEqual({ a: 5, b: 6 });
    });
  });
});

describe("toChatHistory", () => {
  test("serializes tool-call and tool-result parts so nothing is dropped", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "What is 6 times 7?" },
      {
        role: "assistant",
        content: [{ type: "tool-call", callId: "c1", name: "multiply", input: { a: 6, b: 7 } }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", callId: "c1", name: "multiply", output: 42 }],
      },
    ];
    const history = toChatHistory("SYS", messages);
    expect(history[0]).toEqual({ role: "system", content: "SYS" });
    expect(history[1]).toEqual({ role: "user", content: "What is 6 times 7?" });
    expect(history[2]?.content).toContain('"tool_call"');
    expect(history[2]?.content).toContain('"multiply"');
    // The tool role is flattened to user (chat templates lack a tool role) and carries the result.
    expect(history[3]).toEqual({ role: "user", content: "Tool result for multiply: 42" });
  });

  test("round-trips a parsed call back into readable history", () => {
    const { toolCalls } = parseToolCalls(
      '{"tool_call": {"name": "multiply", "arguments": {"a": 2600, "b": 53}}}',
      known,
      ids(),
    );
    const assistant: ModelMessage = {
      role: "assistant",
      content: toolCalls.map((c) => ({
        type: "tool-call" as const,
        callId: c.callId,
        name: c.name,
        input: c.input,
      })),
    };
    const [, entry] = toChatHistory("SYS", [assistant]);
    expect(entry?.content).toContain('"a":2600');
  });
});
