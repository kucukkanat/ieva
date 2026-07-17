# ieva

The core of the [ieva](../../README.md) framework: the authoring API, discovery, the agent loop, the event protocol, and the durable-store contract. This package is environment-free — it has no dependency on OPFS, IndexedDB, or a bundler — so the browser adapters layer on top and the whole core is testable under Bun.

## The authoring API

Every `define*` helper is a typed pass-through — identity comes from the file path, never a `name` field.

```ts
import { defineAgent, defineDynamic } from "ieva";
import { defineTool, disableTool } from "ieva/tools";
import { always, once, never } from "ieva/tools/approval";
import { defineSkill } from "ieva/skills";
import { defineInstructions } from "ieva/instructions";
import { defineHook } from "ieva/hooks";
import { defineSandbox } from "ieva/sandbox";
import { defineState } from "ieva/context";
```

### Agent config — `agent/agent.ts`

```ts
import { defineAgent } from "ieva";

export default defineAgent({
  model: "anthropic/claude-sonnet-5", // or "webllm/Llama-3.1-8B-Instruct-q4f32_1-MLC"
  compaction: { thresholdPercent: 0.9 },
});
```

Omit `agent.ts` entirely and the agent defaults to `anthropic/claude-sonnet-5`. On a subagent, `agent.ts` is required and must carry a `description`.

### Tools — `agent/tools/<name>.ts`

```ts
import { defineTool } from "ieva/tools";
import { always } from "ieva/tools/approval";
import { z } from "zod";

export default defineTool({
  description: "Refund a charge.",
  inputSchema: z.object({ chargeId: z.string(), amount: z.number() }),
  approval: always(), // pauses the turn for user approval
  async execute({ chargeId, amount }, ctx) {
    // Runs in the trusted runtime with fetch + host config — not in the sandbox.
    // Reach the sandbox with await ctx.getSandbox().
    return await refund(chargeId, amount);
  },
});
```

The filename (snake_case ASCII) is the model-facing tool name. Override a built-in by naming a file after it, or `export default disableTool()` to remove it.

### Skills — `agent/skills/<name>.md`

```md
---
description: Use when the user needs a release checklist or changelog workflow.
---
Follow these steps: ...
```

Skills load on demand via progressive disclosure — the description is advertised to the model, and the body is appended only when the model calls `load_skill`. Loading a skill adds instructions, never a new tool.

### Durable state — `defineState`

```ts
import { defineState } from "ieva/context";

const budget = defineState("my-agent.budget", () => ({ count: 0, cap: 25 }));

// inside a tool:
budget.update((s) => ({ ...s, count: s.count + 1 }));
```

State is session-scoped and survives step boundaries and tab reloads. Subagents get fresh state.

## The runtime (`ieva/runtime`)

The pieces the browser adapters and `@ieva/kit` build on:

- `discover(fs, root)` → an `AgentManifest` (no authored code executed).
- `Harness` — the session → turn → step loop, driving an `AgentModel` and a `CheckpointStore`.
- `EventStream` — the NDJSON-style event protocol with tail-relative replay.
- `MemFs` / `MemStore` — in-memory implementations for tests.

```ts
import { discover, MemFs } from "ieva/runtime";

const fs = new MemFs({
  "/agent/instructions.md": "You are helpful.",
  "/agent/tools/add.ts": "export default {}",
});
const manifest = await discover(fs, "/agent");
console.log(manifest.tools); // [{ name: "add", modulePath: "/agent/tools/add.ts" }]
```

## Testing

```sh
bun test
```

Apache-2.0.
