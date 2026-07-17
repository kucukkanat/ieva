import type { DirEntry, ReadFs } from "ieva/runtime";
import { normalize, PathIndex } from "./path-index.ts";

/**
 * The subset of just-bash's `IFileSystem` we implement. Declared structurally so we do
 * not depend on just-bash's types at build time — the sandbox package wires the real
 * `new Bash({ fs })` against this. Async methods map cleanly onto OPFS; the two
 * synchronous ones (`getAllPaths`, `resolvePath`) are served from the PathIndex.
 */
export interface IFileSystem {
  readFile(path: string): Promise<string>;
  readFileBuffer(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  appendFile(path: string, content: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FsStat>;
  lstat(path: string): Promise<FsStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  cp(src: string, dest: string): Promise<void>;
  mv(src: string, dest: string): Promise<void>;
  resolvePath(base: string, path: string): string;
  getAllPaths(): string[];
  realpath(path: string): Promise<string>;
}

export interface FsStat {
  isFile: () => boolean;
  isDirectory: () => boolean;
  size: number;
}

/** Minimal structural view of the OPFS handles we use. */
interface DirHandle {
  kind: "directory";
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, DirHandle | FileHandle]>;
}
interface FileHandle {
  kind: "file";
  getFile(): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; size: number }>;
  createWritable(): Promise<{ write(data: string | Uint8Array): Promise<void>; close(): Promise<void> }>;
}

/**
 * An OPFS-backed filesystem implementing just-bash's `IFileSystem` (so the sandbox
 * shell runs over these bytes). `asReadFs()` projects the same store to ieva's
 * read-only `ReadFs` for discovery — the two interfaces disagree on `readdir`'s return
 * type, so a projection is cleaner than implementing both. Call `mount()` once before
 * use to hydrate the path index.
 */
export class OpfsFileSystem implements IFileSystem {
  private readonly index = new PathIndex();

  private constructor(private readonly rootDir: DirHandle) {}

  static async mount(subdir?: string): Promise<OpfsFileSystem> {
    const storage = (navigator as unknown as {
      storage: { getDirectory(): Promise<DirHandle> };
    }).storage;
    let root = await storage.getDirectory();
    if (subdir) {
      for (const part of subdir.split("/").filter(Boolean)) {
        root = await root.getDirectoryHandle(part, { create: true });
      }
    }
    const fs = new OpfsFileSystem(root);
    await fs.hydrate("/", root);
    return fs;
  }

  /** Project this store as ieva's read-only ReadFs, for discovery. */
  asReadFs(): ReadFs {
    return {
      readdir: async (path: string): Promise<DirEntry[]> => this.index.readdir(path),
      readTextFile: (path: string) => this.readFile(path),
      exists: (path: string) => this.exists(path),
    };
  }

  // ── just-bash IFileSystem ────────────────────────────────────────────────────

  async readFile(path: string): Promise<string> {
    const handle = await this.fileHandle(path, false);
    return (await handle.getFile()).text();
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const handle = await this.fileHandle(path, false);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const handle = await this.fileHandle(path, true);
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    this.index.addFile(path);
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<void> {
    const existing = (await this.exists(path)) ? await this.readFile(path) : "";
    const suffix = typeof content === "string" ? content : new TextDecoder().decode(content);
    await this.writeFile(path, existing + suffix);
  }

  async exists(path: string): Promise<boolean> {
    return this.index.exists(path);
  }

  async stat(path: string): Promise<FsStat> {
    const p = normalize(path);
    if (this.index.hasDir(p)) return dirStat();
    const handle = await this.fileHandle(p, false);
    const size = (await handle.getFile()).size;
    return { isFile: () => true, isDirectory: () => false, size };
  }

  lstat(path: string): Promise<FsStat> {
    return this.stat(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.dirHandle(path, true, options?.recursive ?? false);
    this.index.addDir(path);
  }

  async readdir(path: string): Promise<string[]> {
    return this.index.readdir(path).map((e) => e.name);
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const p = normalize(path);
    const parent = parentOf(p);
    const name = baseName(p);
    try {
      const dir = await this.dirHandle(parent, false, false);
      await dir.removeEntry(name, { recursive: options?.recursive ?? false });
    } catch (error) {
      if (!options?.force) throw error;
    }
    this.index.removeRecursive(p);
  }

  async cp(src: string, dest: string): Promise<void> {
    const bytes = await this.readFileBuffer(src);
    await this.writeFile(dest, bytes);
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.cp(src, dest);
    await this.rm(src, { recursive: true, force: true });
    this.index.move(src, dest);
  }

  resolvePath(base: string, path: string): string {
    return path.startsWith("/") ? normalize(path) : normalize(`${base}/${path}`);
  }

  getAllPaths(): string[] {
    return this.index.all();
  }

  async realpath(path: string): Promise<string> {
    return normalize(path);
  }

  /** Seed multiple files at once — used to mirror workspace seeds into /workspace. */
  async seed(files: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      await this.writeFile(path, content);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async hydrate(prefix: string, dir: DirHandle): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
      const path = normalize(`${prefix}/${name}`);
      if (handle.kind === "directory") {
        this.index.addDir(path);
        await this.hydrate(path, handle as DirHandle);
      } else {
        this.index.addFile(path);
      }
    }
  }

  private async dirHandle(path: string, create: boolean, recursive: boolean): Promise<DirHandle> {
    const parts = normalize(path).split("/").filter(Boolean);
    let dir = this.rootDir;
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i] as string;
      // With recursive create, every intermediate segment is created; otherwise only
      // the final segment respects `create` and parents must already exist.
      const createThis = create && (recursive || i === parts.length - 1);
      dir = await dir.getDirectoryHandle(name, { create: createThis });
    }
    return dir;
  }

  private async fileHandle(path: string, create: boolean): Promise<FileHandle> {
    const p = normalize(path);
    const dir = await this.dirHandle(parentOf(p), create, create);
    return dir.getFileHandle(baseName(p), { create });
  }
}

function dirStat(): FsStat {
  return { isFile: () => false, isDirectory: () => true, size: 0 };
}
function parentOf(path: string): string {
  const p = normalize(path);
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}
function baseName(path: string): string {
  const p = normalize(path);
  return p.slice(p.lastIndexOf("/") + 1);
}
