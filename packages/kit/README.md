# @ieva/kit

One-call bootstrap for [ieva](../../README.md): discover → compile → runnable `Client`.

```ts
import { bootstrapAgent, BootstrapError } from "@ieva/kit";

try {
  const { client, manifest } = await bootstrapAgent({
    fs,          // a ReadFs (OpfsFileSystem.asReadFs() in the browser)
    root: "/agents/my-agent/agent",
    loader,      // a ModuleLoader (EsbuildLoader in the browser)
    registry,    // a ModelRegistry (@ieva/model)
    store,       // a CheckpointStore (@ieva/store-idb)
    resume: true, sessionId: "abc",   // optional: continue a prior session
  });

  client.on((e) => console.log(e.type));
  console.log(await client.send("hello"));
} catch (err) {
  if (err instanceof BootstrapError) {
    // Structured discovery/compile diagnostics — the developer error surface.
    console.error(err.diagnostics);
  }
}
```

`bootstrapAgent` throws `BootstrapError` (carrying the structured diagnostics) if discovery or compilation produced any error — a name collision, a missing description, a tool that didn't `export default defineTool(...)`. Otherwise you get a live `Client` plus the resolved manifest.

Apache-2.0.
