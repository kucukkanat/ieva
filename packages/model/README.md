# @ieva/model

Model providers for [ieva](../../README.md), behind a registry that resolves gateway-style id strings.

- `anthropic/<model>` — BYOK cloud. Calls the Anthropic Messages API directly from the browser via `anthropic-dangerous-direct-browser-access`. Pass a custom `fetch`/`baseUrl` to route through your own proxy instead.
- `transformers/<model>` — local WebGPU inference via [transformers.js](https://huggingface.co/docs/transformers.js) (`@huggingface/transformers`, an optional peer dependency). Runs tiny ONNX models on-device.

```ts
import { createModelRegistry } from "@ieva/model";

const registry = createModelRegistry({
  apiKeys: { anthropic: userProvidedKey },
  transformers: { dtype: "q4f16", onProgress: (r) => console.log(r) },
});

const cloud = await registry.resolve("anthropic/claude-sonnet-5");
const local = await registry.resolve("transformers/onnx-community/Qwen3-0.6B-ONNX");
```

Resolved models are cached, so repeated turns reuse the same pipeline — important for local models, whose weight load is expensive.

## Direct use

```ts
import { createAnthropicModel } from "@ieva/model/anthropic";
import { createTransformersModel } from "@ieva/model/transformers";

const cloud = createAnthropicModel({ apiKey, model: "claude-sonnet-5" });

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

- Both adapters implement ieva's non-streaming `AgentModel.generate`; the harness synthesizes a single cumulative append.
- Small local models don't reliably emit structured tool calls, so the transformers.js adapter generates chat text only. For tool-heavy agents, use a cloud model.

Apache-2.0.
