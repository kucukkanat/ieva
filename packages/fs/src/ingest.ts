import type { OpfsFileSystem } from "./opfs.ts";

/**
 * Ingest adapters mirror an agent directory from some source into the OPFS-backed VFS.
 * They all produce the same thing — a populated `OpfsFileSystem` rooted at the agent
 * directory — so the rest of the pipeline is source-agnostic.
 */
export interface IngestResult {
  readonly fileCount: number;
}

/** A live handle back to disk, when the source supports it (FSA picker only). */
export interface LiveHandle {
  /** Re-read the source and apply changes to the VFS. Powers hot reload. */
  resync(): Promise<string[]>;
}

interface FsDirectoryHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FsDirectoryHandle | FsFileHandle]>;
}
interface FsFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
}

/**
 * File System Access picker → OPFS. The only source that yields a live handle: edits in
 * the user's editor can be re-synced without re-picking. Chromium-only.
 */
export async function ingestFromPicker(
  target: OpfsFileSystem,
  root: string,
): Promise<{ result: IngestResult; live: LiveHandle }> {
  const picker = (globalThis as unknown as {
    showDirectoryPicker?: () => Promise<FsDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) {
    throw new Error(
      "showDirectoryPicker is unavailable. Use drag-and-drop or zip ingest on this browser.",
    );
  }
  const handle = await picker();
  const count = await copyDirectory(handle, target, root);
  return {
    result: { fileCount: count },
    live: {
      resync: async () => {
        const changed: string[] = [];
        await copyDirectory(handle, target, root, changed);
        return changed;
      },
    },
  };
}

/** A dropped directory (webkitGetAsEntry / DataTransfer). Universal; one-shot snapshot. */
export async function ingestFromDropEntry(
  target: OpfsFileSystem,
  entry: FsDirectoryHandle,
  root: string,
): Promise<IngestResult> {
  const count = await copyDirectory(entry, target, root);
  return { fileCount: count };
}

/**
 * A zip archive → OPFS. Powers share-by-URL and the runnable docs examples. `fflate`
 * is an optional peer dependency; import it lazily so consumers who never use zip
 * ingest do not pay for it.
 */
export async function ingestFromZip(
  target: OpfsFileSystem,
  data: Uint8Array,
  root: string,
): Promise<IngestResult> {
  const { unzipSync } = await import("fflate");
  const files = unzipSync(data);
  let count = 0;
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith("/")) continue;
    await target.writeFile(joinRoot(root, name), bytes as Uint8Array);
    count += 1;
  }
  return { fileCount: count };
}

/** Fetch a zip from a URL and unpack it. The share-a-link entry point. */
export async function ingestFromUrl(
  target: OpfsFileSystem,
  url: string,
  root: string,
): Promise<IngestResult> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  return ingestFromZip(target, data, root);
}

async function copyDirectory(
  dir: FsDirectoryHandle,
  target: OpfsFileSystem,
  prefix: string,
  changed?: string[],
): Promise<number> {
  let count = 0;
  for await (const [name, handle] of dir.entries()) {
    const path = joinRoot(prefix, name);
    if (handle.kind === "directory") {
      count += await copyDirectory(handle, target, path, changed);
    } else {
      const text = await (await handle.getFile()).text();
      if (changed) {
        const prior = (await target.exists(path)) ? await target.readFile(path) : undefined;
        if (prior !== text) changed.push(path);
      }
      await target.writeFile(path, text);
      count += 1;
    }
  }
  return count;
}

function joinRoot(root: string, name: string): string {
  const clean = name.replace(/^\.?\//, "");
  return `${root.replace(/\/$/, "")}/${clean}`;
}
