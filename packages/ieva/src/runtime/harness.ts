import { schemaToJsonSchema, validateInput } from "../schema.ts";
import { __enterStateContext, type StateBag } from "../context.ts";
import type {
  HookDefinition,
  ModelReference,
  SessionInfo,
  ToolContext,
  ToolDefinition,
} from "../types.ts";
import { EventStream, type EventType } from "./events.ts";
import type { LoadedAgent, LoadedSkill } from "./loaded.ts";
import type {
  AgentModel,
  ContentPart,
  GenerateRequest,
  ModelMessage,
  ModelRegistry,
  ModelToolSpec,
  ToolCall,
} from "./model.ts";
import {
  type CheckpointStore,
  SNAPSHOT_VERSION,
  type SessionSnapshot,
  type StoredMessage,
} from "./store.ts";

export interface HarnessDeps {
  readonly registry: ModelRegistry;
  readonly store: CheckpointStore;
  /** Host-provided built-in tools (web_fetch, web_search, todo, …). Optional. */
  readonly builtinTools?: Map<string, ToolDefinition>;
  /** Approve a gated tool call. Defaults to auto-approve. */
  readonly requestApproval?: (req: ApprovalRequest) => Promise<boolean>;
  /** Answer an `ask_question`. Defaults to returning an empty string. */
  readonly requestInput?: (req: InputRequest) => Promise<string>;
}

export interface ApprovalRequest {
  readonly sessionId: string;
  readonly toolName: string;
  readonly input: unknown;
}
export interface InputRequest {
  readonly sessionId: string;
  readonly prompt: string;
  readonly options?: string[];
}

const DEFAULT_MAX_STEPS = 32;
const DEFAULT_COMPACTION_THRESHOLD = 0.9;

/**
 * The agent loop. Owns model calls, tool execution, skill loading, compaction, and
 * per-step checkpointing. Authors never write this loop — they only supply capabilities.
 */
export class Harness {
  private readonly events = new EventStream();
  private readonly loadedSkills = new Set<string>();
  private readonly approvedTools = new Set<string>();
  private readonly stateBag: MutableStateBag;
  private messages: ModelMessage[] = [];
  private turn = 0;
  private stepIndex = 0;

  constructor(
    private readonly agent: LoadedAgent,
    private readonly deps: HarnessDeps,
    private readonly sessionId: string,
    restored?: SessionSnapshot,
  ) {
    this.stateBag = new MutableStateBag(restored?.state ?? {});
    if (restored) {
      this.turn = restored.turn;
      this.stepIndex = restored.stepIndex;
      this.messages = restored.messages.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: m.content as string | ContentPart[],
      }));
    }
  }

  get stream(): EventStream {
    return this.events;
  }

  /** Restore a harness from a committed snapshot — the tab-reload recovery path. */
  static async resume(
    agent: LoadedAgent,
    deps: HarnessDeps,
    sessionId: string,
  ): Promise<Harness | undefined> {
    const snapshot = await deps.store.loadSession(sessionId);
    if (!snapshot) return undefined;
    return new Harness(agent, deps, sessionId, snapshot);
  }

  /** Send a user message and run the agent until the turn completes or fails. */
  async send(message: string, signal?: AbortSignal): Promise<string> {
    const abort = signal ?? new AbortController().signal;
    this.turn += 1;
    const turnId = `${this.sessionId}:${this.turn}`;

    if (this.turn === 1) {
      this.emit("session.started", turnId, { agent: this.agent.name });
    }
    this.emit("turn.started", turnId, { turn: this.turn });
    this.messages.push({ role: "user", content: message });
    this.emit("message.received", turnId, { message });

    try {
      const finalText = await this.runSteps(turnId, abort);
      this.emit("turn.completed", turnId, { text: finalText });
      await this.commit("waiting");
      this.emit("session.waiting", turnId, {});
      return finalText;
    } catch (error) {
      this.emit("turn.failed", turnId, { error: String(error) });
      await this.commit("failed");
      this.emit("session.failed", turnId, { error: String(error) });
      throw error;
    }
  }

  private async runSteps(turnId: string, abort: AbortSignal): Promise<string> {
    const maxSteps = this.agent.limits.maxSteps ?? DEFAULT_MAX_STEPS;
    const model = await this.resolveModel(this.agent.model);
    let lastText = "";

    for (let i = 0; i < maxSteps; i += 1) {
      if (abort.aborted) {
        this.emit("turn.cancelled", turnId, {});
        return lastText;
      }
      this.stepIndex += 1;
      this.emit("step.started", turnId, { step: this.stepIndex });

      await this.maybeCompact(turnId);

      const request: GenerateRequest = {
        system: this.assembleSystemPrompt(),
        messages: this.messages,
        tools: this.advertiseTools(),
      };
      const result = await model.generate(request, abort);

      if (result.text) {
        this.emit("message.appended", turnId, {
          delta: result.text,
          cumulative: result.text,
        });
        this.emit("message.completed", turnId, { message: result.text });
        lastText = result.text;
      }

      if (result.finishReason !== "tool-calls" || result.toolCalls.length === 0) {
        this.messages.push({ role: "assistant", content: result.text });
        this.emit("step.completed", turnId, { step: this.stepIndex });
        await this.commit("running");
        return lastText;
      }

      this.messages.push({
        role: "assistant",
        content: [
          ...(result.text ? [{ type: "text" as const, text: result.text }] : []),
          ...result.toolCalls.map(
            (c): ContentPart => ({ type: "tool-call", callId: c.callId, name: c.name, input: c.input }),
          ),
        ],
      });
      this.emit("actions.requested", turnId, { calls: result.toolCalls });

      for (const call of result.toolCalls) {
        const output = await this.executeTool(call, turnId, abort);
        this.messages.push({
          role: "tool",
          content: [{ type: "tool-result", callId: call.callId, name: call.name, output }],
        });
      }

      this.emit("step.completed", turnId, { step: this.stepIndex });
      await this.commit("running");
    }
    return lastText;
  }

  private async executeTool(
    call: ToolCall,
    turnId: string,
    abort: AbortSignal,
  ): Promise<unknown> {
    // Framework-owned tool: load_skill appends a skill's markdown to the turn.
    if (call.name === "load_skill") {
      return this.loadSkill(call.input);
    }

    const tool = this.resolveTool(call.name);
    if (!tool) {
      const error = { error: `Unknown tool: ${call.name}` };
      this.emit("action.result", turnId, { callId: call.callId, name: call.name, output: error });
      return error;
    }

    const validated = await validateInput(tool.inputSchema, call.input);
    if (!validated.ok) {
      const error = { error: `Invalid input: ${validated.issues.join("; ")}` };
      this.emit("action.result", turnId, { callId: call.callId, name: call.name, output: error });
      return error;
    }

    if (!(await this.checkApproval(tool, call, turnId))) {
      const denied = { error: "Tool call denied by approval policy." };
      this.emit("action.result", turnId, { callId: call.callId, name: call.name, output: denied });
      return denied;
    }

    const ctx = this.toolContext(call, abort);
    const release = __enterStateContext(this.stateBag);
    try {
      const raw = await tool.execute(validated.value as never, ctx);
      const modelOutput = tool.toModelOutput ? tool.toModelOutput(raw) : raw;
      this.emit("action.result", turnId, {
        callId: call.callId,
        name: call.name,
        output: modelOutput,
        fullOutput: raw,
      });
      return modelOutput;
    } catch (error) {
      const failure = { error: String(error) };
      this.emit("action.result", turnId, { callId: call.callId, name: call.name, output: failure });
      return failure;
    } finally {
      release();
    }
  }

  private async checkApproval(
    tool: ToolDefinition,
    call: ToolCall,
    turnId: string,
  ): Promise<boolean> {
    const approval = tool.approval;
    if (!approval || "mode" in approval === false) {
      if (approval && "policy" in approval) {
        const decision = await approval.policy({
          session: this.sessionInfo(),
          toolName: call.name,
          toolInput: call.input,
        });
        if (decision === "approved" || decision === "not-applicable") return true;
        if (decision === "denied") return false;
        return this.promptApproval(call, turnId);
      }
      return true;
    }
    if (approval.mode === "never") return true;
    if (approval.mode === "once" && this.approvedTools.has(call.name)) return true;
    const granted = await this.promptApproval(call, turnId);
    if (granted && approval.mode === "once") this.approvedTools.add(call.name);
    return granted;
  }

  private async promptApproval(call: ToolCall, turnId: string): Promise<boolean> {
    this.emit("input.requested", turnId, { kind: "approval", toolName: call.name });
    this.emit("session.waiting", turnId, { kind: "approval" });
    const granted = this.deps.requestApproval
      ? await this.deps.requestApproval({
          sessionId: this.sessionId,
          toolName: call.name,
          input: call.input,
        })
      : true;
    return granted;
  }

  private loadSkill(input: unknown): { loaded: string } | { error: string } {
    const id = typeof input === "object" && input && "skill" in input
      ? String((input as { skill: unknown }).skill)
      : String(input);
    const skill = this.agent.skills.get(id);
    if (!skill) return { error: `Unknown skill: ${id}` };
    this.loadedSkills.add(id);
    return { loaded: id };
  }

  private assembleSystemPrompt(): string {
    const parts = [this.agent.instructions];
    for (const id of this.loadedSkills) {
      const skill = this.agent.skills.get(id);
      if (skill) parts.push(`\n\n# Skill: ${skill.name}\n\n${skill.markdown}`);
    }
    return parts.join("");
  }

  private advertiseTools(): ModelToolSpec[] {
    const specs: ModelToolSpec[] = [];
    for (const [name, tool] of this.allTools()) {
      specs.push({
        name,
        description: tool.description,
        inputSchema: schemaToJsonSchema(tool.inputSchema),
      });
    }
    // Progressive disclosure: advertise load_skill only when skills exist.
    if (this.agent.skills.size > 0) {
      specs.push({
        name: "load_skill",
        description:
          "Load a skill's instructions into the conversation. Available skills: " +
          [...this.agent.skills.values()].map((s) => `${s.name} — ${s.description}`).join("; "),
        inputSchema: {
          type: "object",
          properties: { skill: { type: "string" } },
          required: ["skill"],
        },
      });
    }
    return specs;
  }

  private *allTools(): Iterable<[string, ToolDefinition]> {
    const seen = new Set<string>();
    for (const [name, tool] of this.agent.tools) {
      if (this.agent.disabledTools.has(name)) continue;
      seen.add(name);
      yield [name, tool];
    }
    for (const [name, tool] of this.deps.builtinTools ?? []) {
      if (seen.has(name) || this.agent.disabledTools.has(name)) continue;
      yield [name, tool];
    }
  }

  private resolveTool(name: string): ToolDefinition | undefined {
    if (this.agent.disabledTools.has(name)) return undefined;
    return this.agent.tools.get(name) ?? this.deps.builtinTools?.get(name);
  }

  private async maybeCompact(turnId: string): Promise<void> {
    if (this.agent.compaction === false) return;
    const threshold = this.agent.compaction?.thresholdPercent ?? DEFAULT_COMPACTION_THRESHOLD;
    // A deliberately simple proxy for context pressure: message count vs. a budget.
    // Real token-based estimation slots in behind the same trigger.
    const budget = 200;
    if (this.messages.length < budget * threshold) return;
    this.emit("compaction.requested", turnId, {});
    const keep = Math.floor(budget * 0.25);
    const dropped = this.messages.slice(0, this.messages.length - keep);
    const summary: ModelMessage = {
      role: "user",
      content: `[Earlier conversation summarized: ${dropped.length} messages compacted.]`,
    };
    this.messages = [summary, ...this.messages.slice(this.messages.length - keep)];
    this.emit("compaction.completed", turnId, { dropped: dropped.length });
  }

  private async resolveModel(reference: ModelReference): Promise<AgentModel> {
    if (typeof reference === "string") return this.deps.registry.resolve(reference);
    if ("kind" in reference && reference.kind === "dynamic-model") {
      return this.deps.registry.resolve(reference.fallback);
    }
    // A pre-resolved LanguageModel object — resolve by its id through the registry.
    return this.deps.registry.resolve((reference as { modelId: string }).modelId);
  }

  private toolContext(call: ToolCall, abort: AbortSignal): ToolContext {
    return {
      session: this.sessionInfo(),
      callId: call.callId,
      toolName: call.name,
      abortSignal: abort,
      getSandbox: async () => {
        if (!this.agent.openSandbox) {
          throw new Error("No sandbox configured for this agent.");
        }
        return this.agent.openSandbox();
      },
      getSkill: (id: string) => this.skillHandle(id),
    };
  }

  private skillHandle(id: string) {
    const skill = this.agent.skills.get(id);
    return {
      name: id,
      file: (relativePath: string) => ({
        text: async () => {
          const content = skill?.files[relativePath];
          if (content === undefined) throw new Error(`Skill file not found: ${relativePath}`);
          return content;
        },
      }),
    };
  }

  private sessionInfo(): SessionInfo {
    return { id: this.sessionId, turn: this.turn };
  }

  private async commit(status: SessionSnapshot["status"]): Promise<void> {
    const snapshot: SessionSnapshot = {
      version: SNAPSHOT_VERSION,
      sessionId: this.sessionId,
      agentName: this.agent.name,
      turn: this.turn,
      stepIndex: this.stepIndex,
      messages: this.messages.map((m): StoredMessage => ({ role: m.role, content: m.content })),
      state: this.stateBag.snapshot(),
      status,
      updatedAt: Date.now(),
    };
    await this.deps.store.commitStep(this.sessionId, snapshot);
  }

  private emit(type: EventType, turnId: string, data: Record<string, unknown>): void {
    const event = this.events.emit(type, turnId, this.stepIndex, data);
    for (const hook of this.agent.hooks) {
      void this.fireHook(hook, event.type, data);
    }
  }

  private async fireHook(
    hook: HookDefinition,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const handler = hook.events[type] ?? hook.events["*"];
    if (!handler) return;
    try {
      await handler(
        { type, data },
        { agent: { name: this.agent.name }, session: { id: this.sessionId } },
      );
    } catch (error) {
      // A throwing hook escalates to turn failure in eve; here we surface it as an event
      // rather than corrupting the loop, since hooks are observe-only.
      this.events.emit("turn.failed", `${this.sessionId}:${this.turn}`, this.stepIndex, {
        error: `Hook failed: ${String(error)}`,
      });
    }
  }
}

class MutableStateBag implements StateBag {
  private readonly data: Map<string, unknown>;
  constructor(initial: Record<string, unknown>) {
    this.data = new Map(Object.entries(initial));
  }
  read(name: string): unknown {
    return this.data.get(name);
  }
  write(name: string, value: unknown): void {
    this.data.set(name, value);
  }
  has(name: string): boolean {
    return this.data.has(name);
  }
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.data);
  }
}
