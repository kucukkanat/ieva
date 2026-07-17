import type { ReadFs } from "ieva/runtime";
import { joinPath } from "ieva/runtime";
import { ingestFromUrl, ingestFromZip } from "./ingest.ts";
import { OpfsFileSystem } from "./opfs.ts";

export interface MountedAgent {
  /** The OPFS-backed VFS the agent was written into. */
  readonly vfs: OpfsFileSystem;
  /** Read-only projection for discovery/compilation. */
  readonly fs: ReadFs;
  /** The detected agent directory root — pass straight to `bootstrapAgent`. */
  readonly root: string;
}

export interface MountOptions {
  /** OPFS subdirectory to mount into (keeps multiple agents isolated). Default "ieva". */
  readonly opfsRoot?: string;
  /** Base path inside the VFS to unpack under. Default "/agent-src". */
  readonly base?: string;
}

/**
 * The one-call path from a zip to a runnable agent: mount OPFS, unpack the archive, and
 * auto-detect the agent directory. Pair with `bootstrapAgent({ fs, root })`.
 *
 *   const { fs, root } = await mountAgentFromZip(bytes);
 *   const { client } = await bootstrapAgent({ fs, root, loader, registry, store });
 */
export async function mountAgentFromZip(
  data: Uint8Array,
  options: MountOptions = {},
): Promise<MountedAgent> {
  const base = options.base ?? "/agent-src";
  const vfs = await OpfsFileSystem.mount(options.opfsRoot ?? "ieva");
  await ingestFromZip(vfs, data, base);
  return finish(vfs, base);
}

/** Fetch a zip from a URL and mount it — the share-a-link entry point. */
export async function mountAgentFromUrl(
  url: string,
  options: MountOptions = {},
): Promise<MountedAgent> {
  const base = options.base ?? "/agent-src";
  const vfs = await OpfsFileSystem.mount(options.opfsRoot ?? "ieva");
  await ingestFromUrl(vfs, url, base);
  return finish(vfs, base);
}

/** Write an in-memory file map and mount it — handy for fixtures and inline examples. */
export async function mountAgentFromFiles(
  files: Readonly<Record<string, string>>,
  options: MountOptions = {},
): Promise<MountedAgent> {
  const base = options.base ?? "/agent-src";
  const vfs = await OpfsFileSystem.mount(options.opfsRoot ?? "ieva");
  for (const [path, content] of Object.entries(files)) {
    await vfs.writeFile(joinPath(base, path), content);
  }
  return finish(vfs, base);
}

async function finish(vfs: OpfsFileSystem, base: string): Promise<MountedAgent> {
  const fs = vfs.asReadFs();
  const root = await detectAgentRoot(fs, base);
  return { vfs, fs, root };
}

/**
 * Find the agent directory inside a freshly-unpacked tree. The agent root is the
 * shallowest directory that directly carries instructions (a flat `instructions.md`/`.ts`
 * or an `instructions/` directory) — that's exactly what `discover` treats as the root.
 * Tolerates a wrapper directory (zips often nest everything under `my-agent/`).
 */
export async function detectAgentRoot(fs: ReadFs, base = "/"): Promise<string> {
  const queue: string[] = [base];
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    if (await looksLikeAgentRoot(fs, dir)) return dir;
    const entries = await fs.readdir(dir).catch(() => []);
    for (const entry of entries) {
      if (entry.kind === "directory") queue.push(joinPath(dir, entry.name));
    }
  }
  throw new Error(
    `No agent directory found under "${base}". Expected an instructions.md (or .ts, or an instructions/ directory) somewhere in the archive.`,
  );
}

async function looksLikeAgentRoot(fs: ReadFs, dir: string): Promise<boolean> {
  return (
    (await fs.exists(joinPath(dir, "instructions.md"))) ||
    (await fs.exists(joinPath(dir, "instructions.ts"))) ||
    (await fs.exists(joinPath(dir, "instructions")))
  );
}
