import { useCallback, useEffect, useState } from "react";

/**
 * A set of toggles remembered in localStorage. Starts empty on the server and first render (no
 * hydration mismatch), then restores the saved selection, keeping only known values.
 */
export function usePersistedSet<T extends string>(
  storageKey: string,
  allowed: readonly T[],
): [ReadonlySet<T>, (value: T) => void, (values: Iterable<T>) => void] {
  const [values, setValues] = useState<ReadonlySet<T>>(new Set());

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(saved))
        setValues(new Set(allowed.filter((value) => saved.includes(value))));
    } catch {
      // Corrupt or unavailable storage: start with none.
    }
  }, [storageKey, allowed]);

  const save = useCallback(
    (next: ReadonlySet<T>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Storage full or disabled: keep the in-memory selection.
      }
      return next;
    },
    [storageKey],
  );

  const toggle = useCallback(
    (value: T) =>
      setValues((current) => {
        const next = new Set(current);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return save(next);
      }),
    [save],
  );

  const add = useCallback(
    (added: Iterable<T>) => setValues((current) => save(new Set([...current, ...added]))),
    [save],
  );

  return [values, toggle, add];
}
