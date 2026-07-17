import { basename, type DirEntry, extname, joinPath, type ReadFs, stem } from "./fs.ts";
import { deriveSkillDescription, parseFrontmatter } from "./frontmatter.ts";
import type {
  AgentManifest,
  Diagnostic,
  HookEntry,
  InstructionSource,
  SandboxEntry,
  SkillEntry,
  ToolEntry,
} from "./manifest.ts";

const MODULE_EXTS = new Set([".ts", ".js", ".mjs", ".mts"]);
const TOOL_NAME_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * Walk an agent directory and produce a manifest. Never executes authored code —
 * identity and slot come entirely from the path. This is the fidelity oracle:
 * its output should match `eve info --json` modulo the slots we defer.
 */
export async function discover(
  fs: ReadFs,
  root: string,
  options: { isSubagent?: boolean; nameHint?: string } = {},
): Promise<AgentManifest> {
  const isSubagent = options.isSubagent ?? false;
  const diagnostics: Diagnostic[] = [];

  const name = await resolveName(fs, root, options.nameHint, isSubagent);
  const agentModule = await firstExisting(fs, root, ["agent.ts", "agent.js"]);
  const instructions = await discoverInstructions(fs, root, isSubagent, diagnostics);
  const tools = await discoverTools(fs, root, diagnostics);
  const skills = await discoverSkills(fs, root, diagnostics);
  const hooks = await discoverHooks(fs, root);
  const sandbox = await discoverSandbox(fs, root);
  const subagents = await discoverSubagents(fs, root, diagnostics);

  validateAgentConfig(agentModule, isSubagent, diagnostics);
  validateCollisions(tools, subagents, diagnostics);

  return {
    name,
    root,
    isSubagent,
    ...(agentModule ? { agentModule } : {}),
    instructions,
    tools,
    skills,
    hooks,
    subagents,
    ...(sandbox ? { sandbox } : {}),
    diagnostics,
  };
}

async function resolveName(
  fs: ReadFs,
  root: string,
  nameHint: string | undefined,
  isSubagent: boolean,
): Promise<string> {
  if (isSubagent) return basename(root);
  if (nameHint) return nameHint;
  // Root name from package.json#name, falling back to the directory name.
  const pkgPath = joinPath(root, "..", "package.json");
  if (await fs.exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.readTextFile(pkgPath)) as { name?: string };
      if (pkg.name) return pkg.name;
    } catch {
      // Malformed package.json — fall through to directory name.
    }
  }
  return basename(root);
}

async function discoverInstructions(
  fs: ReadFs,
  root: string,
  isSubagent: boolean,
  diagnostics: Diagnostic[],
): Promise<InstructionSource[]> {
  const sources: InstructionSource[] = [];
  const flatMd = joinPath(root, "instructions.md");
  const flatTs = await firstExisting(fs, root, ["instructions.ts", "instructions.js"]);
  const hasFlatMd = await fs.exists(flatMd);

  if (hasFlatMd && flatTs) {
    diagnostics.push({
      severity: "error",
      code: "instructions/dual-root",
      message: "Cannot author both instructions.md and instructions.ts at the root.",
      path: flatTs,
    });
  }

  if (hasFlatMd) sources.push({ kind: "markdown", path: flatMd });
  else if (flatTs) sources.push({ kind: "module", path: flatTs });

  // Directory form is read non-recursively and appended in localeCompare order.
  const dir = joinPath(root, "instructions");
  if (await fs.exists(dir)) {
    const entries = (await fs.readdir(dir))
      .filter((e) => e.kind === "file")
      .filter((e) => e.name.endsWith(".md") || MODULE_EXTS.has(extname(e.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      sources.push({
        kind: entry.name.endsWith(".md") ? "markdown" : "module",
        path: joinPath(dir, entry.name),
      });
    }
  }

  if (!isSubagent && sources.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "instructions/missing",
      message: "Root agent requires instructions (instructions.md, .ts, or a directory).",
      path: root,
    });
  }
  return sources;
}

async function discoverTools(
  fs: ReadFs,
  root: string,
  diagnostics: Diagnostic[],
): Promise<ToolEntry[]> {
  const dir = joinPath(root, "tools");
  if (!(await fs.exists(dir))) return [];
  const tools: ToolEntry[] = [];
  // Tools are flat (eve documents recursion for hooks/schedules but not tools/).
  for (const entry of await fs.readdir(dir)) {
    if (entry.kind !== "file" || !MODULE_EXTS.has(extname(entry.name))) continue;
    const name = stem(entry.name);
    if (!TOOL_NAME_RE.test(name)) {
      diagnostics.push({
        severity: "error",
        code: "tool/invalid-name",
        message: `Tool name "${name}" must be snake_case ASCII.`,
        path: joinPath(dir, entry.name),
      });
      continue;
    }
    tools.push({ name, modulePath: joinPath(dir, entry.name) });
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverSkills(
  fs: ReadFs,
  root: string,
  diagnostics: Diagnostic[],
): Promise<SkillEntry[]> {
  const dir = joinPath(root, "skills");
  if (!(await fs.exists(dir))) return [];
  const skills: SkillEntry[] = [];
  for (const entry of await fs.readdir(dir)) {
    if (entry.kind === "file" && entry.name.endsWith(".md")) {
      const name = stem(entry.name);
      const path = joinPath(dir, entry.name);
      const { data, body } = parseFrontmatter(await fs.readTextFile(path));
      skills.push({
        name,
        kind: "flat",
        description: deriveSkillDescription(name, data.description, body),
        path,
      });
    } else if (entry.kind === "file" && MODULE_EXTS.has(extname(entry.name))) {
      const name = stem(entry.name);
      skills.push({ name, kind: "module", modulePath: joinPath(dir, entry.name) });
    } else if (entry.kind === "directory") {
      const name = entry.name;
      const skillMd = joinPath(dir, name, "SKILL.md");
      if (!(await fs.exists(skillMd))) continue;
      const { data, body } = parseFrontmatter(await fs.readTextFile(skillMd));
      if (!data.description) {
        diagnostics.push({
          severity: "error",
          code: "skill/missing-description",
          message: `Packaged skill "${name}" must declare a description in SKILL.md frontmatter.`,
          path: skillMd,
        });
      }
      skills.push({
        name,
        kind: "packaged",
        description: deriveSkillDescription(name, data.description, body),
        path: skillMd,
        dir: joinPath(dir, name),
      });
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverHooks(fs: ReadFs, root: string): Promise<HookEntry[]> {
  const dir = joinPath(root, "hooks");
  if (!(await fs.exists(dir))) return [];
  const hooks: HookEntry[] = [];
  // Hooks support recursive directories.
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(current)) {
      if (entry.kind === "directory") {
        await walk(joinPath(current, entry.name), `${prefix}${entry.name}/`);
      } else if (MODULE_EXTS.has(extname(entry.name))) {
        hooks.push({
          name: `${prefix}${stem(entry.name)}`,
          modulePath: joinPath(current, entry.name),
        });
      }
    }
  };
  await walk(dir, "");
  return hooks.sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverSandbox(
  fs: ReadFs,
  root: string,
): Promise<SandboxEntry | undefined> {
  const flat = await firstExisting(fs, root, ["sandbox.ts", "sandbox.js"]);
  const nested = await firstExisting(fs, joinPath(root, "sandbox"), [
    "sandbox.ts",
    "sandbox.js",
  ]);
  const modulePath = nested ?? flat;
  const workspaceDir = joinPath(root, "sandbox", "workspace");
  const workspaceSeeds: string[] = [];
  if (await fs.exists(workspaceDir)) {
    const walk = async (current: string): Promise<void> => {
      for (const entry of await fs.readdir(current)) {
        const child = joinPath(current, entry.name);
        if (entry.kind === "directory") await walk(child);
        else workspaceSeeds.push(child);
      }
    };
    await walk(workspaceDir);
  }
  if (!modulePath && workspaceSeeds.length === 0) return undefined;
  return { ...(modulePath ? { modulePath } : {}), workspaceSeeds };
}

async function discoverSubagents(
  fs: ReadFs,
  root: string,
  diagnostics: Diagnostic[],
): Promise<AgentManifest[]> {
  const dir = joinPath(root, "subagents");
  if (!(await fs.exists(dir))) return [];
  const subagents: AgentManifest[] = [];
  for (const entry of await fs.readdir(dir)) {
    if (entry.kind !== "directory") continue;
    const child = await discover(fs, joinPath(dir, entry.name), { isSubagent: true });
    subagents.push(child);
    child.diagnostics.forEach((d) => diagnostics.push(d));
  }
  return subagents.sort((a, b) => a.name.localeCompare(b.name));
}

function validateAgentConfig(
  agentModule: string | undefined,
  isSubagent: boolean,
  diagnostics: Diagnostic[],
): void {
  // Subagents require agent.ts (with a description); the root's is optional.
  if (isSubagent && !agentModule) {
    diagnostics.push({
      severity: "error",
      code: "agent/missing-config",
      message: "A subagent requires an agent.ts that exports a description.",
    });
  }
}

function validateCollisions(
  tools: ToolEntry[],
  subagents: AgentManifest[],
  diagnostics: Diagnostic[],
): void {
  const toolNames = new Set(tools.map((t) => t.name));
  for (const sub of subagents) {
    if (toolNames.has(sub.name)) {
      diagnostics.push({
        severity: "error",
        code: "collision/tool-subagent",
        message: `Subagent "${sub.name}" collides with a tool of the same name.`,
      });
    }
  }
}

async function firstExisting(
  fs: ReadFs,
  root: string,
  names: string[],
): Promise<string | undefined> {
  for (const name of names) {
    const p = joinPath(root, name);
    if (await fs.exists(p)) return p;
  }
  return undefined;
}

export type { DirEntry };
