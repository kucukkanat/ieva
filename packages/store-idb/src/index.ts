import type { CheckpointStore, SessionMeta, SessionSnapshot } from "ieva/runtime";

const DB_NAME = "ieva";
const STORE = "sessions";
const DB_VERSION = 1;

/**
 * IndexedDB-backed checkpoint store. Each committed step overwrites the session's
 * snapshot record — step results are the atomic persistence boundary, so a single
 * `put` per commit is exactly right. Surviving a tab reload is the browser analogue of
 * eve surviving a server crash.
 */
export class IdbStore implements CheckpointStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(dbName = DB_NAME): Promise<IdbStore> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "sessionId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new IdbStore(db);
  }

  async loadSession(sessionId: string): Promise<SessionSnapshot | undefined> {
    const record = await this.request<SessionSnapshot | undefined>("readonly", (store) =>
      store.get(sessionId),
    );
    return record ?? undefined;
  }

  async commitStep(_sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    await this.request("readwrite", (store) => store.put(snapshot));
  }

  async listSessions(): Promise<SessionMeta[]> {
    const all = await this.request<SessionSnapshot[]>("readonly", (store) => store.getAll());
    return all
      .map((s) => ({
        sessionId: s.sessionId,
        agentName: s.agentName,
        turn: s.turn,
        status: s.status,
        updatedAt: s.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request("readwrite", (store) => store.delete(sessionId));
  }

  private request<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }
}
