import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);

function languageFor(path: string): string {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".json")) return "json";
  return "typescript";
}

/** A syntax-highlighted read-only view of one source file. */
export function CodeBlock({ path, code }: { path: string; code: string }) {
  const html = useMemo(() => {
    try {
      return hljs.highlight(code, { language: languageFor(path) }).value;
    } catch {
      return escapeHtml(code);
    }
  }, [path, code]);

  return (
    <pre className="code">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js output of trusted local source */}
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
