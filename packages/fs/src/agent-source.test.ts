import { describe, expect, test } from "bun:test";
import { MemFs } from "ieva/runtime";
import { detectAgentRoot } from "./agent-source.ts";

describe("detectAgentRoot", () => {
  test("finds a nested agent dir under a wrapper directory (typical zip)", async () => {
    const fs = new MemFs({
      "/agent-src/my-agent/package.json": "{}",
      "/agent-src/my-agent/agent/instructions.md": "hi",
      "/agent-src/my-agent/agent/tools/x.ts": "export default {}",
    });
    expect(await detectAgentRoot(fs, "/agent-src")).toBe("/agent-src/my-agent/agent");
  });

  test("finds a flat layout where the base itself carries instructions", async () => {
    const fs = new MemFs({
      "/agent-src/instructions.md": "hi",
      "/agent-src/tools/x.ts": "export default {}",
    });
    expect(await detectAgentRoot(fs, "/agent-src")).toBe("/agent-src");
  });

  test("detects an instructions/ directory form", async () => {
    const fs = new MemFs({
      "/agent-src/pkg/agent/instructions/00.md": "hi",
    });
    expect(await detectAgentRoot(fs, "/agent-src")).toBe("/agent-src/pkg/agent");
  });

  test("throws a clear error when no agent directory exists", async () => {
    const fs = new MemFs({ "/agent-src/readme.txt": "nope" });
    await expect(detectAgentRoot(fs, "/agent-src")).rejects.toThrow(/No agent directory found/);
  });
});
