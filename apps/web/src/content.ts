export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
}

export interface NavSection {
  readonly title: string;
  readonly pages: readonly string[];
}

export const NAV: readonly NavSection[] = [
  { title: "Start here", pages: ["introduction", "getting-started"] },
  { title: "Authoring", pages: ["agent-config", "tools", "skills", "subagents", "hooks", "state"] },
  { title: "Browser runtime", pages: ["ingest", "sandbox", "durability", "models"] },
  { title: "Reference", pages: ["project-layout", "packages"] },
];

export const PAGES: Record<string, DocPage> = {
  introduction: {
    slug: "introduction",
    title: "Introduction",
    summary: "What ieva is and why it exists.",
    body: `# Introduction

**ieva** is a framework for building durable AI agents as ordinary files — and running them entirely in a browser tab. It's a browser-native take on the filesystem-first design [eve](https://eve.dev) pioneered: you author an \`agent/\` directory of conventional files, and the framework discovers, compiles, and runs them.

The defining idea, borrowed from eve: **identity comes from the path.** A file at \`tools/get_weather.ts\` *is* the tool \`get_weather\`. You never write a \`name\` field.

What's different is where it runs. There is no server, no build step you invoke, and no deploy. The filesystem is [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), the durable store is IndexedDB, compilation happens in the browser via esbuild-wasm, and the model is either a BYOK cloud provider or a WebGPU-local one.

## Why a browser runtime

Three things fall out of running in the browser that a server framework structurally can't offer:

- **Agents shared by link.** An agent directory is data; serialize it into a URL and anyone can open and run it with their own key.
- **Live hot-reload against a real folder.** With the File System Access API, the page holds a live handle to a directory on disk — edit a tool in your editor and re-sync without losing the conversation.
- **Time-travel over the checkpoint store.** Because we own the durable store, every step is inspectable and replayable.

## The smallest agent

Two files:

\`\`\`md
<!-- agent/instructions.md -->
You are a concise weather assistant. Use the get_weather tool when asked about weather.
\`\`\`

\`\`\`ts
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
\`\`\`

That's a running agent. Everything else — skills, subagents, a sandbox — is added as complexity grows.`,
  },

  "getting-started": {
    slug: "getting-started",
    title: "Getting started",
    summary: "Boot an agent directory into a running client, in one call.",
    body: `# Getting started

The whole pipeline — mirror a directory into OPFS, discover it, compile it, run it — is one call via \`@ieva/kit\`.

\`\`\`ts
import { OpfsFileSystem, ingestFromPicker } from "@ieva/fs";
import { EsbuildLoader, DEFAULT_IEVA_EXPORTS } from "@ieva/compiler/esbuild";
import { IdbStore } from "@ieva/store-idb";
import { createModelRegistry } from "@ieva/model";
import { bootstrapAgent } from "@ieva/kit";
import * as esbuild from "esbuild-wasm";
import esbuildWasmURL from "esbuild-wasm/esbuild.wasm?url";

// 1. Mirror an agent directory into OPFS (live handle from the disk picker).
const vfs = await OpfsFileSystem.mount("agents");
await ingestFromPicker(vfs, "/agents/weather");

// 2. Wire the browser adapters. runtimeGlobal shares the host's single ieva
//    instance into compiled modules, so defineState works.
const loader = await EsbuildLoader.create(esbuild, {
  fs: vfs.asReadFs(),
  wasmURL: esbuildWasmURL,
  runtimeGlobal: { globalVar: "__IEVA_RUNTIME__", exports: DEFAULT_IEVA_EXPORTS },
});

// 3. Folder → running agent.
const { client, manifest } = await bootstrapAgent({
  fs: vfs.asReadFs(),
  root: "/agents/weather/agent",
  loader,
  registry: createModelRegistry({ apiKeys: { anthropic: userKey } }),
  store: await IdbStore.open(),
});

client.on((e) => console.log(e.type, e.data));
console.log(await client.send("What's the weather in Paris?"));
\`\`\`

## In React

\`\`\`tsx
import { useIevaAgent } from "@ieva/react";

function Chat({ client }) {
  const { message, running, send } = useIevaAgent(client);
  return (
    <>
      <p>{message}</p>
      <button disabled={running} onClick={() => send("Weather in Paris?")}>Ask</button>
    </>
  );
}
\`\`\`

The [playground](#/playground) does exactly this — pick an example (or load the sample), choose a model (offline mock, local WebGPU, or your Anthropic key), and it discovers, compiles, and runs in your tab.

## From a zip, in two calls

For the common "ship an agent as a zip" case, \`@ieva/fs\` mounts and finds the agent root for you:

\`\`\`ts
import { mountAgentFromZip } from "@ieva/fs";
import { bootstrapAgent } from "@ieva/kit";

const { fs, root } = await mountAgentFromZip(zipBytes); // unpacks + detects the agent dir
const { client } = await bootstrapAgent({ fs, root, loader, registry, store });
\`\`\`

\`mountAgentFromUrl(url)\` and \`mountAgentFromFiles({ ... })\` are the same shape for a shared link or an inline file map.`,
  },

  "agent-config": {
    slug: "agent-config",
    title: "agent.ts",
    summary: "Model and runtime configuration.",
    body: `# agent.ts

Authored at \`agent/agent.ts\` as the default export. Identity is never set here — the root agent's name comes from \`package.json#name\` (falling back to the directory name).

\`\`\`ts
import { defineAgent } from "ieva";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  compaction: { thresholdPercent: 0.9 },
});
\`\`\`

## Fields

| Field | Notes |
|---|---|
| \`model\` | A gateway-style id: \`anthropic/<model>\` (BYOK cloud), \`openai/<model>\` (OpenAI-compatible cloud), or \`transformers/<model>\` (local WebGPU). Required if \`agent.ts\` exists. See [Models](#/docs/models). |
| \`compaction\` | \`{ thresholdPercent }\` or \`false\`. On by default at 0.9. |
| \`limits\` | \`maxInputTokensPerSession\`, \`maxOutputTokensPerSession\`, \`maxSteps\`. |
| \`description\` | Required on **subagents** only — the parent reads it to decide whether to delegate. |
| \`reasoning\` | Provider-agnostic effort hint. |

Omit \`agent.ts\` entirely and the agent defaults to \`anthropic/claude-sonnet-5\`. If the file exists, \`model\` is mandatory.

## Dynamic models

\`\`\`ts
import { defineAgent, defineDynamic } from "ieva";

export default defineAgent({
  model: defineDynamic({
    fallback: "anthropic/claude-sonnet-5",
    events: {
      "session.started": (_e, ctx) =>
        ctx.session.auth?.plan === "enterprise" ? "anthropic/claude-opus-4-8" : null,
    },
  }),
});
\`\`\``,
  },

  tools: {
    slug: "tools",
    title: "Tools",
    summary: "Typed, executable integrations. One file, one tool.",
    body: `# Tools

Drop a file in \`agent/tools/\` and the model can call it — the filename (snake_case ASCII) becomes the tool name. No registration.

\`\`\`ts
import { defineTool } from "ieva/tools";
import { z } from "zod";

export default defineTool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({ city: z.string().min(1) }),
  async execute({ city }, ctx) {
    return { city, condition: "Sunny", temperatureF: 72 };
  },
});
\`\`\`

- **\`inputSchema\`** — a Zod schema, any Standard Schema, or a plain JSON Schema object. For no input, \`z.object({})\`.
- **\`execute(input, ctx)\`** — runs in the trusted runtime with \`fetch\` and host config, *not* in the sandbox. Reach the sandbox with \`await ctx.getSandbox()\`.
- Tool outputs must be JSON-serializable.

## Approval — human-in-the-loop

\`\`\`ts
import { defineTool } from "ieva/tools";
import { always } from "ieva/tools/approval";

export default defineTool({
  description: "Refund a charge.",
  inputSchema: z.object({ chargeId: z.string(), amount: z.number() }),
  approval: always(), // pauses the turn for user approval
  async execute(input) { return refund(input); },
});
\`\`\`

\`always()\`, \`once()\`, \`never()\`, or a custom policy. A gated call parks the turn and emits \`input.requested\`.

## Overriding and disabling built-ins

Name a file after a built-in (\`bash\`, \`read_file\`, \`web_fetch\`, …) to override it, or:

\`\`\`ts
import { disableTool } from "ieva/tools";
export default disableTool();
\`\`\``,
  },

  skills: {
    slug: "skills",
    title: "Skills",
    summary: "Markdown playbooks, loaded on demand.",
    body: `# Skills

A skill is a markdown playbook the model loads only when relevant. The description is advertised up front; the body is appended to the turn when the model calls \`load_skill\`. This is progressive disclosure — the same model the broader Agent Skills standard uses.

\`\`\`md
<!-- agent/skills/release.md -->
---
description: Use when the user needs a release checklist or changelog workflow.
---
Follow these steps before cutting a release: ...
\`\`\`

**Loading a skill adds instructions, never a new execution surface.** Tools stay visible whether a skill is loaded or not.

## Description fallback

When \`description\` frontmatter is absent, ieva advertises the first non-empty, non-code-fence body line (leading \`#\`/\`>\`/\`*\`/\`-\` stripped), falling back to a weak literal. Write the description as *the task that should trigger activation*, not a label.

## Packaged skills

A directory with a \`SKILL.md\` plus sibling files (\`references/\`, \`assets/\`). The \`SKILL.md\` **must** carry a \`description\` — it has no filename to fall back on. Read bundled files from a tool with \`ctx.getSkill(id).file("references/checklist.md").text()\`.`,
  },

  subagents: {
    slug: "subagents",
    title: "Subagents",
    summary: "Specialist child agents with isolated capabilities.",
    body: `# Subagents

A declared subagent lives at \`agent/subagents/<id>/\` and is its own agent root — it inherits nothing from the parent's authored slots.

\`\`\`
agent/subagents/researcher/
├── agent.ts          # required; must export a description
├── instructions.md   # optional
├── tools/            # its own tools
└── skills/           # its own skills
\`\`\`

\`\`\`ts
// agent/subagents/researcher/agent.ts
import { defineAgent } from "ieva";

export default defineAgent({
  description: "Investigate ambiguous questions before the parent responds.",
  model: "anthropic/claude-sonnet-5",
});
\`\`\`

The \`description\` is required — the parent reads it to decide whether to delegate. The subagent registers as a tool named after its directory (\`researcher\`); a collision with a tool of the same name is a build error, not a silent winner.

**Isolation:** an absent slot falls back to the framework default, *not* to the parent's version. Its file writes are visible to the parent (shared sandbox); its conversation and state are fresh.`,
  },

  hooks: {
    slug: "hooks",
    title: "Hooks",
    summary: "Observe-only lifecycle subscribers.",
    body: `# Hooks

Authored at \`agent/hooks/<slug>.ts\`. Hooks observe the event stream — they **cannot block or modify** execution.

\`\`\`ts
import { defineHook } from "ieva/hooks";

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      console.info("session started", ctx.session.id);
    },
    async "message.completed"(event) {
      console.info("assistant finished", event.data.message);
    },
  },
});
\`\`\`

Return values are ignored. A \`"*"\` wildcard handler catches every event. A throwing hook surfaces as \`turn.failed\` rather than corrupting the loop.

The real interception points are elsewhere: a tool's \`approval\`, a tool's \`toModelOutput\`, \`defineDynamic\`, or overriding a built-in by filename.`,
  },

  state: {
    slug: "state",
    title: "State",
    summary: "Durable, session-scoped state.",
    body: `# State

\`defineState\` gives you session-scoped state that survives step boundaries, tab reloads, and hot reloads.

\`\`\`ts
import { defineState } from "ieva/context";

const budget = defineState("my-agent.budget", () => ({ count: 0, cap: 25 }));

// inside a tool:
const { count } = budget.update((s) => ({ ...s, count: s.count + 1 }));
if (count > budget.get().cap) throw new Error("Budget exceeded");
\`\`\`

Declare the handle at module scope. \`get()\`/\`update()\` only work inside a framework-managed context (a running tool or hook) — reaching for them at module top level throws.

State is committed into the session snapshot at every step, so it's part of what survives a reload. Subagents get fresh state — there's no inheritance.

> In the browser, compiled tool code and the harness are separate module graphs. ieva shares a single runtime instance into compiled modules (via a host-provided global), so \`defineState\` touches the *same* register the harness commits — not a second copy.`,
  },

  ingest: {
    slug: "ingest",
    title: "Ingesting a directory",
    summary: "Four ways to hand an agent directory to the browser.",
    body: `# Ingesting a directory

Every adapter mirrors an agent directory into the same OPFS-backed VFS, so the rest of the pipeline is source-agnostic.

\`\`\`ts
import {
  OpfsFileSystem,
  ingestFromPicker,
  ingestFromDropEntry,
  ingestFromZip,
  ingestFromUrl,
} from "@ieva/fs";

const vfs = await OpfsFileSystem.mount("agents");
\`\`\`

| Adapter | Notes |
|---|---|
| \`ingestFromPicker\` | File System Access picker → a **live** handle. Edits on disk can be re-synced (\`live.resync()\`) — powers hot reload. Chromium-only. |
| \`ingestFromDropEntry\` | A dropped folder. Works everywhere; one-shot snapshot. |
| \`ingestFromZip\` | A zip archive → OPFS. Powers share-by-URL and runnable docs examples. |
| \`ingestFromUrl\` | Fetch a zip from a URL and unpack it. |

## The one-call shortcut

For the common cases, skip the manual mount + per-file write and let \`@ieva/fs\` detect the agent directory inside the archive:

\`\`\`ts
import { mountAgentFromZip, mountAgentFromUrl, mountAgentFromFiles } from "@ieva/fs";

const { fs, root } = await mountAgentFromZip(zipBytes);
// then: bootstrapAgent({ fs, root, loader, registry, store })
\`\`\`

Root detection tolerates a wrapper directory — a zip that nests everything under \`my-agent/\` resolves to \`my-agent/agent\` automatically.

## The path index

just-bash's \`getAllPaths()\` is synchronous but OPFS is async, so \`OpfsFileSystem\` keeps a synchronous \`PathIndex\` in exact lockstep with writes. Without it, glob expansion (\`ls *.ts\`, \`find\`) would silently return nothing.`,
  },

  sandbox: {
    slug: "sandbox",
    title: "Sandbox",
    summary: "A pure-JS shell over OPFS.",
    body: `# Sandbox

The built-in filesystem tools (\`bash\`, \`read_file\`, \`write_file\`, \`glob\`, \`grep\`) run over [just-bash](https://github.com/vercel-labs/just-bash) — a pure-JavaScript shell — backed by the OPFS filesystem. No real binaries, no VM.

\`\`\`ts
// inside a tool
const sandbox = await ctx.getSandbox();
await sandbox.writeTextFile({ path: "notes.md", content: "# Findings" });
const { stdout } = await sandbox.run({ command: "grep -r TODO ." });
\`\`\`

Files under \`agent/sandbox/workspace/**\` are seeded into \`/workspace\` at session bootstrap.

## What you get and don't

The shell is a fidelity boundary, not a security boundary — it's a simulated shell over a virtual filesystem, and it does not contain JavaScript. Coreutils are implemented in JS (\`ls\`, \`cat\`, \`grep\`, \`sed\`, \`awk\`, \`jq\`, \`find\`, …). What's **not** available in the browser: \`python3\`, \`sqlite3\`, real \`git\`/\`node\`, and package managers.`,
  },

  durability: {
    slug: "durability",
    title: "Durability",
    summary: "Every turn is a checkpointed workflow. A reload is a crash.",
    body: `# Durability

Every turn runs as a session → turn → step progression, and **step results are the atomic persistence boundary** — each committed step overwrites the session's snapshot in IndexedDB. A tab reload is the browser's version of a server crash: sessions resume.

\`\`\`ts
import { IdbStore } from "@ieva/store-idb";

const store = await IdbStore.open();
const { client } = await bootstrapAgent({ /* ... */ store, sessionId, resume: true });

// list and manage prior sessions
const sessions = await store.listSessions(); // newest first
\`\`\`

## The redeploy-safety invariant

The snapshot **never** stores the model reference, tool set, or compaction config — those are rebuilt from the manifest every turn. In eve this keeps redeploys from breaking in-flight sessions; in the browser the *same* invariant is what makes **hot reload safe mid-conversation** — swapping a tool on disk can't corrupt a running session.

## Interrupted steps re-run

A step interrupted mid-execution re-runs on resume. Make non-idempotent side effects (charges, emails) idempotent, or gate them behind \`approval\`.`,
  },

  models: {
    slug: "models",
    title: "Models",
    summary:
      "BYOK cloud and local WebGPU, behind one registry — plus how local tool calling works.",
    body: `# Models

Everything about which model runs your agent flows through three pieces:

1. **A model reference** — a gateway-style id string like \`anthropic/claude-sonnet-5\`, \`openai/gpt-4o-mini\`, or \`transformers/onnx-community/gemma-4-E2B-it-ONNX\`, declared on the agent.
2. **A registry** — resolves that id to a runnable model. \`createModelRegistry\` from \`@ieva/model\` handles the two built-in providers; you can also supply your own.
3. **The \`AgentModel\` contract** — the narrow interface the harness drives. Every provider, cloud or local, implements the same \`generate(request, signal)\`.

The harness never knows *which* provider it's talking to. Each step it builds a request — the assembled system prompt, the running message history, and the advertised tools — hands it to \`model.generate\`, and reads back text, tool calls, and a finish reason.

## Configuring the registry

\`\`\`ts
import { createModelRegistry } from "@ieva/model";

const registry = createModelRegistry({
  // BYOK keys per provider prefix. Stored and supplied by the host.
  apiKeys: { anthropic: anthropicKey, openai: openaiKey },

  // Per-provider overrides for the local transformers.js adapter.
  transformers: { dtype: "q4f16", onProgress: (r) => console.log(r) },

  // Per-provider overrides for Anthropic (e.g. a server-side proxy).
  anthropic: { baseUrl: "https://your-proxy.example/v1/messages" },

  // Point openai/* at any OpenAI-compatible endpoint (Groq, Together, Ollama, …).
  openai: { baseUrl: "https://api.groq.com/openai/v1" },
});
\`\`\`

| Option | Shape | Purpose |
|---|---|---|
| \`apiKeys\` | \`{ anthropic?, openai? }\` | BYOK keys, keyed by provider prefix. Required to resolve that provider's ids. |
| \`transformers\` | \`{ dtype?, device?, maxNewTokens?, onProgress? }\` | Defaults applied to every \`transformers/…\` model (see **Local WebGPU** below). |
| \`anthropic\` | \`{ maxTokens?, baseUrl?, fetch? }\` | Overrides for the Anthropic adapter — most importantly a proxy \`baseUrl\`/\`fetch\`. |
| \`openai\` | \`{ maxTokens?, baseUrl?, fetch?, headers? }\` | Overrides for the OpenAI adapter — the \`baseUrl\` selects which compatible provider you hit. |

Resolved models are **memoized by reference**, so repeated turns reuse the same instance. This matters most for local models, whose weight load is expensive — you pay it once per session, not once per turn.

| Prefix | Provider |
|---|---|
| \`anthropic/<model>\` | BYOK cloud. Calls the Anthropic Messages API directly from the browser. |
| \`openai/<model>\` | OpenAI-compatible cloud (Chat Completions). OpenAI itself, or Groq / Together / OpenRouter / Fireworks / Ollama / LM Studio via \`openai.baseUrl\`. |
| \`transformers/<model>\` | Local WebGPU inference via [transformers.js](https://huggingface.co/docs/transformers.js) (ONNX Runtime Web). |

A bare id with no known prefix routes to Anthropic (\`claude-sonnet-5\` ≡ \`anthropic/claude-sonnet-5\`).

## Selecting a model for an agent

The reference lives in \`agent.ts\` (see [agent.ts](#/docs/agent-config) for the full field list):

\`\`\`ts
import { defineAgent } from "ieva";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",       // or "transformers/onnx-community/gemma-4-E2B-it-ONNX"
});
\`\`\`

- **Omit \`agent.ts\` entirely** and the agent defaults to \`anthropic/claude-sonnet-5\`. If the file exists, \`model\` is mandatory.
- **Subagents can run a different model** than their parent — a cheap local model for a narrow classifier, a strong cloud model for the orchestrator.
- \`reasoning\` and \`limits\` are declared alongside \`model\`. \`reasoning\` is a provider-agnostic effort hint; note the two bundled providers don't forward it yet, so treat it as forward-looking config.

### Dynamic models

Pick the model at runtime from session context — e.g. upgrade paying users, or fall back to a local model when offline:

\`\`\`ts
import { defineAgent, defineDynamic } from "ieva";

export default defineAgent({
  model: defineDynamic({
    fallback: "anthropic/claude-sonnet-5",
    events: {
      "session.started": (_e, ctx) =>
        ctx.session.auth?.plan === "enterprise" ? "anthropic/claude-opus-4-8" : null,
    },
  }),
});
\`\`\`

## Anthropic (BYOK cloud)

The Anthropic adapter calls the Messages API **directly from the browser** using the \`anthropic-dangerous-direct-browser-access\` header. It's non-streaming (the harness synthesizes a single cumulative append) and uses the provider's native tool-use protocol, so tool calling is fully reliable.

\`\`\`ts
// Resolved from: model: "anthropic/claude-sonnet-5"
createModelRegistry({ apiKeys: { anthropic: userKey } });
\`\`\`

**Never ship your own key to end users.** BYOK means *the user's* key, entered in your UI and kept client-side. If you want to bill server-side instead, route through a proxy that injects the key and never send it to the client:

\`\`\`ts
createModelRegistry({
  apiKeys: { anthropic: "unused" }, // presence gates resolution; the proxy holds the real key
  anthropic: {
    baseUrl: "https://your-proxy.example/v1/messages",
    fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
  },
});
\`\`\`

\`maxTokens\` defaults to 16000; override it per registry via \`anthropic.maxTokens\`.

## OpenAI-compatible cloud

The \`openai/<model>\` provider speaks the **Chat Completions** wire format — so it drives OpenAI itself *and* the large ecosystem of providers that copy that API. Point \`openai.baseUrl\` at whichever one you want; \`/chat/completions\` is appended. Tool calling uses the provider's native \`tools\`/\`tool_calls\`, so it's reliable.

\`\`\`ts
// OpenAI proper
createModelRegistry({ apiKeys: { openai: userKey } });
// model: "openai/gpt-4o-mini"

// Groq (fast Llama hosting) — same adapter, different baseUrl
createModelRegistry({
  apiKeys: { openai: groqKey },
  openai: { baseUrl: "https://api.groq.com/openai/v1" },
});
// model: "openai/llama-3.3-70b-versatile"

// A local Ollama server — no key needed
createModelRegistry({
  apiKeys: { openai: "ollama" },
  openai: { baseUrl: "http://localhost:11434/v1" },
});
// model: "openai/llama3.2"
\`\`\`

| Provider | \`baseUrl\` | Example model id |
|---|---|---|
| OpenAI | *(default)* | \`openai/gpt-4o-mini\` |
| Groq | \`https://api.groq.com/openai/v1\` | \`openai/llama-3.3-70b-versatile\` |
| Together | \`https://api.together.xyz/v1\` | \`openai/meta-llama/Llama-3.3-70B-Instruct-Turbo\` |
| OpenRouter | \`https://openrouter.ai/api/v1\` | \`openai/anthropic/claude-3.5-sonnet\` |
| Fireworks | \`https://api.fireworks.ai/inference/v1\` | \`openai/accounts/fireworks/models/llama-v3p3-70b-instruct\` |
| Ollama (local) | \`http://localhost:11434/v1\` | \`openai/llama3.2\` |
| LM Studio (local) | \`http://localhost:1234/v1\` | \`openai/<loaded-model>\` |

Pass \`openai.headers\` for providers that want extra headers (e.g. OpenRouter's \`HTTP-Referer\`/\`X-Title\`). \`maxTokens\` defaults to 4096; raise it via \`openai.maxTokens\` for long tool loops.

> **Browser CORS.** OpenAI's own API does **not** send CORS headers, so a direct browser call to \`api.openai.com\` is blocked. For a browser app, either use a provider that allows browser origins or — for BYOK — route \`baseUrl\`/\`fetch\` through your own proxy that forwards to the provider. (Anthropic is the exception: its \`anthropic-dangerous-direct-browser-access\` header opts into direct browser calls.)

## Local WebGPU (transformers.js)

Local models run fully on the user's GPU through transformers.js (ONNX Runtime Web). **Nothing leaves the tab.** Weights download once and are cached in the browser's Cache API; subsequent loads are offline.

### Recommended offline models

Any text-generation ONNX model with a chat template works. The reference is \`transformers/<repo-id>\`, e.g. \`transformers/onnx-community/gemma-4-E2B-it-ONNX\`. These are the models to reach for, grouped by what they're good at — sizes are the quantized download.

**Best for tool-using agents** (bigger models follow the tool protocol far more reliably):

| Model | repo id | dtype | ~Size | Notes |
|---|---|---|---|---|
| **Gemma 4 E2B** | \`onnx-community/gemma-4-E2B-it-ONNX\` | \`q4f16\` | 2.5 GB | Best tested local tool-caller — verified end-to-end in ieva. |
| Qwen3 4B | \`onnx-community/Qwen3-4B-ONNX\` | \`q4f16\` | ~2.5 GB | Strong reasoning + tools; add \`/no_think\` handling (ieva does this). |
| Llama 3.2 3B Instruct | \`onnx-community/Llama-3.2-3B-Instruct-ONNX\` | \`q4f16\` | ~2 GB | Native tool-use template; solid all-rounder. |

**Good for chat, light tool use** (fast to load, tool calling gets shaky as they shrink):

| Model | repo id | dtype | ~Size | Notes |
|---|---|---|---|---|
| Qwen3 1.7B | \`onnx-community/Qwen3-1.7B-ONNX\` | \`q4f16\` | 1.9 GB | Good balance of size and capability. |
| Llama 3.2 1B Instruct | \`onnx-community/Llama-3.2-1B-Instruct-ONNX\` | \`q4f16\` | ~1 GB | Snappy; occasional tool calls. |
| SmolLM2 1.7B Instruct | \`onnx-community/SmolLM2-1.7B-Instruct\` | \`q4f16\` | ~1.7 GB | Capable tiny chat model. |
| Qwen3 0.6B | \`onnx-community/Qwen3-0.6B-ONNX\` | \`q4f16\` | 900 MB | Chat-only in practice — tends to answer directly instead of calling tools. |

**Tiniest** (chat demos, near-instant load):

| Model | repo id | dtype | ~Size | Notes |
|---|---|---|---|---|
| Gemma 3 270M | \`onnx-community/gemma-3-270m-it-ONNX\` | \`q4\` | 300 MB | Must use \`q4\` (see dtype note); too small for tools. |

The [playground](#/playground) can load four of these with one click — Qwen3 0.6B, Qwen3 1.7B, Gemma 3 270M, and Gemma 4 E2B — while the rest resolve fine through the registry in your own app. Browse the [onnx-community org](https://huggingface.co/onnx-community) on Hugging Face for the full catalog; anything published there with WebGPU weights loads the same way.

\`TransformersOptions\` (set globally via \`transformers\` on the registry, or per model):

| Field | Default | Notes |
|---|---|---|
| \`dtype\` | \`q4f16\` | Quantization. Gemma 3 must use \`q4\` — its fp16/q4f16 builds hit an overflow bug in ONNX Runtime's WebGPU backend. |
| \`device\` | \`webgpu\` | \`webgpu\` or \`wasm\`. |
| \`maxNewTokens\` | \`512\` | Generation budget per step — must fit a short reasoning preamble *plus* the tool call or final answer. |
| \`onProgress\` | — | Weight-download progress callback, for a loading bar. |

Two things worth knowing:

- **WebGPU needs no special headers.** Unlike WASM-multithreaded runtimes (which need COOP/COEP cross-origin isolation), the WebGPU path runs on a plain static host — which is why the playground works served from GitHub Pages.
- **Run generation off the main thread.** The playground loads the model in a Web Worker so weight loading and token generation never freeze the UI. \`createTransformersModel\` (the package adapter) runs inline; for a responsive app, mirror the worker pattern.

The [playground](#/playground) exposes all of this: pick a model, load it with a progress bar, see whether it's cached, and unload or delete the cache.

## Tool calling on local models

This is the part that differs most from cloud. Cloud models have a **native tool-use channel** — the provider returns structured tool calls. Small local models don't. So ieva does **prompt-based tool calling**, implemented in \`@ieva/model/tool-prompt\` and shared by both the package adapter and the playground's worker. Three mechanisms stack:

1. **System-prompt catalogue.** Each tool's name, description, and JSON Schema are appended to the system prompt, with a one-shot example and an instruction to reply with a single JSON object when calling a tool.
2. **Native chat-template tools.** The tools are *also* passed to the model's chat template (\`toNativeTools\` → the transformers.js \`tools\` option). Templates that declare \`tool_use\` (Qwen, Llama 3.1, Hermes, …) render them in the model's trained format; templates without it ignore them harmlessly.
3. **Lenient parsing.** \`parseToolCalls\` reads the reply back. It tries strict JSON first (\`{"tool_call": {name, arguments}}\` or bare \`{name, arguments}\`, fenced or not). If that fails, it falls back to a tolerant scan for a known tool name followed by a brace/paren group of loose key/value pairs — because tiny models routinely emit near-JSON like \`call:multiply{a:1,b:2}\` or \`multiply(a=1, b=2)\` that \`JSON.parse\` rejects.

Tool-call and tool-result messages are serialized back into the chat history as text, so the model sees the calls it made and the results it got. For reasoning models (Qwen3), a \`/no_think\` directive is injected so the model doesn't spend its whole token budget thinking through the task by hand instead of calling the tool.

### Reliability scales with model size

| Model | Tool calling |
|---|---|
| **Gemma 4 E2B** | Works — reliably emits a tool call and answers from the result. The best local pick for tool use. |
| Qwen3 1.7B | Usable; larger is better. |
| Qwen3 0.6B | Tends to answer directly instead of calling the tool, even when instructed. |
| Gemma 3 270M | Too small — answers directly. |

If your agent depends on tools, prefer **Gemma 4 E2B** locally, or a cloud model. If it's chat-only, any of them work and the smallest load fastest.

## Writing a custom provider

The bundled providers cover Anthropic, OpenAI-compatible, and local models — but the registry is just an object with \`resolve(reference) => Promise<AgentModel>\`. Supply your own to \`bootstrapAgent\` to support anything else — a Google Gemini endpoint, a bespoke gateway, or a mock for tests:

\`\`\`ts
import type { AgentModel, ModelRegistry } from "ieva/runtime";

const myModel: AgentModel = {
  id: "custom/my-model",
  async generate(request, signal) {
    // request = { system, messages, tools }
    const res = await callYourBackend(request, signal);
    return {
      text: res.text,
      toolCalls: res.toolCalls, // [{ callId, name, input }]
      finishReason: res.toolCalls.length ? "tool-calls" : "stop",
    };
  },
};

const registry: ModelRegistry = {
  resolve: async (reference) =>
    reference.startsWith("custom/") ? myModel : builtinRegistry.resolve(reference),
};
\`\`\`

The contract: \`generate\` receives \`{ system, messages, tools }\` and returns \`{ text, toolCalls, finishReason, usage? }\`. \`finishReason\` must be \`"tool-calls"\` (with a non-empty \`toolCalls\`) for the loop to execute tools and continue, or \`"stop"\`/\`"length"\` to end the turn. \`stream\` is optional — implement only \`generate\` and the harness synthesizes a single cumulative append. If your backend lacks native tool use, reuse \`buildToolSystemPrompt\`/\`toNativeTools\`/\`parseToolCalls\` from \`@ieva/model/tool-prompt\` to get the same behavior the local adapter uses.`,
  },

  "project-layout": {
    slug: "project-layout",
    title: "Project layout",
    summary: "The conventional agent directory.",
    body: `# Project layout

\`\`\`
my-agent/
├── package.json          # #name is the root agent's identity
└── agent/
    ├── agent.ts          # model + runtime config (optional)
    ├── instructions.md   # the system prompt (required on root)
    ├── tools/            # one file = one tool
    ├── skills/           # markdown playbooks
    ├── subagents/        # specialist child agents
    ├── hooks/            # observe-only subscribers
    └── sandbox/
        └── workspace/    # files seeded into /workspace
\`\`\`

Rules the compiler enforces:

- Root name from \`package.json#name\`, falling back to the directory name. Subagent name from its directory.
- Tool names must be snake_case ASCII.
- Root \`instructions\` is required; root \`agent.ts\` is optional but needs \`model\` if present. Inverts on subagents.
- A subagent name colliding with a tool name is a build error.

Discovery **never executes authored code** — the path determines the slot; brands are validated only when a module is imported at compile time.`,
  },

  packages: {
    slug: "packages",
    title: "Packages",
    summary: "The monorepo, package by package.",
    body: `# Packages

| Package | What it does |
|---|---|
| \`ieva\` | The framework: the \`define*\` API, discovery, the agent loop, the event protocol, the durable-store contract. Environment-free and fully testable under Bun. |
| \`@ieva/fs\` | OPFS-backed VFS implementing just-bash's \`IFileSystem\`, the sync path index, and the ingest adapters. |
| \`@ieva/compiler\` | In-browser compiler: discovery + esbuild-wasm loading + brand validation → a runnable \`LoadedAgent\`. |
| \`@ieva/store-idb\` | IndexedDB checkpoint store. |
| \`@ieva/model\` | Model providers — BYOK Anthropic and local transformers.js (WebGPU) — behind a registry. |
| \`@ieva/kit\` | \`bootstrapAgent()\` — discover → compile → client in one call. |
| \`@ieva/react\` | The \`useIevaAgent()\` hook. |

ESM-only, strict \`exports\` maps, Apache-2.0. The core logic (discovery, compile orchestration, the harness, the path index) is deliberately environment-free, so the majority of the framework runs under the Bun test runner; the browser adapters are exercised in the playground.`,
  },
};
