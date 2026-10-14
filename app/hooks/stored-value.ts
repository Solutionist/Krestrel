import { useSyncExternalStore } from "react";

export interface StoredValue<T> {
  /** Current value and setter; server render and hydration use the fallback. */
  use(): [T, (value: T) => void];
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

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  };

  const read = (): T => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      // Storage disabled: fall back.
    }
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedValue = raw === null ? fallback : (parse(raw) ?? fallback);
    }
    return cachedValue;
  };

  const write = (value: T) => {
    try {
      localStorage.setItem(key, serialize(value));
    } catch {
      // Storage full or disabled: the value lasts until reload.
      cachedRaw = serialize(value);
      cachedValue = value;
    }
    for (const listener of listeners) listener();
  };

  return {
    use: () => [useSyncExternalStore(subscribe, read, () => fallback), write],
  };
}
