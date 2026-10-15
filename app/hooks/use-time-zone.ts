import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The viewer's IANA time zone (e.g. "Asia/Bangkok"); null during server render and hydration,
 * so server and client markup match, then the browser's zone on the next render.
 */
export function useTimeZone(): string | null {
  return useSyncExternalStore(subscribe, browserTimeZone, () => null);
}
