// Plain-language copy for market and connection state (ai/ui.md: active voice, say what's next).
import { EXCHANGE_TIME_ZONE } from "./candles";
import type { ConnectionStatus, MarketClock } from "./market";

interface ZoneFormats {
  time: Intl.DateTimeFormat;
  weekdayTime: Intl.DateTimeFormat;
  /** YYYY-MM-DD in the zone, to tell whether two instants fall on the same local day. */
  day: Intl.DateTimeFormat;
}

const formatters = new Map<string, ZoneFormats>();

function formattersFor(timeZone: string): ZoneFormats {
  let entry = formatters.get(timeZone);
  if (!entry) {
    const base = { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" } as const;
    entry = {
      time: new Intl.DateTimeFormat("en-US", base),
      weekdayTime: new Intl.DateTimeFormat("en-US", { ...base, weekday: "short" }),
      day: new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    };
    formatters.set(timeZone, entry);
  }
  return entry;
}

export interface MarketText {
  label: string;
  detail: string | null;
  isOpen: boolean;
  /** Tooltip naming the time zone the detail is in. */
  title: string;
}

/**
 * `timeZone` is the viewer's (null while unknown, e.g. during server render): phase changes
 * are shown in their local time with New York time in brackets, e.g. "opens Wed 20:30 (09:30 ET)".
 * A weekday is added whenever the change falls on another local day than `now`.
 */
export function describeMarket(
  clock: MarketClock | null,
  timeZone: string | null,
  now: number,
): MarketText {
  const local = timeZone && timeZone !== EXCHANGE_TIME_ZONE ? timeZone : null;
  const title = local
    ? `Exchange session. Times in your time zone (${local}); ET = New York time.`
    : "Exchange session (New York time)";
  if (!clock) return { label: "Market status unknown", detail: null, isOpen: false, title };

  const at = (ms: number | null, alwaysWeekday = false): string | null => {
    if (ms === null) return null;
    const et = formattersFor(EXCHANGE_TIME_ZONE);
    const zone = formattersFor(local ?? EXCHANGE_TIME_ZONE);
    const otherDay = alwaysWeekday || zone.day.format(ms) !== zone.day.format(now);
    const shown = (otherDay ? zone.weekdayTime : zone.time).format(ms);
    if (!local) return `${shown} ET`;
    const etOtherDay = et.day.format(ms) !== zone.day.format(ms);
    return `${shown} (${(etOtherDay ? et.weekdayTime : et.time).format(ms)} ET)`;
  };
  const phrase = (verb: string, text: string | null) => (text === null ? null : `${verb} ${text}`);

  switch (clock.phase) {
    case "open":
      return {
        label: "Market open",
        detail: phrase("closes", at(clock.phaseUntil ?? clock.nextClose)),
        isOpen: true,
        title,
      };
    case "pre":
      return {
        label: "Pre-market",
        detail: phrase("opens", at(clock.phaseUntil)),
        isOpen: false,
        title,
      };
    case "post":
      return {
        label: "After hours",
        detail: phrase("ends", at(clock.phaseUntil)),
        isOpen: false,
        title,
      };
    case "closed":
      return {
        label: "Market closed",
        detail: phrase("opens", at(clock.nextOpen, true)),
        isOpen: false,
        title,
      };
  }
}

export type ConnectionTone = "ok" | "busy" | "error";

export interface ConnectionText {
  label: string;
  tone: ConnectionTone;
  /** Longer explanation for a banner; null when everything is fine. */
  message: string | null;
}

/** Combines the browser↔server link with the server↔provider status into one indicator. */
export function describeConnection(
  link: "connecting" | "open" | "lost",
  status: ConnectionStatus,
  now: number,
): ConnectionText {
  if (link === "lost") {
    return {
      label: "Offline",
      tone: "error",
      message:
        "Lost the connection to the Krestrel server. Reconnecting automatically — check that it's still running.",
    };
  }
  const retry =
    status.retryAt === null
      ? ""
      : ` Retrying in ${Math.max(1, Math.round((status.retryAt - now) / 1000))} s.`;
  switch (status.state) {
    case "live":
      return { label: "Live", tone: "ok", message: status.code === null ? null : status.reason };
    case "idle":
    case "connecting":
      return { label: "Connecting", tone: "busy", message: null };
    case "reconnecting":
      return {
        label: "Reconnecting",
        tone: "busy",
        message: `${status.reason ?? "Lost the market data connection."}${retry}`.trim(),
      };
    case "error":
      return {
        label: "Data error",
        tone: "error",
        message: `${status.reason ?? "The market data connection failed."}${retry}`.trim(),
      };
    case "stopped":
      return {
        label: "Stopped",
        tone: "error",
        message: status.reason ?? "Market data is stopped. Restart the server.",
      };
  }
}
