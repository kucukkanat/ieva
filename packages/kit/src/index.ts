import { Client } from "ieva/client";
import type {
  CheckpointStore,
  ModelRegistry,
  ReadFs,
  SandboxHandle,
  ToolDefinition,
} from "ieva/runtime";
import { allDiagnostics, discover, hasErrors } from "ieva/runtime";
import type { AgentManifest, Diagnostic } from "ieva/runtime";
import { compileAgent, type ModuleLoader } from "@ieva/compiler";

export interface BootstrapOptions {
  /** The VFS to discover and read from (OpfsFileSystem.asReadFs() in the browser). */
  readonly fs: ReadFs;
  /** The agent directory root within the VFS, e.g. "/agents/my-agent/agent". */
  readonly root: string;
  /** Module loader — esbuild-backed in the browser, native import in tests. */
  readonly loader: ModuleLoader;
  /** Model registry (BYOK cloud and/or local). */
  readonly registry: ModelRegistry;
  /** Durable checkpoint store (IdbStore in the browser, MemStore in tests). */
  readonly store: CheckpointStore;
  /** Host-provided built-in tools (web_fetch, web_search, todo, …). */
  readonly builtinTools?: Map<string, ToolDefinition>;
  /** Opens the sandbox for the agent, when a sandbox slot is present. */
  readonly createSandbox?: (manifest: AgentManifest) => () => Promise<SandboxHandle>;
  /** Resume an existing session by id instead of starting fresh. */
  readonly sessionId?: string;
  readonly resume?: boolean;
  /** Package.json#name override for the root agent's identity. */
  readonly nameHint?: string;
}

export interface BootstrapResult {
  readonly client: Client;
  readonly manifest: AgentManifest;
  readonly diagnostics: Diagnostic[];
}

/**
 * Turn an agent directory in the VFS into a running client, in one call:
 * discover (no code executed) → compile (modules imported, brands validated) →
 * construct a Client over the harness. Throws if discovery or compilation produced
 * any error-level diagnostic — the messages are the developer-facing error surface.
 */
export async function bootstrapAgent(options: BootstrapOptions): Promise<BootstrapResult> {
  const manifest = await discover(options.fs, options.root, {
    ...(options.nameHint ? { nameHint: options.nameHint } : {}),
  });
  if (hasErrors(manifest)) {
    throw new BootstrapError("Discovery failed", allDiagnostics(manifest));
  }

  const { agent, diagnostics } = await compileAgent(
    manifest,
    options.fs,
    options.loader,
    options.createSandbox ? { createSandbox: options.createSandbox } : {},
  );
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    throw new BootstrapError("Compilation failed", errors.map((d) => ({ ...d, agent: agent.name })));
  }

  const client = await Client.create(
    agent,
    {
      registry: options.registry,
      store: options.store,
      ...(options.builtinTools ? { builtinTools: options.builtinTools } : {}),
    },
    {
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.resume ? { resume: options.resume } : {}),
    },
  );

  return { client, manifest, diagnostics };
}

/** Thrown when discovery or compilation produces errors; carries the structured list. */
export class BootstrapError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Array<Diagnostic & { agent: string }>,
  ) {
    super(`${message}: ${diagnostics.map((d) => `[${d.code}] ${d.message}`).join("; ")}`);
    this.name = "BootstrapError";
  }
}

export { Client } from "ieva/client";
export type { AgentManifest, Diagnostic } from "ieva/runtime";
