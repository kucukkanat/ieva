# @ieva/react

React bindings for [ieva](../../README.md). One hook drives an agent `Client` and tracks its event stream.

```tsx
import { useState, useEffect } from "react";
import { bootstrapAgent, type Client } from "@ieva/kit";
import { useIevaAgent } from "@ieva/react";

function Chat() {
  const [client, setClient] = useState<Client>();

  useEffect(() => {
    bootstrapAgent({ /* fs, root, loader, registry, store */ }).then((r) => setClient(r.client));
  }, []);

  const { message, running, error, send } = useIevaAgent(client);

  return (
    <div>
      <p>{message}</p>
      {error && <p role="alert">{error.message}</p>}
      <button disabled={!client || running} onClick={() => send("What's the weather in Paris?")}>
        {running ? "Thinking…" : "Ask"}
      </button>
    </div>
  );
}
```

`useIevaAgent` returns:

- `message` — the latest assistant text, updated as the turn progresses
- `events` — the ordered live event log (seeded from the client's retained replay)
- `running` — whether a turn is in flight
- `error` — the last send error, if any
- `send(text)` — send a user message; resolves with the final assistant text

The hook is transport-agnostic — it works whether the `Client` talks to an in-page harness or one running behind a Web Worker message port.

Apache-2.0.
