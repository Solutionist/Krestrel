// Technical indicators computed from candles (client-side; pure). Conventions match TradingView's
// built-ins: EMA seeded with the SMA of its first window, Bollinger Bands with population
// standard deviation, RSI with Wilder's smoothing.

/** `null` until enough candles exist for the indicator. */
export type IndicatorValue = number | null;

export const INDICATORS = ["ema20", "ema50", "ema100", "bb", "rsi"] as const;
export type IndicatorId = (typeof INDICATORS)[number];

export const INDICATOR_LABELS: Record<IndicatorId, string> = {
  ema20: "EMA 20",
  ema50: "EMA 50",
  ema100: "EMA 100",
  bb: "BB 20 2",
  rsi: "RSI 14",
};

export const INDICATOR_NAMES: Record<IndicatorId, string> = {
  ema20: "20-period exponential moving average",
  ema50: "50-period exponential moving average",
  ema100: "100-period exponential moving average",
  bb: "Bollinger Bands (20 periods, 2 standard deviations)",
  rsi: "Relative Strength Index (14 periods)",
};

/** Exponential moving average; the first value is the simple average of the first `period`. */
export function ema(values: readonly number[], period: number): IndicatorValue[] {
  const out: IndicatorValue[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const alpha = 2 / (period + 1);
  let current = 0;
  for (let i = 0; i < period; i++) current += values[i] ?? 0;
  current /= period;
  out[period - 1] = current;
  for (let i = period; i < values.length; i++) {
    current = alpha * (values[i] ?? 0) + (1 - alpha) * current;
    out[i] = current;
  }
  return out;
}

export interface Bands {
  upper: IndicatorValue[];
  middle: IndicatorValue[];
  lower: IndicatorValue[];
}

/** Bollinger Bands: SMA(period) ± multiplier × population standard deviation. */
export function bollinger(values: readonly number[], period = 20, multiplier = 2): Bands {
  const empty = () => new Array<IndicatorValue>(values.length).fill(null);
  const bands: Bands = { upper: empty(), middle: empty(), lower: empty() };
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0;
    sum += value;
    sumSquares += value * value;
    if (i >= period) {
      const dropped = values[i - period] ?? 0;
      sum -= dropped;
      sumSquares -= dropped * dropped;
    }
    if (i >= period - 1) {
      const mean = sum / period;
      // Clamp tiny negative variance from floating-point cancellation.
      const deviation = Math.sqrt(Math.max(0, sumSquares / period - mean * mean));
      bands.middle[i] = mean;
      bands.upper[i] = mean + multiplier * deviation;
      bands.lower[i] = mean - multiplier * deviation;
    }
  }
  return bands;
}

/** Relative Strength Index with Wilder's smoothing (0–100). */
export function rsi(values: readonly number[], period = 14): IndicatorValue[] {
  const out: IndicatorValue[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = (values[i] ?? 0) - (values[i - 1] ?? 0);
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  gain /= period;
  loss /= period;
  const toRsi = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = toRsi();
  for (let i = period + 1; i < values.length; i++) {
    const change = (values[i] ?? 0) - (values[i - 1] ?? 0);
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = toRsi();
  }
  return out;
}
