// Keeps the chart looking at the same stretch of time when its candles are replaced (interval
// switch, history reload), instead of jumping back to a default zoom.

import type { Candle } from "./market";

/** A visible stretch of time, independent of candle size. */
export interface TimeWindow {
  /** Open time (epoch seconds) of the first visible candle. */
  from: number;
  /** End (epoch seconds, exclusive) of the last visible candle; null = following the latest. */
  toEnd: number | null;
}

/** Index of the last candle with `time <= t` (or `< t` when `strict`), -1 if none. */
function lastAtOrBefore(candles: readonly Candle[], t: number, strict: boolean): number {
  let lo = 0;
  let hi = candles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const time = candles[mid]?.time ?? Number.POSITIVE_INFINITY;
    if (strict ? time < t : time <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The time window behind a logical (bar-index) range on `candles`. A view reaching the latest
 * candle is recorded as following it, so the new chart keeps tracking live data.
 */
export function captureWindow(
  candles: readonly Candle[],
  logical: { from: number; to: number },
): TimeWindow | null {
  const count = candles.length;
  if (count === 0) return null;
  const clamp = (index: number) => Math.min(Math.max(index, 0), count - 1);
  const first = candles[clamp(Math.ceil(logical.from))];
  if (!first) return null;
  if (logical.to >= count - 1) return { from: first.time, toEnd: null };
  const lastIndex = clamp(Math.floor(logical.to));
  const after = candles[lastIndex + 1];
  return { from: first.time, toEnd: after ? after.time : null };
}

/**
 * The logical range showing `window` on new `candles` (another interval or a reload): the bucket
 * containing its start through the last candle that begins before its end. Too few candles
 * (zooming out to a coarser interval) widen leftwards to `minBars`. Null when the new candles
 * don't reach the window at all, so the caller falls back to its default view.
 */
export function windowToLogical(
  candles: readonly Candle[],
  window: TimeWindow,
  options: { minBars: number; rightOffset: number },
): { from: number; to: number } | null {
  const count = candles.length;
  const firstTime = candles[0]?.time;
  if (count === 0 || firstTime === undefined) return null;
  if (window.toEnd !== null && firstTime >= window.toEnd) return null;
  const toIndex = window.toEnd === null ? count - 1 : lastAtOrBefore(candles, window.toEnd, true);
  if (toIndex < 0) return null;
  let fromIndex = Math.max(lastAtOrBefore(candles, window.from, false), 0);
  if (toIndex - fromIndex + 1 < options.minBars) {
    fromIndex = Math.max(toIndex - options.minBars + 1, 0);
  }
  return {
    from: fromIndex - 0.5,
    to: window.toEnd === null ? count - 1 + options.rightOffset : toIndex + 0.5,
  };
}
