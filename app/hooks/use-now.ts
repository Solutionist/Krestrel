import { useEffect, useState } from "react";

/**
 * The current time, re-rendered once a second (e.g. so "retrying in N s" counts down). Null on
 * the server and during hydration, so the first client render matches the server HTML.
 */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
