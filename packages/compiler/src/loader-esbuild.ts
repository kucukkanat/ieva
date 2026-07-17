import type { ReadFs } from "ieva/runtime";
import { joinPath } from "ieva/runtime";
import type { LoadedModule, ModuleLoader } from "./loader.ts";

/** Structural view of the esbuild-wasm surface we use, so it stays an optional peer. */
interface Esbuild {
  initialize(opts: { wasmURL: string }): Promise<void>;
  build(opts: EsbuildBuildOptions): Promise<{ outputFiles: Array<{ text: string }> }>;
}
interface EsbuildBuildOptions {
  entryPoints: string[];
  bundle: boolean;
  write: false;
  format: "esm";
  plugins: Array<{ name: string; setup: (build: EsbuildPluginBuild) => void }>;
}
interface EsbuildPluginBuild {
  onResolve(
    filter: { filter: RegExp },
    cb: (args: { path: string; importer: string }) =>
      | { path: string; namespace?: string; external?: boolean }
      | undefined,
  ): void;
  onLoad(
    filter: { filter: RegExp; namespace?: string },
    cb: (args: { path: string }) => Promise<{ contents: string; loader: "ts" | "js" }>,
  ): void;
}

/**
 * The default set of exports per `ieva` subpath, used to generate runtime shims. Kept
 * in sync with the framework's public surface — a compiled tool that imports a name not
 * listed here for its subpath will fail to bundle with a clear "not provided" error.
 */
export const DEFAULT_IEVA_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  ieva: ["defineAgent", "defineDynamic", "KIND"],
  "ieva/tools": ["defineTool", "disableTool"],
  "ieva/tools/approval": ["always", "once", "never"],
  "ieva/skills": ["defineSkill"],
  "ieva/instructions": ["defineInstructions"],
  "ieva/hooks": ["defineHook"],
  "ieva/sandbox": ["defineSandbox"],
  "ieva/context": ["defineState"],
};

export interface EsbuildLoaderOptions {
  readonly fs: ReadFs;
  /** Absolute URL of the esbuild-wasm binary. */
  readonly wasmURL: string;
  /**
   * Share the host's single `ieva` runtime instance into every compiled module. The
   * host assigns its imported modules to `globalThis[globalVar]` keyed by subpath; the
   * loader generates a shim that re-exports from there. This is what makes `defineState`
   * work — the shim and the harness touch the SAME context register, not two copies.
   */
  readonly runtimeGlobal?: {
    readonly globalVar: string;
    readonly exports?: Readonly<Record<string, readonly string[]>>;
  };
  /**
   * Alternative to `runtimeGlobal`: map `ieva` and its subpaths to absolute URLs, marked
   * external. Simpler, but yields a second runtime instance (fine unless tools use
   * `defineState`). Ignored when `runtimeGlobal` is set.
   */
  readonly ievaModuleUrls?: Readonly<Record<string, string>>;
  /** Resolve a bare dependency to an absolute URL. Defaults to esm.sh. */
  readonly resolveBare?: (specifier: string) => string;
}

const VFS_NAMESPACE = "ieva-vfs";
const SHIM_NAMESPACE = "ieva-shim";
let initialized: Promise<void> | undefined;

/**
 * The production module loader. Bundles a VFS entry with esbuild-wasm — transpiling .ts
 * and .js alike — while resolving `ieva/*` to the shared host runtime and bare deps to
 * absolute CDN URLs, then imports the result through a blob URL. This is what lets a real
 * eve-style `.ts` tool run unmodified in a tab.
 */
export class EsbuildLoader implements ModuleLoader {
  constructor(
    private readonly esbuild: Esbuild,
    private readonly options: EsbuildLoaderOptions,
  ) {}

  static async create(esbuild: Esbuild, options: EsbuildLoaderOptions): Promise<EsbuildLoader> {
    initialized ??= esbuild.initialize({ wasmURL: options.wasmURL });
    await initialized;
    return new EsbuildLoader(esbuild, options);
  }

  async load(entryPath: string): Promise<LoadedModule> {
    const { fs } = this.options;
    const resolveBare = this.options.resolveBare ?? ((s) => `https://esm.sh/${s}`);
    const runtimeGlobal = this.options.runtimeGlobal;
    const ievaModuleUrls = this.options.ievaModuleUrls ?? {};
    const exports = runtimeGlobal?.exports ?? DEFAULT_IEVA_EXPORTS;

    const result = await this.esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      format: "esm",
      plugins: [
        {
          name: "ieva-resolver",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (args.path === entryPath) {
                return { path: entryPath, namespace: VFS_NAMESPACE };
              }
              if (args.path.startsWith(".")) {
                return { path: joinPath(dirname(args.importer), args.path), namespace: VFS_NAMESPACE };
              }
              const isIeva = args.path === "ieva" || args.path.startsWith("ieva/");
              if (isIeva) {
                if (runtimeGlobal) return { path: args.path, namespace: SHIM_NAMESPACE };
                const url = ievaModuleUrls[args.path];
                if (url) return { path: url, external: true };
              }
              // Everything else is a bare dep → absolute CDN URL (external).
              return { path: resolveBare(args.path), external: true };
            });

            build.onLoad({ filter: /.*/, namespace: VFS_NAMESPACE }, async (args) => ({
              contents: await fs.readTextFile(args.path),
              loader: args.path.endsWith(".js") ? "js" : "ts",
            }));

            // Shim: re-export the host's shared runtime module from a global.
            build.onLoad({ filter: /.*/, namespace: SHIM_NAMESPACE }, async (args) => ({
              contents: shimSource(runtimeGlobal?.globalVar ?? "__IEVA_RUNTIME__", args.path, exports),
              loader: "js",
            }));
          },
        },
      ],
    });

    const code = result.outputFiles[0]?.text ?? "";
    const blob = new Blob([code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      return (await import(/* @vite-ignore */ url)) as LoadedModule;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function shimSource(
  globalVar: string,
  subpath: string,
  exports: Readonly<Record<string, readonly string[]>>,
): string {
  const names = exports[subpath] ?? [];
  const lines = [`const __m = globalThis[${JSON.stringify(globalVar)}][${JSON.stringify(subpath)}];`];
  if (!exports[subpath]) {
    lines.push(
      `if (!__m) throw new Error(${JSON.stringify(`ieva runtime shim: "${subpath}" not provided on globalThis.${globalVar}`)});`,
    );
  }
  for (const name of names) {
    lines.push(`export const ${name} = __m[${JSON.stringify(name)}];`);
  }
  lines.push("export default __m.default;");
  return lines.join("\n");
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}
