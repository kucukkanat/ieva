import { useCallback, useEffect, useRef, useState } from "react";
import type { Client } from "ieva/client";
import type { AgentEvent } from "ieva/runtime";

export interface UseIevaAgent {
  /** Ordered live event log for the session. */
  readonly events: AgentEvent[];
  /** The latest assistant message text, updated as it streams. */
  readonly message: string;
  /** True while a turn is in flight. */
  readonly running: boolean;
  readonly error: Error | undefined;
  /** Send a user message; resolves with the final assistant text. */
  send: (text: string) => Promise<string>;
}

/**
 * Drive an ieva Client from React. Subscribes to the client's event stream, exposes the
 * running assistant text and turn status, and gives back a `send` callback. The client
 * is created out-of-band (via `bootstrapAgent`) so the hook stays transport-agnostic —
 * the same hook works whether the client talks to an in-page harness or a Worker port.
 */
export function useIevaAgent(client: Client | undefined): UseIevaAgent {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    if (!client) return;
    setEvents(client.replay());
    return client.on((event) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === "message.appended") {
        setMessage(String(event.data.cumulative ?? ""));
      }
    });
  }, [client]);

  const send = useCallback(async (text: string): Promise<string> => {
    const active = clientRef.current;
    if (!active) throw new Error("No agent client is ready yet.");
    setRunning(true);
    setError(undefined);
    setMessage("");
    try {
      return await active.send(text);
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(String(caught));
      setError(err);
      throw err;
    } finally {
      setRunning(false);
    }
  }, []);

  return { events, message, running, error, send };
}

export type { AgentEvent } from "ieva/runtime";
export type { Client } from "ieva/client";
