// Candle maths shared by server and browser. Intraday buckets MUST match the SQL `date_bin` in
// app/.server/market/db/queries/bars.ts; calendar buckets (1D…1Y) are computed only here, on both sides.
import {
  type Bar,
  type CalendarTimeframe,
  type Candle,
  type IntradayTimeframe,
  isCalendarTimeframe,
  type Tick,
  type Timeframe,
} from "./market";

export const EXCHANGE_TIME_ZONE = "America/New_York";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEEK = 7 * DAY;
export const INTRADAY_STEP_MS: Record<IntradayTimeframe, number> = {
  "1m": MINUTE,
  "5m": 5 * MINUTE,
  "15m": 15 * MINUTE,
  "30m": 30 * MINUTE,
  "1h": 60 * MINUTE,
  "4h": 240 * MINUTE,
};
/** A Monday; 2-week buckets start on weeks an even number of weeks from it. */
const TWO_WEEK_ORIGIN = Date.UTC(2000, 0, 3);

const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Offset (ms) of New York wall-clock time from UTC at `ms`. EDT → −4 h, EST → −5 h. */
function nyOffsetMs(ms: number): number {
  const parts: Record<string, number> = {};
  for (const part of nyParts.formatToParts(ms)) parts[part.type] = Number(part.value);
  const wallAsUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

/** The New York calendar date containing `ms`, as UTC-midnight epoch ms (a pure date value). */
function nyDate(ms: number): number {
  const local = new Date(ms + nyOffsetMs(ms));
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

/** Epoch ms of New York midnight on `date` (UTC-midnight epoch ms of the calendar date). */
function nyMidnightOf(date: number): number {
  // Offset in force at midnight itself (differs from mid-day on DST-change days).
  const guess = date - nyOffsetMs(date);
  return date - nyOffsetMs(guess);
}

/** First calendar date of the period containing `date` (both UTC-midnight epoch ms). */
function periodStartDate(date: number, timeframe: CalendarTimeframe): number {
  const d = new Date(date);
  switch (timeframe) {
    case "1D":
      return date;
    case "1W":
      // Weeks start on Monday, like TradingView's US-equity weekly bars.
      return date - ((d.getUTCDay() + 6) % 7) * DAY;
    case "2W": {
      const monday = date - ((d.getUTCDay() + 6) % 7) * DAY;
      const weeks = Math.round((monday - TWO_WEEK_ORIGIN) / WEEK);
      return weeks % 2 === 0 ? monday : monday - WEEK;
    }
    case "1M":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    case "1Y":
      return Date.UTC(d.getUTCFullYear(), 0, 1);
  }
}

/**
 * Start of the bucket containing `ms`, in epoch seconds (the chart's `time`).
 * Intraday: UTC-aligned like `date_bin(…, '2000-01-03 00:00:00+00')`.
 * 1D…1Y: New York midnight on the first day of the day/week (Mon)/fortnight/month/year.
 */
export function bucketStart(ms: number, timeframe: Timeframe): number {
  const start = isCalendarTimeframe(timeframe)
    ? nyMidnightOf(periodStartDate(nyDate(ms), timeframe))
    : Math.floor(ms / INTRADAY_STEP_MS[timeframe]) * INTRADAY_STEP_MS[timeframe];
  return start / 1000;
}

/** Bucket start (epoch seconds) for a New York trading date `YYYY-MM-DD`. */
export function dayBucketStart(day: string, timeframe: CalendarTimeframe): number {
  return nyMidnightOf(periodStartDate(Date.parse(`${day}T00:00:00Z`), timeframe)) / 1000;
}

/** New York trading date (`YYYY-MM-DD`) containing `ms`. */
export function nyDay(ms: number): string {
  return new Date(nyDate(ms)).toISOString().slice(0, 10);
}

export interface DayCandle {
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Rolls daily candles (ascending by day) up into 1D/1W/2W/1M/1Y candles. */
export function aggregateDays(days: readonly DayCandle[], timeframe: CalendarTimeframe): Candle[] {
  const candles: Candle[] = [];
  for (const day of days) {
    const time = dayBucketStart(day.day, timeframe);
    const last = candles.at(-1);
    if (last && last.time === time) {
      last.high = Math.max(last.high, day.high);
      last.low = Math.min(last.low, day.low);
      last.close = day.close;
      last.volume += day.volume;
    } else {
      candles.push({
        time,
        open: day.open,
        high: day.high,
        low: day.low,
        close: day.close,
        volume: day.volume,
      });
    }
  }
  return candles;
}

/**
 * Folds a live trade into the latest candle. Returns the candle to pass to `series.update`,
 * or `null` for a trade older than the latest candle (the chart cannot rewrite history).
 */
export function mergeTick(latest: Candle | null, tick: Tick, timeframe: Timeframe): Candle | null {
  const time = bucketStart(tick.ts, timeframe);
  if (latest && time < latest.time) return null;
  if (!latest || time > latest.time) {
    return {
      time,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: tick.size,
    };
  }
  return {
    time,
    open: latest.open,
    high: Math.max(latest.high, tick.price),
    low: Math.min(latest.low, tick.price),
    close: tick.price,
    volume: latest.volume + tick.size,
  };
}

/**
 * Applies a completed (or corrected) 1-minute bar. On the 1m timeframe the stream's bar is
 * authoritative for its minute; on larger timeframes ticks already moved the candle, so only a
 * bar that opens a new bucket is used.
 */
export function mergeBar(latest: Candle | null, bar: Bar, timeframe: Timeframe): Candle | null {
  const time = bucketStart(bar.ts, timeframe);
  if (latest && time < latest.time) return null;
  if (timeframe === "1m" || !latest || time > latest.time) {
    return {
      time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    };
  }
  return null;
}

const timeLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  month: "short",
  day: "numeric",
});
const fullLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const monthLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  month: "short",
});
const yearLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  year: "numeric",
});
const dateLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Oct" in New York time. */
export function formatExchangeMonth(ms: number): string {
  return monthLabel.format(ms);
}

/** "2026" in New York time. */
export function formatExchangeYear(ms: number): string {
  return yearLabel.format(ms);
}

/** "Wed, Oct 14, 2026" in New York time (crosshair label for 1D…1Y). */
export function formatExchangeDate(ms: number): string {
  return dateLabel.format(ms);
}

const shortDateTimeLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const shortDateLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "2-digit",
});

/** Compact New York time for dense lists: "Oct 8, 09:10" (intraday) or "Oct 8, 26" (daily+). */
export function formatExchangeShort(ms: number, withTime: boolean): string {
  return (withTime ? shortDateTimeLabel : shortDateLabel).format(ms);
}

/** "14:30" in New York time. */
export function formatExchangeTime(ms: number): string {
  return timeLabel.format(ms);
}

/** "Oct 14" in New York time. */
export function formatExchangeDay(ms: number): string {
  return dayLabel.format(ms);
}

/** "Wed, Oct 14, 2026, 14:30" in New York time (crosshair label). */
export function formatExchangeDateTime(ms: number): string {
  return fullLabel.format(ms);
}
