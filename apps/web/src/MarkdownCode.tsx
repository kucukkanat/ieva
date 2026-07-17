import type { ComponentPropsWithoutRef } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("bash", bash);

const ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "typescript",
  jsx: "typescript",
  md: "markdown",
  sh: "bash",
  shell: "bash",
};

/**
 * A react-markdown `code` renderer. Inline code passes through; fenced blocks with a
 * known language get highlight.js markup. Uses the same highlighter (and theme) as the
 * playground's source viewer, so code reads identically across both apps.
 */
export function MarkdownCode({ className, children, ...rest }: ComponentPropsWithoutRef<"code">) {
  const match = /language-(\w+)/.exec(className ?? "");
  const raw = String(children ?? "").replace(/\n$/, "");

  if (!match) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  const lang = ALIASES[match[1] as string] ?? (match[1] as string);
  let html: string;
  try {
    html = hljs.getLanguage(lang)
      ? hljs.highlight(raw, { language: lang }).value
      : escapeHtml(raw);
  } catch {
    html = escapeHtml(raw);
  }
  // biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js output of trusted local docs content
  return <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
