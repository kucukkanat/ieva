# @ieva/model

Model providers for [ieva](../../README.md), behind a registry that resolves gateway-style id strings.

- `anthropic/<model>` — BYOK cloud. Calls the Anthropic Messages API directly from the browser via `anthropic-dangerous-direct-browser-access`. Pass a custom `fetch`/`baseUrl` to route through your own proxy instead.
- `openai/<model>` — OpenAI-compatible cloud. Works with OpenAI and any provider that speaks the Chat Completions format (Groq, Together, OpenRouter, Fireworks, Ollama, LM Studio, …) via `openai.baseUrl`.
- `transformers/<model>` — local WebGPU inference via [transformers.js](https://huggingface.co/docs/transformers.js) (`@huggingface/transformers`, an optional peer dependency). Runs tiny ONNX models on-device.

```ts
import { createModelRegistry } from "@ieva/model";

const registry = createModelRegistry({
  apiKeys: { anthropic: anthropicKey, openai: openaiKey },
  transformers: { dtype: "q4f16", onProgress: (r) => console.log(r) },
  // Point openai/* at any compatible endpoint:
  openai: { baseUrl: "https://api.groq.com/openai/v1" },
});

const cloud = await registry.resolve("anthropic/claude-sonnet-5");
const compat = await registry.resolve("openai/llama-3.3-70b-versatile");
const local = await registry.resolve("transformers/onnx-community/Qwen3-0.6B-ONNX");
```

Resolved models are cached, so repeated turns reuse the same pipeline — important for local models, whose weight load is expensive.

## Direct use

```ts
import { createAnthropicModel } from "@ieva/model/anthropic";
import { createOpenAIModel } from "@ieva/model/openai";
import { createTransformersModel } from "@ieva/model/transformers";

const cloud = createAnthropicModel({ apiKey, model: "claude-sonnet-5" });

// Any OpenAI-compatible endpoint via baseUrl.
const openai = createOpenAIModel({ apiKey, model: "gpt-4o-mini" });
const groq = createOpenAIModel({
  apiKey: groqKey,
  model: "llama-3.3-70b-versatile",
  baseUrl: "https://api.groq.com/openai/v1",
});

// Local — loads the ONNX weights on first use (WebGPU).
const local = await createTransformersModel({
  model: "onnx-community/gemma-4-E2B-it-ONNX",
  dtype: "q4f16",
});
```

## Model & dtype notes

- **Qwen3** (`onnx-community/Qwen3-0.6B-ONNX`, `Qwen3-1.7B-ONNX`) and **Gemma 4** (`onnx-community/gemma-4-E2B-it-ONNX`) run at `q4f16`.
- **Gemma 3** (`onnx-community/gemma-3-270m-it-ONNX`) uses `q4` — its fp16/q4f16 builds hit an overflow bug in ONNX Runtime's WebGPU backend.

## Caveats

- All three adapters implement ieva's non-streaming `AgentModel.generate`; the harness synthesizes a single cumulative append. The cloud adapters (Anthropic, OpenAI) use their native tool-use protocol, so tool calling is reliable.
- The transformers.js adapter does prompt-based tool calling (`./tool-prompt`): tools are described in the system prompt and passed to the chat template natively, and the model's reply is parsed back into `ToolCall`s — tolerating the near-JSON (`call:multiply{a:1,b:2}`, `multiply(a=1, b=2)`) that tiny models emit. Reliability scales with model size: a capable local model like Gemma 4 E2B calls tools well; the tiniest models often answer directly. For tool-heavy agents, prefer a cloud model.

Apache-2.0.
