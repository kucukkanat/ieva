import type {
  AgentModel,
  ContentPart,
  GenerateRequest,
  GenerateResult,
  ModelMessage,
} from "ieva/runtime";

export interface ModelChoice {
  readonly id: string;
  readonly label: string;
  /** Approximate download footprint in MB. */
  readonly sizeMB: number;
  /** Recommended dtype for WebGPU (Gemma 3 avoids fp16 due to an ORT overflow bug). */
  readonly dtype: string;
  readonly note?: string;
}

/**
 * Curated tiny, browser-runnable models. Qwen3 is the current tiny Qwen family; Gemma 4
 * E2B is Google's latest small model (larger/experimental — it's multimodal, so the
 * text-generation path may be finicky); Gemma 3 270M is the truly-tiny option.
 */
const MODELS: readonly ModelChoice[] = [
  { id: "onnx-community/Qwen3-0.6B-ONNX", label: "Qwen3 0.6B", dtype: "q4f16", sizeMB: 900 },
  { id: "onnx-community/Qwen3-1.7B-ONNX", label: "Qwen3 1.7B", dtype: "q4f16", sizeMB: 1900 },
  {
    id: "onnx-community/gemma-3-270m-it-ONNX",
    label: "Gemma 3 270M",
    dtype: "q4",
    sizeMB: 300,
    note: "tiniest",
  },
  {
    id: "onnx-community/gemma-4-E2B-it-ONNX",
    label: "Gemma 4 E2B",
    dtype: "q4f16",
    sizeMB: 2500,
    note: "experimental",
  },
];

export function listLocalModels(): ModelChoice[] {
  return [...MODELS];
}

export interface ProgressState {
  readonly progress: number;
  readonly text: string;
}

interface ProgressReport {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

const CACHE_NAMES = ["transformers-cache"];

/**
 * Manages a single locally-loaded transformers.js model: load (with progress), unload,
 * cache checks, and exposing the loaded pipeline as an ieva `AgentModel`. Runs in a Web
 * Worker so weight loading and generation never block the UI. WebGPU needs no COOP/COEP
 * headers, so this works served from GitHub Pages.
 */
export class LocalModelManager {
  private worker: Worker | undefined;
  private loadedId: string | undefined;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (err: Error) => void }
  >();

  get currentModelId(): string | undefined {
    return this.loadedId;
  }

  static webgpuAvailable(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator;
  }

  /** Best-effort cache check across the browser Cache API (transformers.js caches there). */
  async isCached(modelId: string): Promise<boolean> {
    if (typeof caches === "undefined") return false;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const reqs = await cache.keys();
      if (reqs.some((r) => r.url.includes(modelId))) return true;
    }
    return false;
  }

  async deleteCache(modelId: string): Promise<void> {
    if (typeof caches === "undefined") return;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        if (req.url.includes(modelId)) await cache.delete(req);
      }
    }
  }

  async load(modelId: string, onProgress: (p: ProgressState) => void): Promise<void> {
    await this.unload();
    const choice = MODELS.find((m) => m.id === modelId);
    const worker = new Worker(new URL("./transformers-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker = worker;

    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === "progress") {
          onProgress(formatProgress(msg.report as ProgressReport));
        } else if (msg.type === "ready") {
          resolve();
        } else if (msg.type === "error" && msg.id === undefined) {
          reject(new Error(msg.error));
        } else if (msg.type === "result" || msg.type === "token" || msg.type === "error") {
          this.handleGeneration(msg);
        }
      };
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ type: "load", modelId, dtype: choice?.dtype ?? "q4" });
    });
    this.loadedId = modelId;
  }

  async unload(): Promise<void> {
    if (this.worker) {
      this.worker.postMessage({ type: "unload" });
      this.worker.terminate();
    }
    this.worker = undefined;
    this.loadedId = undefined;
    for (const p of this.pending.values()) p.reject(new Error("Model unloaded"));
    this.pending.clear();
  }

  private handleGeneration(msg: { type: string; id: number; text?: string; error?: string }): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    if (msg.type === "result") {
      this.pending.delete(msg.id);
      entry.resolve(msg.text ?? "");
    } else if (msg.type === "error") {
      this.pending.delete(msg.id);
      entry.reject(new Error(msg.error));
    }
    // "token" events stream partial text; the AgentModel awaits the final "result".
  }

  private generate(messages: Array<{ role: string; content: string }>): Promise<string> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("No model loaded"));
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: "generate", id, messages, maxTokens: 384 });
    });
  }

  /** The loaded pipeline as an ieva AgentModel. Throws if nothing is loaded. */
  asAgentModel(): AgentModel {
    const id = this.loadedId;
    if (!this.worker || !id) throw new Error("No local model is loaded. Load one first.");
    const generate = (m: Array<{ role: string; content: string }>) => this.generate(m);
    return {
      id: `transformers/${id}`,
      async generate(request: GenerateRequest): Promise<GenerateResult> {
        const messages = [
          { role: "system", content: request.system },
          ...request.messages.map(toChatMessage),
        ];
        // Small local models don't reliably emit structured tool calls; we generate chat
        // text only (the tool-free "Assistant" example is the intended local demo).
        const text = await generate(messages);
        return { text: text.trim(), toolCalls: [], finishReason: "stop" };
      },
    };
  }
}

function formatProgress(report: ProgressReport): ProgressState {
  const pct = typeof report.progress === "number" ? report.progress : 0;
  const file = report.file ? report.file.split("/").pop() : "";
  const verb =
    report.status === "done" || report.status === "ready"
      ? "Loaded"
      : report.status === "initiate"
        ? "Preparing"
        : "Downloading";
  const label = file ? `${verb} ${file}` : verb;
  return {
    progress: Math.min(1, pct / 100),
    text: pct ? `${label} — ${Math.round(pct)}%` : label,
  };
}

function toChatMessage(message: ModelMessage): { role: string; content: string } {
  if (typeof message.content === "string") return { role: message.role, content: message.content };
  const text = message.content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
  const role = message.role === "tool" ? "user" : message.role;
  return { role, content: text };
}

// Cache-name hint kept for reference; the cache scan above is name-agnostic.
export const TRANSFORMERS_CACHE_NAMES = CACHE_NAMES;
