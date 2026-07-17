# ieva

**A browser-native framework for durable AI agents.** Filesystem-first, like [eve](https://eve.dev) — but it runs in a tab.

You author an agent as a directory of conventional files. ieva discovers them, compiles them in the browser, and runs the agent loop over OPFS, IndexedDB, and either a BYOK cloud model or a local WebGPU one. No server, no deploy.

```
my-agent/
├── package.json
└── agent/
    ├── agent.ts          # model + runtime config (optional)
    ├── instructions.md   # the system prompt (required)
    ├── tools/            # one file = one tool; filename = tool name
    │   └── get_weather.ts
    ├── skills/           # markdown playbooks, loaded on demand
    ├── subagents/        # specialist child agents
    └── hooks/            # observe-only lifecycle subscribers
```

Identity comes from the path — you never write a `name` field. `tools/get_weather.ts` *is* the tool `get_weather`.

## The smallest agent

```ts
// agent/tools/get_weather.ts
import { defineTool } from "ieva/tools";
import { z } from "zod";

export default defineTool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({ city: z.string() }),
  async execute({ city }) {
    return { city, condition: "Sunny", temperatureF: 72 };
  },
});
```

```md
<!-- agent/instructions.md -->
You are a concise weather assistant. Use the get_weather tool when asked about weather.
```

## Running it in the browser

```ts
import { OpfsFileSystem, ingestFromPicker } from "@ieva/fs";
import { EsbuildLoader } from "@ieva/compiler/esbuild";
import { IdbStore } from "@ieva/store-idb";
import { createModelRegistry } from "@ieva/model";
import { bootstrapAgent } from "@ieva/kit";
import esbuild from "esbuild-wasm";

// 1. Mirror an agent directory into OPFS (live handle from the disk picker).
const vfs = await OpfsFileSystem.mount("agents/weather");
await ingestFromPicker(vfs, "/agents/weather");

// 2. Wire the browser adapters.
const loader = await EsbuildLoader.create(esbuild, {
  fs: vfs.asReadFs(),
  wasmURL: "/esbuild.wasm",
  ievaModuleUrls: { ieva: "/runtime/ieva.js", "ieva/tools": "/runtime/tools.js" },
});
const registry = createModelRegistry({ apiKeys: { anthropic: userKey } });
const store = await IdbStore.open();

// 3. Folder → running agent, in one call.
const { client } = await bootstrapAgent({
  fs: vfs.asReadFs(),
  root: "/agents/weather/agent",
  loader,
  registry,
  store,
});

client.on((event) => console.log(event.type, event.data));
console.log(await client.send("What's the weather in Paris?"));
```

In React:

```tsx
import { useIevaAgent } from "@ieva/react";

function Chat({ client }) {
  const { message, running, send } = useIevaAgent(client);
  return (
    <>
      <p>{message}</p>
      <button disabled={running} onClick={() => send("What's the weather in Paris?")}>
        Ask
      </button>
    </>
  );
}
```

## Packages

| Package | What it does |
|---|---|
| [`ieva`](packages/ieva) | The framework: `define*` API, discovery, the agent loop (session → turn → step), events, the durable-store contract. Environment-free and fully Bun-testable. |
| [`@ieva/fs`](packages/fs) | OPFS-backed VFS implementing just-bash's `IFileSystem`, the sync path index, and directory ingest (picker, drag-drop, zip, URL). |
| [`@ieva/compiler`](packages/compiler) | In-browser compiler: discovery + esbuild-wasm module loading + brand validation → a runnable `LoadedAgent`. |
| [`@ieva/store-idb`](packages/store-idb) | IndexedDB checkpoint store. Sessions survive tab reloads. |
| [`@ieva/model`](packages/model) | Model providers — BYOK Anthropic (direct-browser) and local web-llm — behind a registry. |
| [`@ieva/kit`](packages/kit) | `bootstrapAgent()` — discover → compile → client in one call. |
| [`@ieva/react`](packages/react) | `useIevaAgent()` hook. |

## The web app

[`apps/web`](apps/web) is a single SPA combining the docs, the landing page, and the playground. It's deployed to **GitHub Pages** at [kucukkanat.github.io/ieva](https://kucukkanat.github.io/ieva/) on every push to `main` (see `.github/workflows/deploy.yml`).

The playground runs the whole pipeline in your tab — pick an example, choose a model (an **offline mock**, a **local WebGPU model** with full load/cache/unload controls, or your **Anthropic key**), and it discovers, compiles with esbuild-wasm, and runs the agent over OPFS + IndexedDB. The docs ship an LLM-oriented `/llms.txt` and `/sitemap.md`.

```sh
bun install
IEVA_BASE=/ bunx vite apps/web --port 5177   # dev at http://localhost:5177
bun run --cwd apps/web build                 # production build (base /ieva/) → apps/web/dist
```

### Loading an agent from a zip

```ts
import { mountAgentFromZip } from "@ieva/fs";
import { bootstrapAgent } from "@ieva/kit";

const { fs, root } = await mountAgentFromZip(zipBytes); // unpacks + auto-detects the agent dir
const { client } = await bootstrapAgent({ fs, root, loader, registry, store });
```

`mountAgentFromUrl(url)` and `mountAgentFromFiles({ ... })` are the same shape for a shared link or an inline file map.

## Design notes

- **Durability.** Every turn is a session → turn → step progression; step results are the atomic persistence boundary, checkpointed to IndexedDB. A tab reload is a crash — sessions resume. The snapshot never stores the model or tool config (it's rebuilt from the manifest each turn), which is also what makes hot reload safe mid-conversation.
- **Discovery never runs authored code.** The path determines the slot; brands are checked only when a module is actually imported at compile time. `ieva info`-style inspection is therefore safe.
- **Two seams from eve, filled for the browser.** eve delegates durability to a pluggable "world" and sandboxing to a pluggable backend; ieva implements the browser variants (IndexedDB store, OPFS + just-bash) behind the same kind of interfaces.

## Development

```sh
bun install
bun test        # unit + integration (environment-free core)
bun run typecheck
```

Browser-dependent code (OPFS, IndexedDB, WebGPU, esbuild-wasm) is exercised in the web app; the discovery, compile-orchestration, harness, and path-index logic is deliberately environment-free so the majority of the framework is testable under Bun.

Apache-2.0.
