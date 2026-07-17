# @ieva/fs

OPFS-backed virtual filesystem for [ieva](../../README.md). It implements just-bash's `IFileSystem` (so the sandbox shell runs over the same bytes), projects to ieva's read-only `ReadFs` for discovery, and ships the directory-ingest adapters.

## Mount and ingest

```ts
import { OpfsFileSystem, ingestFromPicker, ingestFromZip } from "@ieva/fs";

const vfs = await OpfsFileSystem.mount("agents/my-agent");

// Live handle from the disk picker (Chromium) — supports hot reload.
const { live } = await ingestFromPicker(vfs, "/agents/my-agent");
const changed = await live.resync(); // re-read after editing on disk

// Or from a zip (share-by-URL, docs examples) — works in every browser.
await ingestFromZip(vfs, zipBytes, "/agents/my-agent");
```

## Use with discovery

```ts
import { discover } from "ieva/runtime";
const manifest = await discover(vfs.asReadFs(), "/agents/my-agent/agent");
```

## The path index

just-bash's `getAllPaths()` and `resolvePath()` are synchronous, but OPFS is async. `OpfsFileSystem` keeps a synchronous `PathIndex` in exact lockstep with OPFS writes so globbing (`ls *.ts`, `find`, `**`) works. The index is a pure, standalone data structure:

```ts
import { PathIndex } from "@ieva/fs/path-index";
const idx = new PathIndex();
idx.addFile("/workspace/a/b.ts");
idx.all();               // ["/workspace/a/b.ts"]
idx.readdir("/workspace"); // [{ name: "a", kind: "directory" }]
```

## Notes

- `fflate` is an optional peer dependency, imported lazily only for zip ingest.
- The just-bash browser build statically imports `node:zlib`; alias it (e.g. to a `DecompressionStream` shim) in your bundler or lose `gzip`/`gunzip`/`zcat`.

Apache-2.0.
