/**
 * Minimal ambient declaration for the transformers.js entry point we call.
 * `@huggingface/transformers` is an optional peer dependency; this keeps
 * `import("@huggingface/transformers")` type-safe without requiring consumers who never
 * use local inference to install it.
 */
declare module "@huggingface/transformers" {
  export function pipeline(task: string, model: string, options?: unknown): Promise<unknown>;
}
