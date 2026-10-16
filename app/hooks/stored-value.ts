import { useSyncExternalStore } from "react";

export interface StoredValue<T> {
  /** Current value and setter; server render and hydration use the fallback. */
  use(): [T, (value: T) => void];
  /** Current value outside React; the fallback on the server. */
  get(): T;
  /** Same as the setter from `use()`. */
  set(value: T): void;
}

/**
 * One app-wide setting in localStorage, shared live by every component that reads it (and by
 * other tabs, via the `storage` event). Invalid or missing saved values read as `fallback`.
 */
export function createStoredValue<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | null,
  serialize: (value: T) => string,
): StoredValue<T> {
  const listeners = new Set<() => void>();
  // getSnapshot must return the same reference until the stored text changes.
  let cachedRaw: string | null = null;
  let cachedValue = fallback;
  // Text of the last write that storage refused; it wins over storage until reload.
  let memoryRaw: string | undefined;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  };

  const read = (): T => {
    if (typeof window === "undefined") return fallback;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      // Storage disabled: fall back.
    }
    if (memoryRaw !== undefined) raw = memoryRaw;
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedValue = raw === null ? fallback : (parse(raw) ?? fallback);
    }
    return cachedValue;
  };

  const write = (value: T) => {
    const text = serialize(value);
    try {
      localStorage.setItem(key, text);
      memoryRaw = undefined;
    } catch {
      // Storage full or disabled: this setting lasts until reload.
      memoryRaw = text;
    }
    for (const listener of listeners) listener();
  };

  return {
    use: () => [useSyncExternalStore(subscribe, read, () => fallback), write],
    get: read,
    set: write,
  };
}
