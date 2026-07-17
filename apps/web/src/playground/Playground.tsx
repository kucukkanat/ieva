import { useCallback, useEffect, useRef, useState } from "react";
import * as esbuildNs from "esbuild-wasm";
import esbuildWasmURL from "esbuild-wasm/esbuild.wasm?url";
import { OpfsFileSystem } from "@ieva/fs";
import { DEFAULT_IEVA_EXPORTS, EsbuildLoader } from "@ieva/compiler/esbuild";
import { IdbStore } from "@ieva/store-idb";
import { createModelRegistry } from "@ieva/model";
import { bootstrapAgent, BootstrapError, type Client } from "@ieva/kit";
import { useIevaAgent } from "@ieva/react";
import type { AgentManifest, ModelRegistry } from "ieva/runtime";
import { IEVA_RUNTIME_GLOBAL } from "./runtime-global.ts";
import { createMockModel } from "./mock-model.ts";
import { EXAMPLES, type Example } from "./examples.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { LocalModelManager, listLocalModels, type ModelChoice } from "./local-model.ts";
import "./app.css";

const esbuild = (
  typeof (esbuildNs as { initialize?: unknown }).initialize === "function"
    ? esbuildNs
    : (esbuildNs as unknown as { default: typeof esbuildNs }).default
);

type Provider = "mock" | "local" | "anthropic";

function makeRegistry(
  provider: Provider,
  apiKey: string,
  local: LocalModelManager,
): ModelRegistry {
  const mock = createMockModel();
  const cloud = createModelRegistry({ apiKeys: apiKey ? { anthropic: apiKey } : {} });
  return {
    resolve: async (reference) => {
      if (provider === "local") return local.asAgentModel();
      if (provider === "mock" || reference.startsWith("mock/")) return mock;
      return cloud.resolve(reference);
    },
  };
}

export function Playground() {
  const [status, setStatus] = useState("Pick an example and load it to begin.");
  const [statusError, setStatusError] = useState(false);
  const [client, setClient] = useState<Client>();
  const [manifest, setManifest] = useState<AgentManifest>();
  const [example, setExample] = useState<Example>(EXAMPLES[0] as Example);
  const [provider, setProvider] = useState<Provider>("mock");
  const [apiKey, setApiKey] = useState("");
  const [booting, setBooting] = useState(false);
  const [turns, setTurns] = useState<Array<{ role: "user" | "agent"; text: string }>>([]);
  const [composer, setComposer] = useState((EXAMPLES[0] as Example).prompt);
  const [showSource, setShowSource] = useState(false);
  const [localLoaded, setLocalLoaded] = useState(false);

  const vfsRef = useRef<OpfsFileSystem | undefined>(undefined);
  const loaderRef = useRef<EsbuildLoader | undefined>(undefined);
  const storeRef = useRef<IdbStore | undefined>(undefined);
  const localRef = useRef<LocalModelManager>(new LocalModelManager());

  const { events, message, running, send } = useIevaAgent(client);

  const load = useCallback(
    async (target: Example) => {
      setBooting(true);
      setStatusError(false);
      setClient(undefined);
      setManifest(undefined);
      setTurns([]);
      try {
        setStatus(`Writing "${target.name}" into OPFS…`);
        const vfs = vfsRef.current ?? (await OpfsFileSystem.mount("ieva-demo"));
        vfsRef.current = vfs;
        for (const [path, content] of Object.entries(target.files)) {
          await vfs.writeFile(path, content);
        }

        setStatus("Compiling in the browser (esbuild-wasm)…");
        loaderRef.current ??= await EsbuildLoader.create(esbuild, {
          fs: vfs.asReadFs(),
          wasmURL: esbuildWasmURL,
          runtimeGlobal: { globalVar: IEVA_RUNTIME_GLOBAL, exports: DEFAULT_IEVA_EXPORTS },
        });
        storeRef.current ??= await IdbStore.open("ieva-demo");

        const { client: c, manifest: m } = await bootstrapAgent({
          fs: vfs.asReadFs(),
          root: `${target.root}/agent`,
          loader: loaderRef.current,
          registry: makeRegistry(provider, apiKey, localRef.current),
          store: storeRef.current,
        });
        setClient(c);
        setManifest(m);
        setComposer(target.prompt);
        setStatus(`Ready — "${m.name}" compiled and running in your browser.`);
      } catch (error) {
        setStatusError(true);
        if (error instanceof BootstrapError) {
          setStatus(`Bootstrap failed: ${error.diagnostics.map((d) => d.message).join("; ")}`);
        } else {
          setStatus(`Bootstrap failed: ${String(error)}`);
        }
      } finally {
        setBooting(false);
      }
    },
    [provider, apiKey],
  );

  const onSend = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setTurns((prev) => [...prev, { role: "user", text }]);
      try {
        const reply = await send(text);
        setTurns((prev) => [...prev, { role: "agent", text: reply }]);
      } catch (error) {
        setTurns((prev) => [...prev, { role: "agent", text: `Error: ${String(error)}` }]);
      }
    },
    [send],
  );

  const localReady = provider !== "local" || localLoaded;

  return (
    <div className="app">
      <section className="panel">
        <div className="controls">
          <label>
            Example:{" "}
            <select
              value={example.id}
              onChange={(e) => {
                const next = EXAMPLES.find((x) => x.id === e.target.value) as Example;
                setExample(next);
                setComposer(next.prompt);
              }}
              disabled={booting}
            >
              {EXAMPLES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => load(example)} disabled={booting}>
            {booting ? "Loading…" : client ? "Reload" : "Load example"}
          </button>
          <label>
            Model:{" "}
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              disabled={booting}
            >
              <option value="mock">Mock (offline)</option>
              <option value="local">Local (WebGPU)</option>
              <option value="anthropic">Anthropic (BYOK)</option>
            </select>
          </label>
          {provider === "anthropic" && (
            <input
              type="password"
              placeholder="sk-ant-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={booting}
              style={{ width: 200 }}
            />
          )}
          <button onClick={() => setShowSource((s) => !s)}>
            {showSource ? "Hide source" : "View source"}
          </button>
        </div>
        <p className="example-desc">{example.description}</p>
        <p className={`status${statusError ? " error" : ""}`} data-testid="status">
          {status}
        </p>
      </section>

      {provider === "local" && (
        <LocalModelPanel manager={localRef.current} onLoadedChange={setLocalLoaded} />
      )}

      {showSource && (
        <section className="panel">
          <p className="section-title">Source · {example.name}</p>
          {Object.entries(example.files).map(([path, content]) => (
            <div className="source-file" key={path}>
              <div className="source-path">{path.replace(`${example.root}/`, "")}</div>
              <CodeBlock path={path} code={content} />
            </div>
          ))}
        </section>
      )}

      {manifest && (
        <div className="grid">
          <aside className="panel">
            <p className="section-title">Discovered</p>
            <div>
              <strong>Tools</strong>
              <div>
                {manifest.tools.map((t) => (
                  <span className="pill" key={t.name}>
                    {t.name}
                  </span>
                ))}
                {manifest.tools.length === 0 && <span className="muted">none</span>}
              </div>
            </div>
            <div style={{ marginTop: "var(--space-3)" }}>
              <strong>Skills</strong>
              <div>
                {manifest.skills.map((s) => (
                  <span className="pill" key={s.name}>
                    {s.name}
                  </span>
                ))}
                {manifest.skills.length === 0 && <span className="muted">none</span>}
              </div>
            </div>
          </aside>

          <section className="panel chat">
            <div className="messages" data-testid="messages">
              {turns.map((t, i) => (
                <div className={`msg ${t.role}`} key={i}>
                  {t.text}
                </div>
              ))}
              {running && message && <div className="msg agent">{message}</div>}
            </div>
            {!localReady && (
              <p className="muted">Load a local model below before sending.</p>
            )}
            <Composer
              value={composer}
              onChange={setComposer}
              disabled={!client || running || !localReady}
              onSend={onSend}
            />
          </section>
        </div>
      )}

      {events.length > 0 && (
        <section className="panel">
          <p className="section-title">Event stream</p>
          <div className="events" data-testid="events">
            {events.map((e, i) => (
              <div key={i}>
                <span className="ev-type">{e.type}</span> · step {e.stepIndex} · seq {e.sequence}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LocalModelPanel({
  manager,
  onLoadedChange,
}: {
  manager: LocalModelManager;
  onLoadedChange: (loaded: boolean) => void;
}) {
  const models = listLocalModels();
  const [selected, setSelected] = useState<string>((models[0] as ModelChoice).id);
  const [progress, setProgress] = useState<{ progress: number; text: string } | undefined>();
  const [loadedId, setLoadedId] = useState(manager.currentModelId);
  const [cached, setCached] = useState<boolean | undefined>();
  const [busy, setBusy] = useState(false);
  const supported = LocalModelManager.webgpuAvailable();

  // Keep the parent's send-gate in sync with whether a model is loaded.
  useEffect(() => {
    onLoadedChange(!!loadedId);
  }, [loadedId, onLoadedChange]);

  useEffect(() => {
    let alive = true;
    manager.isCached(selected).then((c) => alive && setCached(c));
    return () => {
      alive = false;
    };
  }, [selected, manager]);

  const onLoad = useCallback(async () => {
    setBusy(true);
    setProgress({ progress: 0, text: "Starting…" });
    try {
      await manager.load(selected, (p) => setProgress(p));
      setLoadedId(manager.currentModelId);
      setCached(true);
      setProgress(undefined);
    } catch (error) {
      setProgress({ progress: 0, text: `Failed: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }, [manager, selected]);

  const onUnload = useCallback(async () => {
    setBusy(true);
    await manager.unload();
    setLoadedId(undefined);
    setBusy(false);
  }, [manager]);

  const onDeleteCache = useCallback(async () => {
    setBusy(true);
    await manager.deleteCache(selected);
    setCached(false);
    setBusy(false);
  }, [manager, selected]);

  return (
    <section className="panel">
      <p className="section-title">Local model (WebGPU)</p>
      {!supported ? (
        <p className="status error">
          WebGPU isn't available in this browser. Local models need a WebGPU-capable browser
          (recent Chrome/Edge, or Safari 26+). The Mock and Anthropic providers still work.
        </p>
      ) : (
        <>
          <div className="controls">
            <label>
              Model:{" "}
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={busy}
                style={{ maxWidth: 320 }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} {m.sizeMB ? `· ~${Math.round(m.sizeMB)} MB` : ""}
                  </option>
                ))}
              </select>
            </label>
            {cached !== undefined && (
              <span className="pill">{cached ? "cached" : "not cached"}</span>
            )}
            <button className="primary" onClick={onLoad} disabled={busy}>
              {loadedId === selected ? "Reload" : "Load model"}
            </button>
            {loadedId && (
              <button onClick={onUnload} disabled={busy}>
                Unload
              </button>
            )}
            {cached && (
              <button onClick={onDeleteCache} disabled={busy}>
                Delete cache
              </button>
            )}
          </div>
          {progress && (
            <div className="progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.round(progress.progress * 100)}%` }}
                />
              </div>
              <p className="muted">{progress.text}</p>
            </div>
          )}
          {loadedId && !progress && (
            <p className="status" data-testid="local-status">
              Loaded: <code>{loadedId}</code> — runs fully on your GPU, nothing leaves the tab.
            </p>
          )}
          <p className="muted">
            Runs on <strong>transformers.js</strong> (ONNX Runtime Web + WebGPU). Weights
            download once and are cached for next time; first load of a tiny model can take a
            while. Tool-calling works best on a capable model like <strong>Gemma 4 E2B</strong>;
            the tiniest models (Gemma 3 270M, Qwen3 0.6B) tend to answer directly instead of
            calling a tool.
          </p>
        </>
      )}
    </section>
  );
}

function Composer({
  value,
  onChange,
  disabled,
  onSend,
}: {
  value: string;
  onChange: (t: string) => void;
  disabled: boolean;
  onSend: (t: string) => void;
}) {
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(value);
        onChange("");
      }}
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ask the agent…"
        data-testid="composer-input"
        disabled={disabled}
      />
      <button className="primary" type="submit" disabled={disabled}>
        Send
      </button>
    </form>
  );
}
