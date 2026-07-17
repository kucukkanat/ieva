import { describe, expect, test } from "bun:test";
import { discover } from "./discovery.ts";
import { MemFs } from "./fs.ts";

describe("discovery: naming", () => {
  test("root name comes from package.json#name", async () => {
    const fs = new MemFs({
      "/proj/package.json": JSON.stringify({ name: "support-bot" }),
      "/proj/agent/instructions.md": "You are helpful.",
    });
    const m = await discover(fs, "/proj/agent");
    expect(m.name).toBe("support-bot");
  });

  test("root name falls back to directory name when package.json has no name", async () => {
    const fs = new MemFs({
      "/proj/package.json": JSON.stringify({ version: "1.0.0" }),
      "/proj/agent/instructions.md": "hi",
    });
    const m = await discover(fs, "/proj/agent");
    expect(m.name).toBe("agent");
  });

  test("subagent name comes from its directory", async () => {
    const fs = new MemFs({
      "/proj/agent/instructions.md": "root",
      "/proj/agent/subagents/researcher/agent.ts": "export default {}",
    });
    const m = await discover(fs, "/proj/agent");
    expect(m.subagents[0]?.name).toBe("researcher");
  });
});

describe("discovery: tools", () => {
  test("filename becomes tool name; .ts and .js both discovered; sorted", async () => {
    const fs = new MemFs({
      "/a/instructions.md": "x",
      "/a/tools/get_weather.ts": "export default {}",
      "/a/tools/send_email.js": "export default {}",
      "/a/tools/README.md": "not a tool",
    });
    const m = await discover(fs, "/a");
    expect(m.tools.map((t) => t.name)).toEqual(["get_weather", "send_email"]);
  });

  test("non-snake_case tool name is an error", async () => {
    const fs = new MemFs({
      "/a/instructions.md": "x",
      "/a/tools/getWeather.ts": "export default {}",
    });
    const m = await discover(fs, "/a");
    expect(m.tools).toHaveLength(0);
    expect(m.diagnostics.some((d) => d.code === "tool/invalid-name")).toBe(true);
  });
});

describe("discovery: skills", () => {
  test("flat skill derives description from frontmatter", async () => {
    const fs = new MemFs({
      "/a/instructions.md": "x",
      "/a/skills/forecast.md": "---\ndescription: Use for weather questions.\n---\nBody.",
    });
    const m = await discover(fs, "/a");
    expect(m.skills[0]).toMatchObject({
      name: "forecast",
      kind: "flat",
      description: "Use for weather questions.",
    });
  });

  test("flat skill without frontmatter uses first meaningful line, markers stripped", async () => {
    const fs = new MemFs({
      "/a/instructions.md": "x",
      "/a/skills/notes.md": "# Heading\n\nActual first line.",
    });
    const m = await discover(fs, "/a");
    expect(m.skills[0]?.description).toBe("Heading");
  });

  test("packaged skill without description is an error", async () => {
    const fs = new MemFs({
      "/a/instructions.md": "x",
      "/a/skills/research/SKILL.md": "No frontmatter here.",
    });
    const m = await discover(fs, "/a");
    expect(m.diagnostics.some((d) => d.code === "skill/missing-description")).toBe(true);
  });
});

describe("discovery: validation rules", () => {
  test("root without instructions is an error", async () => {
    const fs = new MemFs({ "/a/agent.ts": "export default {}" });
    const m = await discover(fs, "/a");
    expect(m.diagnostics.some((d) => d.code === "instructions/missing")).toBe(true);
  });

  test("instructions.md + instructions.ts at root is an error", async () => {
    const fs = new MemFs({
      "/a/instructions.md": "x",
      "/a/instructions.ts": "export default {}",
    });
    const m = await discover(fs, "/a");
    expect(m.diagnostics.some((d) => d.code === "instructions/dual-root")).toBe(true);
  });

  test("subagent without agent.ts is an error", async () => {
    const fs = new MemFs({
      "/a/instructions.md": "root",
      "/a/subagents/helper/instructions.md": "help",
    });
    const m = await discover(fs, "/a");
    const sub = m.subagents[0];
    expect(sub?.diagnostics.some((d) => d.code === "agent/missing-config")).toBe(true);
  });

  test("tool/subagent name collision is rejected", async () => {
    const fs = new MemFs({
      "/a/instructions.md": "x",
      "/a/tools/researcher.ts": "export default {}",
      "/a/subagents/researcher/agent.ts": "export default {}",
    });
    const m = await discover(fs, "/a");
    expect(m.diagnostics.some((d) => d.code === "collision/tool-subagent")).toBe(true);
  });

  test("instruction directory sources sort after the root flat file", async () => {
    const fs = new MemFs({
      "/a/instructions.md": "root",
      "/a/instructions/10-later.md": "later",
      "/a/instructions/00-early.md": "early",
    });
    const m = await discover(fs, "/a");
    expect(m.instructions.map((s) => s.path)).toEqual([
      "/a/instructions.md",
      "/a/instructions/00-early.md",
      "/a/instructions/10-later.md",
    ]);
  });
});
