import { describe, expect, test } from "bun:test";
import { normalize, PathIndex } from "./path-index.ts";

describe("PathIndex: ancestors", () => {
  test("adding a deep file implies its directory chain", () => {
    const idx = new PathIndex();
    idx.addFile("/workspace/a/b/c.ts");
    expect(idx.hasDir("/workspace")).toBe(true);
    expect(idx.hasDir("/workspace/a")).toBe(true);
    expect(idx.hasDir("/workspace/a/b")).toBe(true);
    expect(idx.hasFile("/workspace/a/b/c.ts")).toBe(true);
  });
});

describe("PathIndex: readdir", () => {
  test("lists immediate children as files and directories", () => {
    const idx = new PathIndex();
    idx.addFile("/w/a.ts");
    idx.addFile("/w/b.ts");
    idx.addFile("/w/sub/c.ts");
    expect(idx.readdir("/w")).toEqual([
      { name: "a.ts", kind: "file" },
      { name: "b.ts", kind: "file" },
      { name: "sub", kind: "directory" },
    ]);
  });
});

describe("PathIndex: getAllPaths for globbing", () => {
  test("all() returns every file path, sorted", () => {
    const idx = new PathIndex();
    idx.addFile("/w/z.ts");
    idx.addFile("/w/a.ts");
    idx.addFile("/w/sub/m.ts");
    expect(idx.all()).toEqual(["/w/a.ts", "/w/sub/m.ts", "/w/z.ts"]);
  });
});

describe("PathIndex: mutations stay consistent", () => {
  test("removeRecursive drops a subtree", () => {
    const idx = new PathIndex();
    idx.addFile("/w/keep.ts");
    idx.addFile("/w/sub/a.ts");
    idx.addFile("/w/sub/deep/b.ts");
    idx.removeRecursive("/w/sub");
    expect(idx.all()).toEqual(["/w/keep.ts"]);
    expect(idx.hasDir("/w/sub")).toBe(false);
    expect(idx.hasDir("/w/sub/deep")).toBe(false);
  });

  test("move relocates a file and its implied dirs", () => {
    const idx = new PathIndex();
    idx.addFile("/w/old/a.ts");
    idx.move("/w/old", "/w/new");
    expect(idx.hasFile("/w/new/a.ts")).toBe(true);
    expect(idx.hasFile("/w/old/a.ts")).toBe(false);
  });

  test("single-file move", () => {
    const idx = new PathIndex();
    idx.addFile("/w/a.ts");
    idx.move("/w/a.ts", "/w/b.ts");
    expect(idx.all()).toEqual(["/w/b.ts"]);
  });
});

describe("normalize", () => {
  test("collapses . and .. and duplicate slashes", () => {
    expect(normalize("/w//a/./b/../c.ts")).toBe("/w/a/c.ts");
    expect(normalize("w/a")).toBe("/w/a");
  });
});
