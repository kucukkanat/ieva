import { KIND } from "ieva";
import type { AgentDefinition, HookDefinition, SkillDefinition, ToolDefinition } from "ieva";
import type {
  AgentManifest,
  Diagnostic,
  LoadedAgent,
  LoadedSkill,
  ReadFs,
  SandboxHandle,
} from "ieva/runtime";
import { joinPath } from "ieva/runtime";
import type { LoadedModule, ModuleLoader } from "./loader.ts";

const DEFAULT_MODEL = "anthropic/claude-sonnet-5";
const DEFAULT_COMPACTION = { thresholdPercent: 0.9 } as const;

export interface CompileOptions {
  /** Factory that opens the sandbox for this agent, wired by the runtime host. */
  readonly createSandbox?: (
    manifest: AgentManifest,
  ) => () => Promise<SandboxHandle>;
}

export interface CompileResult {
  readonly agent: LoadedAgent;
  readonly diagnostics: Diagnostic[];
}

/**
 * Compile a discovered manifest into a runnable LoadedAgent: assemble instructions,
 * import every module-backed slot, and validate each default export's brand. Runs the
 * `defineInstructions` module (if any) exactly once here at build time, matching eve.
 */
export async function compileAgent(
  manifest: AgentManifest,
  fs: ReadFs,
  loader: ModuleLoader,
  options: CompileOptions = {},
): Promise<CompileResult> {
  const diagnostics: Diagnostic[] = [...manifest.diagnostics];

  const instructions = await assembleInstructions(manifest, fs, loader, diagnostics);
  const { tools, disabledTools } = await loadTools(manifest, loader, diagnostics);
  const skills = await loadSkills(manifest, fs, loader, diagnostics);
  const hooks = await loadHooks(manifest, loader, diagnostics);
  const config = await loadAgentConfig(manifest, loader, diagnostics);

  const subagents = new Map<string, LoadedAgent>();
  for (const sub of manifest.subagents) {
    const compiled = await compileAgent(sub, fs, loader, options);
    subagents.set(sub.name, compiled.agent);
    diagnostics.push(...compiled.diagnostics.filter((d) => !manifest.diagnostics.includes(d)));
  }

  const agent: LoadedAgent = {
    name: manifest.name,
    instructions,
    model: config.model,
    tools,
    disabledTools,
    skills,
    hooks,
    subagents,
    compaction: config.compaction,
    limits: config.limits,
    ...(manifest.sandbox && options.createSandbox
      ? { openSandbox: options.createSandbox(manifest) }
      : {}),
  };
  return { agent, diagnostics };
}

async function assembleInstructions(
  manifest: AgentManifest,
  fs: ReadFs,
  loader: ModuleLoader,
  diagnostics: Diagnostic[],
): Promise<string> {
  const parts: string[] = [];
  for (const source of manifest.instructions) {
    if (source.kind === "markdown") {
      parts.push(await fs.readTextFile(source.path));
    } else {
      const mod = await loader.load(source.path);
      const def = mod.default as { markdown?: string } | undefined;
      if (def?.markdown !== undefined) parts.push(def.markdown);
      else
        diagnostics.push({
          severity: "error",
          code: "instructions/bad-export",
          message: "Instructions module must default-export defineInstructions(...).",
          path: source.path,
        });
    }
  }
  return parts.join("\n\n");
}

async function loadTools(
  manifest: AgentManifest,
  loader: ModuleLoader,
  diagnostics: Diagnostic[],
): Promise<{ tools: Map<string, ToolDefinition>; disabledTools: Set<string> }> {
  const tools = new Map<string, ToolDefinition>();
  const disabledTools = new Set<string>();
  for (const entry of manifest.tools) {
    const mod = await loader.load(entry.modulePath);
    const kind = brandOf(mod);
    if (kind === "tool-disabled") {
      disabledTools.add(entry.name);
    } else if (kind === "tool") {
      tools.set(entry.name, mod.default as ToolDefinition);
    } else {
      diagnostics.push({
        severity: "error",
        code: "tool/bad-export",
        message: `Tool "${entry.name}" must default-export defineTool(...) or disableTool().`,
        path: entry.modulePath,
      });
    }
  }
  return { tools, disabledTools };
}

async function loadSkills(
  manifest: AgentManifest,
  fs: ReadFs,
  loader: ModuleLoader,
  diagnostics: Diagnostic[],
): Promise<Map<string, LoadedSkill>> {
  const skills = new Map<string, LoadedSkill>();
  for (const entry of manifest.skills) {
    if (entry.kind === "module") {
      const mod = await loader.load(entry.modulePath);
      if (brandOf(mod) !== "skill") {
        diagnostics.push({
          severity: "error",
          code: "skill/bad-export",
          message: `Skill "${entry.name}" must default-export defineSkill(...).`,
          path: entry.modulePath,
        });
        continue;
      }
      const def = mod.default as SkillDefinition;
      skills.set(entry.name, {
        name: entry.name,
        description: def.description,
        markdown: def.markdown,
        files: def.files ?? {},
      });
    } else if (entry.kind === "flat") {
      const body = stripFrontmatter(await fs.readTextFile(entry.path));
      skills.set(entry.name, {
        name: entry.name,
        description: entry.description,
        markdown: body,
        files: {},
      });
    } else {
      // Packaged: SKILL.md body + sibling files under the skill directory.
      const body = stripFrontmatter(await fs.readTextFile(entry.path));
      const files = await readSkillFiles(fs, entry.dir);
      skills.set(entry.name, {
        name: entry.name,
        description: entry.description,
        markdown: body,
        files,
      });
    }
  }
  return skills;
}

async function readSkillFiles(fs: ReadFs, dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(current)) {
      const child = joinPath(current, entry.name);
      const rel = `${prefix}${entry.name}`;
      if (entry.kind === "directory") await walk(child, `${rel}/`);
      else if (entry.name !== "SKILL.md") out[rel] = await fs.readTextFile(child);
    }
  };
  await walk(dir, "");
  return out;
}

async function loadHooks(
  manifest: AgentManifest,
  loader: ModuleLoader,
  diagnostics: Diagnostic[],
): Promise<HookDefinition[]> {
  const hooks: HookDefinition[] = [];
  for (const entry of manifest.hooks) {
    const mod = await loader.load(entry.modulePath);
    if (brandOf(mod) !== "hook") {
      diagnostics.push({
        severity: "error",
        code: "hook/bad-export",
        message: `Hook "${entry.name}" must default-export defineHook(...).`,
        path: entry.modulePath,
      });
      continue;
    }
    hooks.push(mod.default as HookDefinition);
  }
  return hooks;
}

async function loadAgentConfig(
  manifest: AgentManifest,
  loader: ModuleLoader,
  diagnostics: Diagnostic[],
): Promise<{
  model: string;
  compaction: { thresholdPercent: number } | false;
  limits: AgentDefinition["limits"] & object;
}> {
  if (!manifest.agentModule) {
    return { model: DEFAULT_MODEL, compaction: DEFAULT_COMPACTION, limits: {} };
  }
  const mod = await loader.load(manifest.agentModule);
  const def = mod.default as AgentDefinition | undefined;
  if (!def || brandOf(mod) !== "agent") {
    diagnostics.push({
      severity: "error",
      code: "agent/bad-export",
      message: "agent.ts must default-export defineAgent(...).",
      path: manifest.agentModule,
    });
    return { model: DEFAULT_MODEL, compaction: DEFAULT_COMPACTION, limits: {} };
  }
  const model = typeof def.model === "string" ? def.model : DEFAULT_MODEL;
  return {
    model,
    compaction: def.compaction ?? DEFAULT_COMPACTION,
    limits: def.limits ?? {},
  };
}

function brandOf(mod: LoadedModule): string | undefined {
  const def = mod.default as Record<PropertyKey, unknown> | undefined;
  if (!def || typeof def !== "object") return undefined;
  return def[KIND] as string | undefined;
}

function stripFrontmatter(source: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(source);
  return match ? source.slice(match[0].length) : source;
}
