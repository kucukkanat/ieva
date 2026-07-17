/**
 * Minimal ambient declaration for the one fflate export we use. fflate is an optional
 * peer dependency, so we do not take its full types — this keeps `import("fflate")`
 * type-safe whether or not the consumer has installed it.
 */
declare module "fflate" {
  export function unzipSync(data: Uint8Array): Record<string, Uint8Array>;
}
