import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { discover } from "ieva/runtime";
import type { DirEntry, ReadFs } from "ieva/runtime";
import { Harness } from "ieva/runtime";
import type { AgentModel, GenerateResult } from "ieva/runtime";
import { MemStore } from "ieva/runtime";
import { compileAgent } from "./compile.ts";
import type { ModuleLoader } from "./loader.ts";

/** ReadFs over the real disk, so Bun can import the same .ts files it discovers. */
class DiskReadFs implements ReadFs {
  async readdir(path: string): Promise<DirEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      kind: e.isDirectory() ? "directory" : "file",
    }));
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

/** Native-import loader — the test stand-in for the browser's esbuild+blob loader. */
const bunLoader: ModuleLoader = {
  async load(entryPath: string) {
    return import(pathToFileURL(entryPath).href);
  },
};

let dir: string;

beforeAll(async () => {
  // Inside the package so Bun's node_modules walk resolves the `ieva` workspace symlink,
  // mirroring how the browser esbuild loader resolves `ieva/*` to runtime URLs.
  dir = await mkdtemp(join(import.meta.dir, "..", ".tmp-fixture-"));
  const agent = join(dir, "agent");
  await mkdir(join(agent, "tools"), { recursive: true });
  await mkdir(join(agent, "skills"), { recursive: true });

  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fixture-agent" }));
  await writeFile(join(agent, "instructions.md"), "You are a fixture agent.");
  await writeFile(
    join(agent, "agent.ts"),
    `import { defineAgent } from "ieva";
export default defineAgent({ model: "anthropic/claude-sonnet-5" });`,
  );
  await writeFile(
    join(agent, "tools", "add.ts"),
    `import { defineTool } from "ieva/tools";
export default defineTool({
  description: "Add two numbers.",
  inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
  async execute(input) { return { sum: Number(input.a) + Number(input.b) }; },
});`,
  );
  await writeFile(
    join(agent, "tools", "disabled_bash.ts"),
    `import { disableTool } from "ieva/tools";
export default disableTool();`,
  );
  await writeFile(
    join(agent, "skills", "math.md"),
    `---\ndescription: Use for arithmetic questions.\n---\nShow your working step by step.`,
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("compile: discover → compile → run", () => {
  test("discovery finds the expected surface", async () => {
    const fs = new DiskReadFs();
    const manifest = await discover(fs, join(dir, "agent"), { nameHint: "fixture-agent" });
    expect(manifest.name).toBe("fixture-agent");
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(["add", "disabled_bash"]);
    expect(manifest.skills[0]?.description).toBe("Use for arithmetic questions.");
    expect(manifest.diagnostics).toHaveLength(0);
  });

  test("compile produces a LoadedAgent with imported tools and skills", async () => {
    const fs = new DiskReadFs();
    const manifest = await discover(fs, join(dir, "agent"), { nameHint: "fixture-agent" });
    const { agent, diagnostics } = await compileAgent(manifest, fs, bunLoader);

    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(agent.instructions).toBe("You are a fixture agent.");
    expect(agent.model).toBe("anthropic/claude-sonnet-5");
    expect(agent.tools.has("add")).toBe(true);
    expect(agent.tools.get("add")?.description).toBe("Add two numbers.");
    // disableTool() registers as disabled, not as a callable tool.
    expect(agent.disabledTools.has("disabled_bash")).toBe(true);
    expect(agent.tools.has("disabled_bash")).toBe(false);
    expect(agent.skills.get("math")?.markdown).toContain("Show your working");
  });

  test("the compiled agent actually runs a real tool through the harness", async () => {
    const fs = new DiskReadFs();
    const manifest = await discover(fs, join(dir, "agent"), { nameHint: "fixture-agent" });
    const { agent } = await compileAgent(manifest, fs, bunLoader);

    const script: GenerateResult[] = [
      {
        text: "",
        toolCalls: [{ callId: "c1", name: "add", input: { a: 2, b: 3 } }],
        finishReason: "tool-calls",
      },
      { text: "The sum is 5.", toolCalls: [], finishReason: "stop" },
    ];
    let i = 0;
    const model: AgentModel = {
      id: "mock",
      async generate() {
        return script[Math.min(i++, script.length - 1)] as GenerateResult;
      },
    };

    const h = new Harness(
      agent,
      { registry: { resolve: async () => model }, store: new MemStore() },
      "compile-run",
    );
    const reply = await h.send("what is 2 + 3?");
    expect(reply).toBe("The sum is 5.");
    // The tool result the model saw must contain the real computed sum.
    const results = h.stream.replay().filter((e) => e.type === "action.result");
    expect(results[0]?.data.output).toEqual({ sum: 5 });
  });
});
