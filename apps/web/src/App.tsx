import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownCode } from "./MarkdownCode.tsx";
import { NAV, PAGES } from "./content.ts";
import { Playground } from "./playground/Playground.tsx";
import "./docs.css";
import "./hljs-theme.css";

const DEFAULT_DOC = "introduction";
const GITHUB_URL = "https://github.com/kucukkanat/ieva";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function App() {
  const route = useHashRoute();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  const isDocs = route.startsWith("/docs");
  const isPlayground = route === "/playground";

  return (
    <>
      <header className="topbar">
        <div className="logo">
          <a href="#/">
            <span className="brand">ieva</span>
          </a>
        </div>
        <nav>
          <a href={`#/docs/${DEFAULT_DOC}`} className={isDocs ? "active" : ""}>
            Docs
          </a>
          <a href="#/playground" className={isPlayground ? "active" : ""}>
            Playground
          </a>
          <a href={GITHUB_URL}>GitHub</a>
        </nav>
      </header>

      {isPlayground ? (
        <PlaygroundView />
      ) : isDocs ? (
        <DocView slug={route.replace(/^\/docs\/?/, "") || DEFAULT_DOC} />
      ) : (
        <Landing />
      )}
    </>
  );
}

function PlaygroundView() {
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "var(--space-5) var(--space-4)" }}>
      <div className="hero" style={{ padding: "var(--space-6) 0 var(--space-4)", textAlign: "left" }}>
        <h1 style={{ fontSize: "var(--font-size-xl)" }}>Playground</h1>
        <p className="tagline" style={{ margin: 0, maxWidth: 640 }}>
          Discover, compile, and run an agent entirely in your browser — with an offline mock
          model, a local WebGPU model, or your own Anthropic key.
        </p>
      </div>
      <Playground />
    </div>
  );
}

function Landing() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">Like Next.js for browser agents</div>
        <h1>Durable AI agents that run in a tab</h1>
        <p className="tagline">
          Filesystem-first agents, like eve — but they run entirely in the browser. OPFS,
          IndexedDB, in-browser compile, and your own key or a local WebGPU model.
        </p>
        <div className="cta">
          <a className="btn primary" href="#/playground">
            Try the playground
          </a>
          <a className="btn" href={`#/docs/${DEFAULT_DOC}`}>
            Read the docs
          </a>
        </div>
        <div className="install">npm install ieva @ieva/kit @ieva/fs @ieva/compiler</div>
      </section>

      <section className="features">
        <Feature title="One folder is an agent">
          Author tools, skills, and subagents as ordinary files. Identity comes from the
          path — a file at <code>tools/get_weather.ts</code> is the tool.
        </Feature>
        <Feature title="Compiles in the browser">
          esbuild-wasm transpiles your <code>.ts</code> in a tab. No build step, no server,
          no deploy. Pick a folder and it runs.
        </Feature>
        <Feature title="Durable by default">
          Every step is checkpointed to IndexedDB. A tab reload is a crash — sessions
          resume exactly where they stopped.
        </Feature>
        <Feature title="Local or BYOK models">
          Run a model on-device with WebGPU (no key, nothing leaves the tab), or bring your
          own cloud key — direct from the browser.
        </Feature>
        <Feature title="A real shell over OPFS">
          The sandbox is a pure-JS shell — <code>grep</code>, <code>sed</code>,{" "}
          <code>jq</code>, <code>find</code> — over the origin-private filesystem.
        </Feature>
        <Feature title="Shareable by link">
          An agent directory is data. Zip it, share a URL, and anyone can open and run it —
          something a server framework can't do.
        </Feature>
      </section>

      <footer className="footer">Apache-2.0 · a browser-native homage to eve.dev</footer>
    </>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="feature">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function DocView({ slug }: { slug: string }) {
  const page = PAGES[slug];
  const order = NAV.flatMap((s) => s.pages);
  const idx = order.indexOf(slug);
  const prev = idx > 0 ? order[idx - 1] : undefined;
  const next = idx < order.length - 1 ? order[idx + 1] : undefined;

  return (
    <div className="docs">
      <aside className="sidebar">
        {NAV.map((section) => (
          <div className="sec" key={section.title}>
            <div className="sec-title">{section.title}</div>
            {section.pages.map((p) => (
              <a key={p} href={`#/docs/${p}`} className={p === slug ? "active" : ""}>
                {PAGES[p]?.title ?? p}
              </a>
            ))}
          </div>
        ))}
      </aside>
      <main className="content">
        {page ? (
          <>
            <Markdown remarkPlugins={[remarkGfm]} components={{ code: MarkdownCode }}>
              {page.body}
            </Markdown>
            <div className="pager">
              <span>{prev && <a href={`#/docs/${prev}`}>← {PAGES[prev]?.title}</a>}</span>
              <span>{next && <a href={`#/docs/${next}`}>{PAGES[next]?.title} →</a>}</span>
            </div>
          </>
        ) : (
          <>
            <h1>Not found</h1>
            <p>
              That page doesn't exist. <a href={`#/docs/${DEFAULT_DOC}`}>Back to the docs.</a>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
