/**
 * The minimal read-only filesystem discovery needs. Both an OPFS-backed store and the
 * in-memory test double implement this, which is what keeps discovery — the
 * fidelity-critical part — entirely environment-free and Bun-testable.
 */
export interface ReadFs {
  readdir(path: string): Promise<DirEntry[]>;
  readTextFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface DirEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
}

/** POSIX-style join that never touches the host filesystem. */
export function joinPath(...parts: string[]): string {
  const segments: string[] = [];
  for (const part of parts) {
    for (const raw of part.split("/")) {
      if (raw === "" || raw === ".") continue;
      if (raw === "..") segments.pop();
      else segments.push(raw);
    }
  }
  return `/${segments.join("/")}`;
}

export function basename(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? clean : clean.slice(idx + 1);
}

export function stem(filename: string): string {
  const base = basename(filename);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}

export function extname(filename: string): string {
  const base = basename(filename);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

/** An in-memory ReadFs from a flat `{ "/a/b.ts": "contents" }` map. For tests and fixtures. */
export class MemFs implements ReadFs {
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string>) {
    this.files = new Map(
      Object.entries(files).map(([k, v]) => [normalize(k), v]),
    );
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const dir = normalize(path).replace(/\/$/, "");
    const prefix = dir === "" ? "/" : `${dir}/`;
    const files = new Set<string>();
    const dirs = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) files.add(rest);
      else dirs.add(rest.slice(0, slash));
    }
    return [
      ...[...dirs].map((name) => ({ name, kind: "directory" as const })),
      ...[...files].map((name) => ({ name, kind: "file" as const })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }

  async readTextFile(path: string): Promise<string> {
    const content = this.files.get(normalize(path));
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  async exists(path: string): Promise<boolean> {
    const p = normalize(path);
    if (this.files.has(p)) return true;
    const prefix = `${p}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }
}

function normalize(path: string): string {
  return joinPath(path);
}
