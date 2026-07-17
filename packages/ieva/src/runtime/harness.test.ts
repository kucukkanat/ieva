import { describe, expect, test } from "bun:test";
import { defineState } from "../context.ts";
import { defineTool } from "../tools.ts";
import { Harness } from "./harness.ts";
import type { LoadedAgent, LoadedSkill } from "./loaded.ts";
import type { AgentModel, GenerateRequest, GenerateResult } from "./model.ts";
import { MemStore } from "./store.ts";

/** A scripted model: returns queued results in order, ignoring the request. */
function scriptedModel(script: GenerateResult[]): { model: AgentModel; seen: GenerateRequest[] } {
  const seen: GenerateRequest[] = [];
  let i = 0;
  return {
    seen,
    model: {
      id: "mock/test",
      async generate(request) {
        seen.push(request);
        return script[Math.min(i++, script.length - 1)] as GenerateResult;
      },
    },
  };
}

function registryFor(model: AgentModel) {
  return { resolve: async () => model };
}

function baseAgent(overrides: Partial<LoadedAgent> = {}): LoadedAgent {
  return {
    name: "test-agent",
    instructions: "You are a test agent.",
    model: "mock/test",
    tools: new Map(),
    disabledTools: new Set(),
    skills: new Map(),
    hooks: [],
    subagents: new Map(),
    compaction: false,
    limits: {},
    ...overrides,
  };
}

describe("harness: full loop", () => {
  test("plain text turn completes and commits a snapshot", async () => {
    const { model } = scriptedModel([
      { text: "Hello there.", toolCalls: [], finishReason: "stop" },
    ]);
    const store = new MemStore();
    const h = new Harness(baseAgent(), { registry: registryFor(model), store }, "s1");

    const reply = await h.send("hi");
    expect(reply).toBe("Hello there.");

    const snap = await store.loadSession("s1");
    expect(snap?.turn).toBe(1);
    expect(snap?.messages.some((m) => m.role === "user")).toBe(true);
  });

  test("tool call round-trips: model calls tool, sees result, then answers", async () => {
    let executed: unknown;
    const weather = defineTool({
      description: "Get weather.",
      inputSchema: { type: "object", properties: { city: { type: "string" } } },
      async execute(input) {
        executed = input;
        return { city: String(input.city), tempF: 72 };
      },
    });
    const { model, seen } = scriptedModel([
      {
        text: "",
        toolCalls: [{ callId: "c1", name: "get_weather", input: { city: "Paris" } }],
        finishReason: "tool-calls",
      },
      { text: "It is 72F in Paris.", toolCalls: [], finishReason: "stop" },
    ]);
    const h = new Harness(
      baseAgent({ tools: new Map([["get_weather", weather]]) }),
      { registry: registryFor(model), store: new MemStore() },
      "s2",
    );

    const reply = await h.send("weather in Paris?");
    expect(executed).toEqual({ city: "Paris" });
    expect(reply).toBe("It is 72F in Paris.");
    // Second model call must include the tool result in history.
    const secondCall = seen[1];
    const toolMsg = secondCall?.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
  });

  test("events are emitted in protocol order", async () => {
    const { model } = scriptedModel([
      {
        text: "",
        toolCalls: [{ callId: "c1", name: "noop", input: {} }],
        finishReason: "tool-calls",
      },
      { text: "done", toolCalls: [], finishReason: "stop" },
    ]);
    const noop = defineTool({
      description: "noop",
      inputSchema: { type: "object" },
      async execute() {
        return { ok: true };
      },
    });
    const h = new Harness(
      baseAgent({ tools: new Map([["noop", noop]]) }),
      { registry: registryFor(model), store: new MemStore() },
      "s3",
    );
    await h.send("go");
    const types = h.stream.replay().map((e) => e.type);
    expect(types[0]).toBe("session.started");
    expect(types).toContain("actions.requested");
    expect(types).toContain("action.result");
    expect(types).toContain("turn.completed");
    expect(types.at(-1)).toBe("session.waiting");
  });
});

describe("harness: skills (progressive disclosure)", () => {
  test("load_skill appends skill markdown to the system prompt", async () => {
    const skill: LoadedSkill = {
      name: "forecast",
      description: "weather questions",
      markdown: "ALWAYS mention humidity.",
      files: {},
    };
    const { model, seen } = scriptedModel([
      {
        text: "",
        toolCalls: [{ callId: "c1", name: "load_skill", input: { skill: "forecast" } }],
        finishReason: "tool-calls",
      },
      { text: "answered", toolCalls: [], finishReason: "stop" },
    ]);
    const h = new Harness(
      baseAgent({ skills: new Map([["forecast", skill]]) }),
      { registry: registryFor(model), store: new MemStore() },
      "s4",
    );
    await h.send("forecast?");
    // The second call's system prompt must now include the skill body.
    expect(seen[1]?.system).toContain("ALWAYS mention humidity.");
    // load_skill is advertised because a skill exists.
    expect(seen[0]?.tools.some((t) => t.name === "load_skill")).toBe(true);
  });
});

describe("harness: state + durability", () => {
  test("defineState persists across steps and into the snapshot", async () => {
    const counter = defineState("test.counter", () => ({ n: 0 }));
    const bump = defineTool({
      description: "bump",
      inputSchema: { type: "object" },
      async execute() {
        return counter.update((s) => ({ n: s.n + 1 }));
      },
    });
    const { model } = scriptedModel([
      { text: "", toolCalls: [{ callId: "c1", name: "bump", input: {} }], finishReason: "tool-calls" },
      { text: "", toolCalls: [{ callId: "c2", name: "bump", input: {} }], finishReason: "tool-calls" },
      { text: "done", toolCalls: [], finishReason: "stop" },
    ]);
    const store = new MemStore();
    const h = new Harness(
      baseAgent({ tools: new Map([["bump", bump]]) }),
      { registry: registryFor(model), store },
      "s5",
    );
    await h.send("bump twice");
    const snap = await store.loadSession("s5");
    expect(snap?.state["test.counter"]).toEqual({ n: 2 });
  });

  test("resume rehydrates messages and state from the store", async () => {
    const { model } = scriptedModel([
      { text: "first", toolCalls: [], finishReason: "stop" },
    ]);
    const store = new MemStore();
    const deps = { registry: registryFor(model), store };
    const h1 = new Harness(baseAgent(), deps, "s6");
    await h1.send("hello");

    const resumed = await Harness.resume(baseAgent(), deps, "s6");
    expect(resumed).toBeDefined();
    const { model: model2 } = scriptedModel([
      { text: "second", toolCalls: [], finishReason: "stop" },
    ]);
    // A fresh harness continuing the same session id starts at turn 2.
    const h2 = new Harness(
      baseAgent(),
      { registry: registryFor(model2), store },
      "s6",
      await store.loadSession("s6"),
    );
    await h2.send("again");
    const snap = await store.loadSession("s6");
    expect(snap?.turn).toBe(2);
  });
});

describe("harness: approval", () => {
  test("a denied approval short-circuits tool execution", async () => {
    let ran = false;
    const danger = defineTool({
      description: "dangerous",
      inputSchema: { type: "object" },
      approval: { mode: "always" },
      async execute() {
        ran = true;
        return { ok: true };
      },
    });
    const { model } = scriptedModel([
      { text: "", toolCalls: [{ callId: "c1", name: "danger", input: {} }], finishReason: "tool-calls" },
      { text: "ok", toolCalls: [], finishReason: "stop" },
    ]);
    const h = new Harness(
      baseAgent({ tools: new Map([["danger", danger]]) }),
      { registry: registryFor(model), store: new MemStore(), requestApproval: async () => false },
      "s7",
    );
    await h.send("do the dangerous thing");
    expect(ran).toBe(false);
    expect(h.stream.replay().some((e) => e.type === "input.requested")).toBe(true);
  });
});

describe("harness: hooks (observe-only)", () => {
  test("a hook observes events but cannot alter the result", async () => {
    const observed: string[] = [];
    const { model } = scriptedModel([{ text: "hi", toolCalls: [], finishReason: "stop" }]);
    const h = new Harness(
      baseAgent({
        hooks: [
          {
            events: {
              "turn.completed": (event: { type: string }) => {
                observed.push(event.type);
              },
            },
          } as never,
        ],
      }),
      { registry: registryFor(model), store: new MemStore() },
      "s8",
    );
    const reply = await h.send("hi");
    expect(reply).toBe("hi");
    expect(observed).toContain("turn.completed");
  });
});
