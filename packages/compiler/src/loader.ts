import type { ReadFs } from "ieva/runtime";

/**
 * Turns a module path in the VFS into an imported ES module. The strategy is pluggable:
 * the browser uses esbuild-wasm + blob URLs (see `loader-esbuild.ts`); tests inject a
 * loader backed by the host's native `import()`, which is what keeps the compiler's
 * orchestration testable without a bundler.
 */
export interface ModuleLoader {
  load(entryPath: string): Promise<LoadedModule>;
}

export interface LoadedModule {
  readonly default?: unknown;
  readonly [name: string]: unknown;
}

export interface LoaderContext {
  readonly fs: ReadFs;
}
