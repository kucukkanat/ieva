/**
 * Session-scoped durable state. Declared at module scope in tools/hooks; the value
 * survives step boundaries, tab reloads, and hot reloads. Subagents get fresh state.
 *
 *   const budget = defineState("my-agent.budget", () => ({ count: 0, cap: 25 }));
 *   budget.update((s) => ({ ...s, count: s.count + 1 }));
 *
 * `get`/`update` only work inside a framework-managed context (a running tool or hook).
 */
export interface StateHandle<T> {
  readonly name: string;
  get(): T;
  update(fn: (prev: T) => T): T;
}

/**
 * The active state bag, installed by the harness for the duration of authored code.
 * A single worker realm runs one turn at a time, so a module-level register is safe
 * and avoids threading context through every call.
 */
export interface StateBag {
  read(name: string): unknown;
  write(name: string, value: unknown): void;
  has(name: string): boolean;
}

let active: StateBag | undefined;

export function __enterStateContext(bag: StateBag): () => void {
  const previous = active;
  active = bag;
  return () => {
    active = previous;
  };
}

const initializers = new Map<string, () => unknown>();

export function __stateInitializers(): ReadonlyMap<string, () => unknown> {
  return initializers;
}

export function defineState<T>(name: string, initial: () => T): StateHandle<T> {
  if (initializers.has(name)) {
    // Re-registration on hot reload is fine; keep the latest initializer.
    initializers.set(name, initial as () => unknown);
  } else {
    initializers.set(name, initial as () => unknown);
  }
  return {
    name,
    get(): T {
      const bag = requireBag(name);
      if (!bag.has(name)) {
        const seed = initial();
        bag.write(name, seed);
        return seed;
      }
      return bag.read(name) as T;
    },
    update(fn: (prev: T) => T): T {
      const bag = requireBag(name);
      const prev = bag.has(name) ? (bag.read(name) as T) : initial();
      const next = fn(prev);
      bag.write(name, next);
      return next;
    },
  };
}

function requireBag(name: string): StateBag {
  if (!active) {
    throw new Error(
      `defineState("${name}") accessed outside a framework-managed context. ` +
        "Call get()/update() from inside a tool or hook, not at module top level.",
    );
  }
  return active;
}
