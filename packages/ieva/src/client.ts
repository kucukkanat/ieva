import { Harness, type HarnessDeps } from "./runtime/harness.ts";
import type { AgentEvent } from "./runtime/events.ts";
import type { LoadedAgent } from "./runtime/loaded.ts";

/**
 * The consumer-facing handle to a running agent. Wraps a Harness with a session id and
 * exposes send + live event subscription. In the browser this is what sits behind the
 * Worker message port; `@ieva/react` wraps it again as a hook.
 */
export class Client {
  private constructor(
    private readonly harness: Harness,
    readonly sessionId: string,
  ) {}

  static async create(
    agent: LoadedAgent,
    deps: HarnessDeps,
    options: { sessionId?: string; resume?: boolean } = {},
  ): Promise<Client> {
    const sessionId = options.sessionId ?? crypto.randomUUID();
    if (options.resume) {
      const resumed = await Harness.resume(agent, deps, sessionId);
      if (resumed) return new Client(resumed, sessionId);
    }
    return new Client(new Harness(agent, deps, sessionId), sessionId);
  }

  send(message: string, signal?: AbortSignal): Promise<string> {
    return this.harness.send(message, signal);
  }

  /** Subscribe to live events. Returns an unsubscribe function. */
  on(listener: (event: AgentEvent) => void): () => void {
    return this.harness.stream.subscribe(listener);
  }

  /** Replay retained events; negative index is tail-relative (`-1` = last event). */
  replay(startIndex = 0): AgentEvent[] {
    return this.harness.stream.replay(startIndex);
  }
}
