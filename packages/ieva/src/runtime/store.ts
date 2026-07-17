/**
 * The durable checkpoint store. Step results are the atomic persistence boundary —
 * there is no separate write path. A tab reload is our "crash": the session rehydrates
 * from the last committed step and an interrupted step re-runs (hence: make
 * non-idempotent tool side effects idempotent or gate them behind approval).
 */
export interface CheckpointStore {
  loadSession(sessionId: string): Promise<SessionSnapshot | undefined>;
  /** Commit a step atomically. This IS the persistence boundary. */
  commitStep(sessionId: string, snapshot: SessionSnapshot): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  deleteSession(sessionId: string): Promise<void>;
}

export const SNAPSHOT_VERSION = 1;

/**
 * The redeploy-safety invariant, stolen from eve: the snapshot NEVER contains the
 * model reference, tool set, or compaction config. Those are rebuilt from the current
 * manifest every turn. In the browser this is also what makes hot reload safe mid-
 * session — swapping a tool can't corrupt an in-flight conversation.
 */
export interface SessionSnapshot {
  readonly version: typeof SNAPSHOT_VERSION;
  readonly sessionId: string;
  readonly agentName: string;
  readonly turn: number;
  readonly stepIndex: number;
  readonly messages: StoredMessage[];
  /** defineState bags, keyed by state name. */
  readonly state: Record<string, unknown>;
  readonly status: "waiting" | "running" | "completed" | "failed";
  readonly updatedAt: number;
}

export interface StoredMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: unknown;
}

export interface SessionMeta {
  readonly sessionId: string;
  readonly agentName: string;
  readonly turn: number;
  readonly status: SessionSnapshot["status"];
  readonly updatedAt: number;
}

/** In-memory store for tests and ephemeral sessions. */
export class MemStore implements CheckpointStore {
  private readonly sessions = new Map<string, SessionSnapshot>();

  async loadSession(sessionId: string): Promise<SessionSnapshot | undefined> {
    return this.sessions.get(sessionId);
  }

  async commitStep(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    this.sessions.set(sessionId, snapshot);
  }

  async listSessions(): Promise<SessionMeta[]> {
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      agentName: s.agentName,
      turn: s.turn,
      status: s.status,
      updatedAt: s.updatedAt,
    }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
