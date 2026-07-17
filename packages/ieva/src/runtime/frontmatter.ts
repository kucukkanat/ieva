/**
 * A deliberately tiny frontmatter reader. We only need flat `key: value` pairs
 * (skills use `description`, schedules use `cron`), so we do not pull in a YAML
 * dependency. Values may be quoted; everything else is treated as a raw string.
 */
export interface Frontmatter {
  readonly data: Record<string, string>;
  readonly body: string;
}

export function parseFrontmatter(source: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source };

  const data: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    data[key] = stripQuotes(value);
  }
  return { data, body: source.slice(match[0].length) };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * The skill description fallback chain, ported from eve verbatim:
 * frontmatter `description` → first non-empty, non-code-fence body line with a
 * leading `#`/`>`/`*`/`-` marker stripped → the weak literal default.
 */
export function deriveSkillDescription(
  name: string,
  frontmatterDescription: string | undefined,
  body: string,
): string {
  if (frontmatterDescription) return frontmatterDescription;

  let inFence = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === "") continue;
    return line.replace(/^[#>*-]+\s*/, "");
  }
  return `Instructions for the ${name} skill.`;
}
