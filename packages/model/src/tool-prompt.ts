import type { ContentPart, ModelMessage, ModelToolSpec, ToolCall } from "ieva/runtime";

/**
 * Prompt-based tool calling for models that lack a native tool-use channel — the tiny
 * local models we run through transformers.js. We describe the tools in the system
 * prompt, ask for a single JSON object when the model wants to call one, and parse that
 * object back into structured `ToolCall`s. Cloud models (Anthropic) use their native
 * tool API instead and never touch this.
 */

const CALL_ID_PREFIX = "call";

/** Append a tool catalogue + calling protocol to the base system prompt. */
export function buildToolSystemPrompt(baseSystem: string, tools: readonly ModelToolSpec[]): string {
  if (tools.length === 0) return baseSystem;
  const catalogue = tools
    .map(
      (t) =>
        `### ${t.name}\n${t.description}\nParameters (JSON Schema): ${JSON.stringify(t.inputSchema)}`,
    )
    .join("\n\n");
  const first = tools[0] as ModelToolSpec;
  const example = JSON.stringify({
    tool_call: { name: first.name, arguments: exampleArgs(first.inputSchema) },
  });
  return `${baseSystem}

# Tools

You have these tools available:

${catalogue}

## How to call a tool

If the user's request can be handled by one of the tools above, you MUST call that tool instead of answering from your own knowledge — even if you believe you already know the answer. Do not compute or guess results yourself when a tool can produce them.

To call a tool, your ENTIRE reply must be a single JSON object, with no other text before or after it:
${example}

Call one tool at a time. You will then be sent the tool's result; use it to write your final answer to the user in plain, natural language (do not output JSON in your final answer). Only answer directly, without a tool call, when no tool applies.`;
}

export interface NativeTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

/**
 * Convert ieva tool specs to the OpenAI-style function shape that transformers.js chat
 * templates expect for native tool use. Templates that declare `tool_use` (Qwen, Llama 3.1,
 * Hermes, …) render these in the model's trained format; templates without it ignore them,
 * so passing these is always safe and the prose prompt above is the fallback.
 */
export function toNativeTools(tools: readonly ModelToolSpec[]): NativeTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** A minimal placeholder argument object so the one-shot example matches the real schema. */
function exampleArgs(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(properties as Record<string, unknown>)) {
    const type =
      typeof spec === "object" && spec !== null ? (spec as { type?: unknown }).type : undefined;
    out[key] = type === "number" || type === "integer" ? 0 : type === "boolean" ? false : "…";
  }
  return out;
}

/**
 * Flatten ieva's structured message history into role/content text the chat template can
 * render. Crucially, tool-call and tool-result parts are serialized to text (Gemma/Qwen
 * templates would otherwise drop them), so the model sees the calls it made and the
 * results it got back.
 */
export function toChatHistory(
  system: string,
  messages: readonly ModelMessage[],
): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: system },
    ...messages.map((message) => ({
      role: message.role === "tool" ? "user" : message.role,
      content: renderContent(message.content),
    })),
  ];
}

function renderContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map(renderPart).filter(Boolean).join("\n");
}

function renderPart(part: ContentPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "tool-call":
      return JSON.stringify({ tool_call: { name: part.name, arguments: part.input } });
    case "tool-result":
      return `Tool result for ${part.name}: ${stringify(part.output)}`;
  }
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export interface ParsedGeneration {
  readonly text: string;
  readonly toolCalls: ToolCall[];
}

/**
 * Pull tool calls out of a raw generation. First tries strict JSON — the wrapped
 * `{"tool_call": {name, arguments}}` and bare `{name, arguments}` forms, fenced or not.
 * If none parse, falls back to a lenient scan for a known tool name followed by a brace or
 * paren group of loose key/value args — tiny models routinely emit near-JSON like
 * `call:multiply{a:739,b:48}` or `multiply(a=739, b=48)` that JSON.parse rejects. Prose
 * around a strict call is preserved as `text`; a lenient match is treated as a pure call.
 */
export function parseToolCalls(
  raw: string,
  knownTools: ReadonlySet<string>,
  makeId: () => string = defaultId,
): ParsedGeneration {
  const toolCalls: ToolCall[] = [];
  let residual = stripFences(raw);

  for (const match of scanJsonObjects(residual)) {
    const call = interpret(match.value, knownTools);
    if (!call) continue;
    toolCalls.push({ callId: makeId(), name: call.name, input: call.arguments });
    residual = residual.replace(match.source, "");
  }

  if (toolCalls.length > 0) return { text: residual.trim(), toolCalls };

  const lenient = parseLenient(residual, knownTools, makeId);
  if (lenient.length > 0) return { text: "", toolCalls: lenient };

  return { text: residual.trim(), toolCalls: [] };
}

/**
 * Match `<toolName><sep>?<open>…<close>` for each known tool, extracting loose `key: value`
 * or `key = value` pairs (quoted or not). Deliberately keyed on the known tool names so
 * arbitrary prose braces don't register as calls.
 */
function parseLenient(
  text: string,
  knownTools: ReadonlySet<string>,
  makeId: () => string,
): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const name of knownTools) {
    const opener = new RegExp(`${escapeRegExp(name)}\\s*["']?\\s*[:=]?\\s*([{(])`).exec(text);
    if (!opener) continue;
    const open = opener[1] as "{" | "(";
    const openIndex = opener.index + opener[0].length - 1;
    const end = matchDelim(text, openIndex, open, open === "{" ? "}" : ")");
    if (end === -1) continue;
    calls.push({ callId: makeId(), name, input: parseLooseArgs(text.slice(openIndex + 1, end)) });
  }
  return calls;
}

const LOOSE_PAIR = /["']?([A-Za-z_]\w*)["']?\s*[:=]\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,}\])]+)/g;

function parseLooseArgs(inner: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [, key, value] of inner.matchAll(LOOSE_PAIR)) {
    out[key as string] = coerceScalar((value as string).trim());
  }
  return out;
}

function coerceScalar(raw: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const quoted = /^(["'])([\s\S]*)\1$/.exec(raw);
  return quoted ? quoted[2] : raw;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Balanced scan for an arbitrary open/close delimiter pair, respecting quoted strings. */
function matchDelim(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote = "";
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface Interpreted {
  readonly name: string;
  readonly arguments: unknown;
}

function interpret(value: unknown, knownTools: ReadonlySet<string>): Interpreted | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const inner =
    "tool_call" in record && typeof record.tool_call === "object" && record.tool_call !== null
      ? (record.tool_call as Record<string, unknown>)
      : record;
  const name = inner.name;
  if (typeof name !== "string" || !knownTools.has(name)) return undefined;
  const rawArgs = inner.arguments ?? inner.parameters ?? inner.input ?? {};
  return { name, arguments: coerceArgs(rawArgs) };
}

function coerceArgs(rawArgs: unknown): unknown {
  if (typeof rawArgs !== "string") return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch {
    return rawArgs;
  }
}

/** Drop ``` fences (```json, ```tool_call, …) so the JSON inside is scannable. */
function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z_]*\n?/g, "").replace(/```/g, "");
}

interface JsonMatch {
  readonly source: string;
  readonly value: unknown;
}

/**
 * Yield every top-level balanced `{…}` region that parses as JSON, ignoring braces inside
 * strings. Small models often wrap the call in prose, so we can't just JSON.parse the whole
 * output.
 */
function* scanJsonObjects(text: string): Generator<JsonMatch> {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    const end = matchBrace(text, i);
    if (end === -1) continue;
    const source = text.slice(i, end + 1);
    try {
      yield { source, value: JSON.parse(source) };
    } catch {
      // Not valid JSON on its own — skip and keep scanning from the next char.
    }
    i = end;
  }
}

function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function defaultId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : "x";
  return `${CALL_ID_PREFIX}_${uuid}`;
}
