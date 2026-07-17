/**
 * The web-llm inference worker. Running the engine off the main thread keeps the UI
 * responsive during weight loading and token generation. Vite bundles this via the
 * `new Worker(new URL(...), { type: "module" })` reference in local-model.ts.
 */
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
