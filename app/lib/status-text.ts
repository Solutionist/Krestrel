// Plain-language copy for market and connection state (ai/ui.md: active voice, say what's next).
import { EXCHANGE_TIME_ZONE, formatExchangeTime } from "./candles";
import type { ConnectionStatus, MarketClock } from "./market";

const weekdayTime = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface MarketText {
  label: string;
  detail: string | null;
  isOpen: boolean;
}

export function describeMarket(clock: MarketClock | null): MarketText {
  if (!clock) return { label: "Market status unknown", detail: null, isOpen: false };
  const at = (ms: number | null) => (ms === null ? null : `${formatExchangeTime(ms)} ET`);
  switch (clock.phase) {
    case "open":
      return {
        label: "Market open",
        detail:
          at(clock.phaseUntil ?? clock.nextClose) &&
          `closes ${at(clock.phaseUntil ?? clock.nextClose)}`,
        isOpen: true,
      };
    case "pre":
      return {
        label: "Pre-market",
        detail: at(clock.phaseUntil) && `opens ${at(clock.phaseUntil)}`,
        isOpen: false,
      };
    case "post":
      return {
        label: "After hours",
        detail: at(clock.phaseUntil) && `ends ${at(clock.phaseUntil)}`,
        isOpen: false,
      };
    case "closed":
      return {
        label: "Market closed",
        detail: clock.nextOpen === null ? null : `opens ${weekdayTime.format(clock.nextOpen)} ET`,
        isOpen: false,
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
