/**
 * The NDJSON-style event protocol, ported from eve. Every event is stamped with the
 * turn it belongs to, a monotonic sequence, and the step index — which is what makes
 * tail-relative stream resume (`startIndex=-1`) cheap.
 */
export type EventType =
  | "session.started"
  | "turn.started"
  | "message.received"
  | "step.started"
  | "actions.requested"
  | "action.result"
  | "input.requested"
  | "subagent.called"
  | "subagent.completed"
  | "reasoning.appended"
  | "message.appended"
  | "message.completed"
  | "result.completed"
  | "compaction.requested"
  | "compaction.completed"
  | "step.completed"
  | "step.failed"
  | "turn.completed"
  | "turn.failed"
  | "turn.cancelled"
  | "session.waiting"
  | "session.failed"
  | "session.completed";

export interface AgentEvent {
  readonly type: EventType;
  readonly turnId: string;
  readonly sequence: number;
  readonly stepIndex: number;
  readonly data: Record<string, unknown>;
}

/** Delta-carrying events include both the incremental and cumulative text. */
export interface AppendEventData {
  readonly delta: string;
  readonly cumulative: string;
}

export type EventListener = (event: AgentEvent) => void;

/**
 * Sequences events, retains them for replay, and fans out to live listeners.
 * Retention is what backs both reconnect and the time-travel inspector.
 */
export class EventStream {
  private readonly buffer: AgentEvent[] = [];
  private readonly listeners = new Set<EventListener>();
  private sequence = 0;

  emit(
    type: EventType,
    turnId: string,
    stepIndex: number,
    data: Record<string, unknown> = {},
  ): AgentEvent {
    const event: AgentEvent = { type, turnId, sequence: this.sequence++, stepIndex, data };
    this.buffer.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  /** Replay from an absolute index, or tail-relative when negative (`-1` = last). */
  replay(startIndex = 0): AgentEvent[] {
    const from = startIndex < 0 ? Math.max(0, this.buffer.length + startIndex) : startIndex;
    return this.buffer.slice(from);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get length(): number {
    return this.buffer.length;
  }
}
