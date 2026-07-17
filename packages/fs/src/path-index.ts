/**
 * An in-memory index of every path in the VFS.
 *
 * This exists because just-bash's `IFileSystem.getAllPaths()` and `resolvePath()` are
 * SYNCHRONOUS, but OPFS enumeration is async. Without a synchronous mirror of the tree,
 * glob expansion (`ls *.ts`, `find`, `**`) silently degrades to nothing. The index is
 * hydrated once when the VFS mounts and updated on every write/remove/move, so it must
 * stay exactly consistent with OPFS — a correctness-critical invariant, not a cache.
 */
export class PathIndex {
  /** Absolute normalized paths of files (not directories). */
  private readonly files = new Set<string>();
  /** Absolute normalized paths of directories, including implied ancestors. */
  private readonly dirs = new Set<string>(["/"]);

  addFile(path: string): void {
    const p = normalize(path);
    this.files.add(p);
    this.addAncestorDirs(p);
  }

  addDir(path: string): void {
    const p = normalize(path);
    if (p !== "/") this.dirs.add(p);
    this.addAncestorDirs(p);
  }

  remove(path: string): void {
    const p = normalize(path);
    this.files.delete(p);
    this.dirs.delete(p);
  }

  /** Remove a path and everything beneath it (a recursive `rm`). */
  removeRecursive(path: string): void {
    const p = normalize(path);
    const prefix = p === "/" ? "/" : `${p}/`;
    for (const f of this.files) if (f === p || f.startsWith(prefix)) this.files.delete(f);
    for (const d of this.dirs) if (d !== "/" && (d === p || d.startsWith(prefix))) this.dirs.delete(d);
  }

  move(from: string, to: string): void {
    const src = normalize(from);
    const dst = normalize(to);
    const prefix = `${src}/`;
    const moves: Array<[string, string, "file" | "dir"]> = [];
    for (const f of this.files) {
      if (f === src) moves.push([f, dst, "file"]);
      else if (f.startsWith(prefix)) moves.push([f, dst + f.slice(src.length), "file"]);
    }
    for (const d of this.dirs) {
      if (d === src) moves.push([d, dst, "dir"]);
      else if (d.startsWith(prefix)) moves.push([d, dst + d.slice(src.length), "dir"]);
    }
    for (const [f] of moves) this.remove(f);
    for (const [, t, kind] of moves) kind === "file" ? this.addFile(t) : this.addDir(t);
  }

  hasFile(path: string): boolean {
    return this.files.has(normalize(path));
  }

  hasDir(path: string): boolean {
    return this.dirs.has(normalize(path));
  }

  exists(path: string): boolean {
    const p = normalize(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  /** Every file path — this is what backs just-bash's getAllPaths(). */
  all(): string[] {
    return [...this.files].sort();
  }

  /** Immediate children of a directory (names only), files and subdirectories. */
  readdir(path: string): Array<{ name: string; kind: "file" | "directory" }> {
    const dir = normalize(path).replace(/\/$/, "");
    const prefix = dir === "" ? "/" : `${dir}/`;
    const out = new Map<string, "file" | "directory">();
    for (const f of this.files) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) out.set(rest, "file");
      else out.set(rest.slice(0, slash), "directory");
    }
    for (const d of this.dirs) {
      if (d === dir || !d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      const slash = rest.indexOf("/");
      out.set(slash === -1 ? rest : rest.slice(0, slash), "directory");
    }
    return [...out.entries()]
      .map(([name, kind]) => ({ name, kind }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private addAncestorDirs(path: string): void {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      current += `/${parts[i]}`;
      this.dirs.add(current);
    }
  }
}

export function normalize(path: string): string {
  const segments: string[] = [];
  for (const raw of path.split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") segments.pop();
    else segments.push(raw);
  }
  return `/${segments.join("/")}`;
}
