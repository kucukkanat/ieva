# @ieva/model

Model providers for [ieva](../../README.md), behind a registry that resolves gateway-style id strings.

- `anthropic/<model>` — BYOK cloud. Calls the Anthropic Messages API directly from the browser via `anthropic-dangerous-direct-browser-access`. Pass a custom `fetch`/`baseUrl` to route through your own proxy instead.
- `webllm/<model>` — local WebGPU inference via `@mlc-ai/web-llm` (optional peer dependency).

```ts
import { createModelRegistry } from "@ieva/model";

const registry = createModelRegistry({
  apiKeys: { anthropic: userProvidedKey },
  webllm: { onProgress: (r) => console.log(r.text, r.progress) },
});

const cloud = await registry.resolve("anthropic/claude-sonnet-5");
const local = await registry.resolve("webllm/Llama-3.1-8B-Instruct-q4f32_1-MLC");
```

Resolved models are cached, so repeated turns reuse the same engine — important for web-llm, whose weight load is expensive.

## Direct use

```ts
import { createAnthropicModel } from "@ieva/model/anthropic";

const model = createAnthropicModel({ apiKey, model: "claude-sonnet-5" });
const result = await model.generate(
  { system: "You are helpful.", messages: [{ role: "user", content: "hi" }], tools: [] },
  new AbortController().signal,
);
```

## Caveats

- Both adapters implement ieva's non-streaming `AgentModel.generate`; the harness synthesizes a single cumulative append. Streaming is a future addition behind the same interface.
- web-llm tool calling is still maturing. The adapter passes tools through the OpenAI-compatible surface and parses `tool_calls`; for a model that can't emit structured calls, fall back to a JSON-instructed prompt.

Apache-2.0.
