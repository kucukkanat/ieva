import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  hasModelInCache,
  prebuiltAppConfig,
  type InitProgressReport,
  type MLCEngineInterface,
} from "@mlc-ai/web-llm";
import type {
  AgentModel,
  ContentPart,
  GenerateRequest,
  GenerateResult,
  ModelMessage,
  ToolCall,
} from "ieva/runtime";

export interface ModelChoice {
  readonly id: string;
  readonly label: string;
  /** Approximate VRAM/download footprint in MB, from the prebuilt config. */
  readonly sizeMB: number;
}

/** A curated shortlist of small, tool-capable models that load reasonably in a tab. */
const CURATED = [
  "Llama-3.2-1B-Instruct-q4f32_1-MLC",
  "Llama-3.2-3B-Instruct-q4f32_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
  "gemma-2-2b-it-q4f16_1-MLC",
];

export function listLocalModels(): ModelChoice[] {
  const byId = new Map(prebuiltAppConfig.model_list.map((m) => [m.model_id, m]));
  const picks = CURATED.filter((id) => byId.has(id));
  const ids = picks.length > 0 ? picks : prebuiltAppConfig.model_list.slice(0, 8).map((m) => m.model_id);
  return ids.map((id) => {
    const entry = byId.get(id);
    return {
      id,
      label: id.replace(/-MLC$/, ""),
      sizeMB: entry?.vram_required_MB ?? 0,
    };
  });
}

export interface ProgressState {
  readonly progress: number;
  readonly text: string;
}

/**
 * Manages a single locally-loaded WebGPU model: load (with progress), unload, cache
 * checks, and exposing the loaded engine as an ieva `AgentModel`. Uses a Web Worker
 * engine so weight loading and generation never block the UI. WebGPU needs no COOP/COEP
 * headers, so this works when served from GitHub Pages.
 */
export class LocalModelManager {
  private engine: MLCEngineInterface | undefined;
  private worker: Worker | undefined;
  private loadedId: string | undefined;

  get currentModelId(): string | undefined {
    return this.loadedId;
  }

  static webgpuAvailable(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator;
  }

  isCached(modelId: string): Promise<boolean> {
    return hasModelInCache(modelId, prebuiltAppConfig).catch(() => false);
  }

  async deleteCache(modelId: string): Promise<void> {
    await deleteModelAllInfoInCache(modelId, prebuiltAppConfig);
  }

  async load(modelId: string, onProgress: (p: ProgressState) => void): Promise<void> {
    await this.unload();
    this.worker = new Worker(new URL("./webllm-worker.ts", import.meta.url), { type: "module" });
    this.engine = await CreateWebWorkerMLCEngine(this.worker, modelId, {
      initProgressCallback: (report: InitProgressReport) =>
        onProgress({ progress: report.progress, text: report.text }),
    });
    this.loadedId = modelId;
  }

  async unload(): Promise<void> {
    if (this.engine) await this.engine.unload().catch(() => undefined);
    this.worker?.terminate();
    this.engine = undefined;
    this.worker = undefined;
    this.loadedId = undefined;
  }

  /** The loaded engine as an ieva AgentModel. Throws if nothing is loaded. */
  asAgentModel(): AgentModel {
    const engine = this.engine;
    const id = this.loadedId;
    if (!engine || !id) throw new Error("No local model is loaded. Load one first.");
    return {
      id: `webllm/${id}`,
      async generate(request: GenerateRequest): Promise<GenerateResult> {
        const messages = [
          { role: "system", content: request.system },
          ...request.messages.map(toOpenAiMessage),
        ];
        const response = await engine.chat.completions.create({
          messages: messages as never,
          ...(request.tools.length > 0
            ? {
                tool_choice: "auto",
                tools: request.tools.map((t) => ({
                  type: "function" as const,
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema,
                  },
                })),
              }
            : {}),
        });
        return parseChoice(response);
      },
    };
  }
}

interface ChatResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
}

function parseChoice(response: ChatResponse): GenerateResult {
  const choice = response.choices[0];
  const text = choice?.message.content ?? "";
  const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((c, i) => ({
    callId: c.id ?? `local-${i}`,
    name: c.function.name,
    input: safeParse(c.function.arguments),
  }));
  const finishReason: GenerateResult["finishReason"] =
    toolCalls.length > 0 || choice?.finish_reason === "tool_calls"
      ? "tool-calls"
      : choice?.finish_reason === "length"
        ? "length"
        : "stop";
  return { text, toolCalls, finishReason };
}

function toOpenAiMessage(message: ModelMessage): { role: string; content: string; tool_call_id?: string } {
  if (message.role === "tool") {
    const part = asParts(message.content).find((p) => p.type === "tool-result");
    return {
      role: "tool",
      content: part && part.type === "tool-result" ? stringify(part.output) : "",
      ...(part && part.type === "tool-result" ? { tool_call_id: part.callId } : {}),
    };
  }
  if (typeof message.content === "string") return { role: message.role, content: message.content };
  const text = message.content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
  return { role: message.role, content: text };
}

function asParts(content: ModelMessage["content"]): ContentPart[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}
function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
