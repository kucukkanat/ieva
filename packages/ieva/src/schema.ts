/**
 * The subset of the Standard Schema v1 contract we depend on.
 *
 * Zod (>=3.24), Valibot, ArkType and friends all expose `~standard`, so accepting
 * this interface means accepting any of them without a direct dependency on any.
 * A plain JSON Schema object is also accepted at the value level; it simply carries
 * no static input type (mirrors eve's `Record<string, unknown>` fallback).
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> };

/** A JSON Schema object with no static typing — the untyped escape hatch. */
export type JsonSchema = Record<string, unknown>;

/** Anything acceptable as a tool/agent schema. */
export type AnySchema = StandardSchemaV1 | JsonSchema;

/** Infer the parsed input type from a schema, falling back to an opaque record. */
export type InferInput<S> = S extends StandardSchemaV1<infer I, unknown>
  ? I
  : Record<string, unknown>;

export type InferOutput<S> = S extends StandardSchemaV1<unknown, infer O>
  ? O
  : unknown;

/**
 * Best-effort JSON Schema for advertising a tool to the model. A plain JSON Schema
 * object is passed through unchanged (eve supports authoring tools this way, and it
 * needs no conversion dependency). A Standard Schema with no embedded JSON Schema
 * degrades to an open object — full Zod→JSON conversion is the AI SDK adapter's job.
 */
export function schemaToJsonSchema(schema: AnySchema): JsonSchema {
  if (!isStandardSchema(schema)) return schema;
  const embedded = (schema as { jsonSchema?: JsonSchema }).jsonSchema;
  if (embedded && typeof embedded === "object") return embedded;
  return { type: "object", additionalProperties: true };
}

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    "~standard" in value &&
    typeof (value as StandardSchemaV1)["~standard"]?.validate === "function"
  );
}

/**
 * Validate a value against any accepted schema. JSON Schema objects are passed
 * through unchecked — we have no validator for them at runtime, matching eve's
 * "types it as Record<string, unknown>" behavior.
 */
export async function validateInput(
  schema: AnySchema,
  value: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; issues: string[] }> {
  if (!isStandardSchema(schema)) {
    return { ok: true, value };
  }
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    return { ok: false, issues: result.issues.map((i) => i.message) };
  }
  return { ok: true, value: result.value };
}
