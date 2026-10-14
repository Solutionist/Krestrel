import type { Candle } from "./market";

export interface RangeStats {
  /** Candles in the range, inclusive. */
  bars: number;
  /** Open time of the first and last candle (epoch seconds). */
  from: number;
  to: number;
  /** First candle's open → last candle's close. */
  change: number;
  changeFraction: number | null;
  high: number;
  low: number;
  volume: number;
}

/**
 * Summary of the candles between two (fractional, possibly out-of-range or reversed) logical
 * indices, as TradingView's date-range readout: null when the span holds no candles.
 */
export function rangeStats(candles: readonly Candle[], a: number, b: number): RangeStats | null {
  const start = Math.max(0, Math.round(Math.min(a, b)));
  const end = Math.min(candles.length - 1, Math.round(Math.max(a, b)));
  const first = candles[start];
  const last = candles[end];
  if (!first || !last || end < start) return null;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let volume = 0;
  for (let i = start; i <= end; i++) {
    const candle = candles[i];
    if (!candle) continue;
    high = Math.max(high, candle.high);
    low = Math.min(low, candle.low);
    volume += candle.volume;
  }
  const change = last.close - first.open;
  return {
    bars: end - start + 1,
    from: first.time,
    to: last.time,
    change,
    changeFraction: first.open === 0 ? null : change / first.open,
    high,
    low,
    volume,
  };
}
