export interface Example {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Default text placed in the composer, chosen to trigger the example's tool. */
  readonly prompt: string;
  /** Agent directory root within the VFS. */
  readonly root: string;
  readonly files: Readonly<Record<string, string>>;
}

const CALCULATOR: Example = {
  id: "calculator",
  name: "Calculator",
  description: "A tool with a JSON-schema input, plus durable defineState.",
  prompt: "What is 6 times 7?",
  root: "/examples/calculator",
  files: {
    "/examples/calculator/package.json": JSON.stringify({ name: "calculator-bot" }, null, 2),
    "/examples/calculator/agent/instructions.md":
      "You are a calculator assistant. Use the multiply tool to compute products.",
    "/examples/calculator/agent/agent.ts": `import { defineAgent } from "ieva";

export default defineAgent({ model: "mock/demo" });
`,
    "/examples/calculator/agent/tools/multiply.ts": `import { defineTool } from "ieva/tools";
import { defineState } from "ieva/context";

// A session-scoped counter — proves defineState works across the host/blob boundary.
const calls = defineState("calculator.calls", () => ({ n: 0 }));

export default defineTool({
  description: "Multiply two numbers.",
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  async execute(input) {
    const { n } = calls.update((s) => ({ n: s.n + 1 }));
    return { product: Number(input.a) * Number(input.b), callCount: n };
  },
});
`,
    "/examples/calculator/agent/skills/arithmetic.md": `---
description: Use for multiplication and arithmetic questions.
---
Always state the two operands before giving the product.
`,
  },
};

const WEATHER: Example = {
  id: "weather",
  name: "Weather",
  description: "A tool with a string input, returning canned data by city.",
  prompt: "What's the weather in Paris?",
  root: "/examples/weather",
  files: {
    "/examples/weather/package.json": JSON.stringify({ name: "weather-bot" }, null, 2),
    "/examples/weather/agent/instructions.md":
      "You are a weather assistant. Use the get_weather tool when asked about weather.",
    "/examples/weather/agent/agent.ts": `import { defineAgent } from "ieva";

export default defineAgent({ model: "mock/demo" });
`,
    "/examples/weather/agent/tools/get_weather.ts": `import { defineTool } from "ieva/tools";

const CONDITIONS = { Paris: "Rainy, 14°C", Tokyo: "Sunny, 21°C", Cairo: "Clear, 33°C" };

export default defineTool({
  description: "Get the current weather for a city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
  async execute(input) {
    const key = String(input.city ?? "").trim();
    return { city: key, weather: CONDITIONS[key] ?? "Partly cloudy, 18°C" };
  },
});
`,
  },
};

const WORD_COUNT: Example = {
  id: "word-count",
  name: "Word count",
  description: "A text tool — shows a string-input tool over free text.",
  prompt: "Count the words in: the quick brown fox jumps",
  root: "/examples/word-count",
  files: {
    "/examples/word-count/package.json": JSON.stringify({ name: "wordcount-bot" }, null, 2),
    "/examples/word-count/agent/instructions.md":
      "You count words. Use the word_count tool on any text the user gives you.",
    "/examples/word-count/agent/agent.ts": `import { defineAgent } from "ieva";

export default defineAgent({ model: "mock/demo" });
`,
    "/examples/word-count/agent/tools/word_count.ts": `import { defineTool } from "ieva/tools";

export default defineTool({
  description: "Count the words and characters in a piece of text.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  async execute(input) {
    const text = String(input.text ?? "").trim();
    const words = text ? text.split(/\\s+/).length : 0;
    return { words, characters: text.length };
  },
});
`,
  },
};

const ASSISTANT: Example = {
  id: "assistant",
  name: "Assistant (chat)",
  description: "A tool-free agent — ideal for a local WebGPU model, which handles plain chat reliably.",
  prompt: "In two sentences, what is an AI agent?",
  root: "/examples/assistant",
  files: {
    "/examples/assistant/package.json": JSON.stringify({ name: "assistant-bot" }, null, 2),
    "/examples/assistant/agent/instructions.md":
      "You are a concise, friendly assistant. Answer clearly and briefly.",
    "/examples/assistant/agent/agent.ts": `import { defineAgent } from "ieva";

// With the Local (WebGPU) provider selected in the playground, the loaded
// transformers.js model answers regardless of this reference.
export default defineAgent({ model: "transformers/onnx-community/Qwen3-0.6B-ONNX" });
`,
  },
};

export const EXAMPLES: readonly Example[] = [ASSISTANT, CALCULATOR, WEATHER, WORD_COUNT];

