# @ieva/store-idb

IndexedDB-backed durable checkpoint store for [ieva](../../README.md). Each committed step overwrites the session's snapshot record — step results are the atomic persistence boundary — so a tab reload is a recoverable crash rather than lost work.

```ts
import { IdbStore } from "@ieva/store-idb";

const store = await IdbStore.open();

// Pass to the harness / bootstrapAgent:
const { client } = await bootstrapAgent({ /* ... */ store });

// List and resume sessions:
const sessions = await store.listSessions(); // newest first
await store.deleteSession(someId);
```

Implements ieva's `CheckpointStore` contract (`loadSession`, `commitStep`, `listSessions`, `deleteSession`). The snapshot deliberately omits the model and tool config — those are rebuilt from the manifest each turn — so resuming a session after a redeploy or a hot reload can't load stale capabilities.

Apache-2.0.
