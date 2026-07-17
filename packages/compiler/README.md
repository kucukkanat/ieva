# @ieva/compiler

Turns a discovered [ieva](../../README.md) agent directory into a runnable `LoadedAgent`: it assembles instructions, imports every module-backed slot, validates each default export's brand, and recurses into subagents.

The module-loading strategy is a pluggable `ModuleLoader`. In the browser that's esbuild-wasm + blob URLs; in tests it's the host's native `import()` — which is what keeps the compiler's orchestration fully testable without a bundler.

## Compile

```ts
import { discover } from "ieva/runtime";
import { compileAgent } from "@ieva/compiler";
import { EsbuildLoader } from "@ieva/compiler/esbuild";
import esbuild from "esbuild-wasm";

const manifest = await discover(fs, "/agents/my-agent/agent");

const loader = await EsbuildLoader.create(esbuild, {
  fs,
  wasmURL: "/esbuild.wasm",
  ievaModuleUrls: {
    ieva: "/runtime/ieva.js",
    "ieva/tools": "/runtime/tools.js",
    // ...one entry per ieva subpath your agents import
  },
  // Bare deps resolve to absolute esm.sh URLs by default; override to self-host.
  resolveBare: (name) => `https://esm.sh/${name}`,
});

const { agent, diagnostics } = await compileAgent(manifest, fs, loader);
```

`agent.tools.get("get_weather")?.execute(...)` now runs the real authored code. `diagnostics` carries any `*/bad-export` errors (e.g. a tool file that didn't `export default defineTool(...)`).

## How the esbuild loader resolves imports

- `ieva` and its subpaths → the host-provided runtime URLs (marked external, imported directly by the compiled blob).
- Bare specifiers (`zod`, …) → absolute CDN URLs (external — no import map needed).
- `.ts` and `.js` both transpile, so an eve-style `.ts` agent directory runs unmodified.

`esbuild-wasm` is an optional peer dependency.

Apache-2.0.
