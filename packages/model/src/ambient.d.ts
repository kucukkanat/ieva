/**
 * Minimal ambient declaration for the web-llm entry point we call. `@mlc-ai/web-llm` is
 * an optional peer dependency; this keeps `import("@mlc-ai/web-llm")` type-safe without
 * requiring consumers who never use local inference to install it.
 */
declare module "@mlc-ai/web-llm" {
  export function CreateMLCEngine(model: string, config?: unknown): Promise<unknown>;
}
