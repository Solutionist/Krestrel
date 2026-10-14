import { useEffect, useState } from "react";

/** Re-renders once a second (e.g. so "retrying in N s" counts down). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
