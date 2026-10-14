// New York wall-clock helpers for the mock provider. US exchange holidays and early closes are
// ignored on purpose: the mock only needs plausible sessions, not an exchange calendar.
import type { MarketClock } from "~/lib/market";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const PRE_OPEN_MIN = 4 * 60;
export const OPEN_MIN = 9 * 60 + 30;
export const CLOSE_MIN = 16 * 60;
export const POST_CLOSE_MIN = 20 * 60;

const nyFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

// NY's UTC offset only changes on whole UTC hours, so one Intl call per hour is enough.
const offsetCache = new Map<number, number>();

/** Milliseconds to add to a UTC epoch to get New York wall-clock time expressed as UTC. */
export function nyOffsetMs(epochMs: number): number {
  const hourKey = Math.floor(epochMs / HOUR_MS);
  const cached = offsetCache.get(hourKey);
  if (cached !== undefined) return cached;
  const probe = hourKey * HOUR_MS;
  const parts: Record<string, number> = {};
  for (const part of nyFormat.formatToParts(probe)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  const offset = wall - probe;
  if (offsetCache.size > 50_000) offsetCache.clear();
  offsetCache.set(hourKey, offset);
  return offset;
}

export interface NyWallTime {
  /** Wall-clock time encoded as if it were UTC; use getUTC* on it. */
  wallMs: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes since NY midnight. */
  minuteOfDay: number;
}

export function nyWallTime(epochMs: number): NyWallTime {
  const wallMs = epochMs + nyOffsetMs(epochMs);
  return {
    wallMs,
    weekday: new Date(wallMs).getUTCDay(),
    minuteOfDay: Math.floor((((wallMs % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS),
  };
}

/** Converts a NY wall-clock time (encoded as UTC ms) to a real epoch. Valid outside the DST gap. */
export function nyWallToEpoch(wallMs: number): number {
  let epoch = wallMs - nyOffsetMs(wallMs);
  epoch = wallMs - nyOffsetMs(epoch);
  return epoch;
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

/** True when the minute starting at `epochMs` lies in 04:00–20:00 NY on a weekday. */
export function isExtendedHoursMinute(epochMs: number): boolean {
  const { weekday, minuteOfDay } = nyWallTime(epochMs);
  return isWeekday(weekday) && minuteOfDay >= PRE_OPEN_MIN && minuteOfDay < POST_CLOSE_MIN;
}

/** NY wall-clock midnight (encoded as UTC ms) of the day containing `epochMs`. */
function nyMidnightWall(epochMs: number): number {
  const { wallMs } = nyWallTime(epochMs);
  return wallMs - (((wallMs % DAY_MS) + DAY_MS) % DAY_MS);
}

/** First weekday time strictly after `epochMs` whose NY wall clock is `minuteOfDay`. */
function nextWeekdayAt(epochMs: number, minuteOfDay: number): number {
  const midnight = nyMidnightWall(epochMs);
  for (let day = 0; day < 8; day++) {
    const wall = midnight + day * DAY_MS + minuteOfDay * MINUTE_MS;
    if (!isWeekday(new Date(wall).getUTCDay())) continue;
    const epoch = nyWallToEpoch(wall);
    if (epoch > epochMs) return epoch;
  }
  throw new Error("unreachable: a weekday occurs within 8 days");
}

/** Epoch of the regular-session close (16:00 NY) on the last weekday before today's NY date. */
export function previousWeekdayClose(epochMs: number): number {
  const midnight = nyMidnightWall(epochMs);
  for (let day = 1; day < 8; day++) {
    const wall = midnight - day * DAY_MS;
    if (isWeekday(new Date(wall).getUTCDay())) return nyWallToEpoch(wall + CLOSE_MIN * MINUTE_MS);
  }
  throw new Error("unreachable: a weekday occurs within 8 days");
}

export function marketClock(epochMs: number): MarketClock {
  const { weekday, minuteOfDay } = nyWallTime(epochMs);
  const nextOpen = nextWeekdayAt(epochMs, OPEN_MIN);
  const nextClose = nextWeekdayAt(epochMs, CLOSE_MIN);
  if (!isWeekday(weekday) || minuteOfDay < PRE_OPEN_MIN || minuteOfDay >= POST_CLOSE_MIN) {
    return {
      phase: "closed",
      phaseUntil: nextWeekdayAt(epochMs, PRE_OPEN_MIN),
      nextOpen,
      nextClose,
    };
  }
  if (minuteOfDay < OPEN_MIN) return { phase: "pre", phaseUntil: nextOpen, nextOpen, nextClose };
  if (minuteOfDay < CLOSE_MIN) return { phase: "open", phaseUntil: nextClose, nextOpen, nextClose };
  return {
    phase: "post",
    phaseUntil: nextWeekdayAt(epochMs, POST_CLOSE_MIN),
    nextOpen,
    nextClose,
  };
}
