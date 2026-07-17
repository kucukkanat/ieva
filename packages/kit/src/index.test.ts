import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DirEntry, ReadFs } from "ieva/runtime";
import { MemStore } from "ieva/runtime";
import type { AgentModel, GenerateResult } from "ieva/runtime";
import type { ModuleLoader } from "@ieva/compiler";
import { bootstrapAgent, BootstrapError } from "./index.ts";

class DiskReadFs implements ReadFs {
  async readdir(path: string): Promise<DirEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, kind: e.isDirectory() ? "directory" : "file" }));
  }
  readTextFile(path: string): Promise<string> {
    return readFile(path, "utf8");
  }
  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}

const bunLoader: ModuleLoader = {
  async load(entryPath: string) {
    return import(pathToFileURL(entryPath).href);
  },
};

/** A scripted model that plays a fixed sequence regardless of input. */
function scriptedRegistry(script: GenerateResult[]) {
  let i = 0;
  const model: AgentModel = {
    id: "mock",
    async generate() {
      return script[Math.min(i++, script.length - 1)] as GenerateResult;
    },
  };
  return { resolve: async () => model };
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(import.meta.dir, "..", ".tmp-kit-"));
  const agent = join(dir, "agent");
  await mkdir(join(agent, "tools"), { recursive: true });
  await mkdir(join(agent, "skills"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "calculator-bot" }));
  await writeFile(
    join(agent, "instructions.md"),
    "You are a calculator. Use the multiply tool for products.",
  );
  await writeFile(
    join(agent, "tools", "multiply.ts"),
    `import { defineTool } from "ieva/tools";
export default defineTool({
  description: "Multiply two numbers.",
  inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  async execute(input) { return { product: Number(input.a) * Number(input.b) }; },
});`,
  );
  await writeFile(
    join(agent, "skills", "arithmetic.md"),
    "---\ndescription: Use for multiplication and arithmetic.\n---\nAlways state the operands before the result.",
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("bootstrapAgent: folder → running agent", () => {
  test("discovers, compiles, and runs a real tool end to end", async () => {
    const { client, manifest, diagnostics } = await bootstrapAgent({
      fs: new DiskReadFs(),
      root: join(dir, "agent"),
      loader: bunLoader,
      registry: scriptedRegistry([
        {
          text: "",
          toolCalls: [{ callId: "c1", name: "multiply", input: { a: 6, b: 7 } }],
          finishReason: "tool-calls",
        },
        { text: "6 times 7 is 42.", toolCalls: [], finishReason: "stop" },
      ]),
      store: new MemStore(),
      nameHint: "calculator-bot",
    });

    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(manifest.name).toBe("calculator-bot");
    expect(manifest.tools.map((t) => t.name)).toEqual(["multiply"]);

    const reply = await client.send("what is 6 * 7?");
    expect(reply).toBe("6 times 7 is 42.");

    const result = client.replay().find((e) => e.type === "action.result");
    expect(result?.data.output).toEqual({ product: 42 });
  });

  test("session survives a reload: resume continues the same session id", async () => {
    const store = new MemStore();
    const base = {
      fs: new DiskReadFs(),
      root: join(dir, "agent"),
      loader: bunLoader,
      store,
      nameHint: "calculator-bot",
    };

    const first = await bootstrapAgent({
      ...base,
      registry: scriptedRegistry([{ text: "hi", toolCalls: [], finishReason: "stop" }]),
      sessionId: "persist-1",
    });
    await first.client.send("hello");

    // A fresh bootstrap resuming the same id must see turn 1 already committed.
    const resumed = await bootstrapAgent({
      ...base,
      registry: scriptedRegistry([{ text: "again", toolCalls: [], finishReason: "stop" }]),
      sessionId: "persist-1",
      resume: true,
    });
    await resumed.client.send("second");
    const snap = await store.loadSession("persist-1");
    expect(snap?.turn).toBe(2);
  });

  test("a directory with errors throws BootstrapError carrying diagnostics", async () => {
    const bad = await mkdtemp(join(import.meta.dir, "..", ".tmp-kit-bad-"));
    // No instructions.md at the root → discovery error.
    await mkdir(join(bad, "agent", "tools"), { recursive: true });
    await writeFile(join(bad, "agent", "tools", "x.ts"), "export default {}");
    try {
      await expect(
        bootstrapAgent({
          fs: new DiskReadFs(),
          root: join(bad, "agent"),
          loader: bunLoader,
          registry: scriptedRegistry([{ text: "", toolCalls: [], finishReason: "stop" }]),
          store: new MemStore(),
          nameHint: "bad",
        }),
      ).rejects.toThrow(BootstrapError);
    } finally {
      await rm(bad, { recursive: true, force: true });
    }
  });
});
