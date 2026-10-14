// Hindsight chart analysis (ADR 0012), pure and deterministic: swing pivots, the best past
// buy→sell round trips, horizontal support/resistance, and a rising trend-support line.
// Descriptive only: it explains what already happened, it does not predict.
import type { Candle } from "./market";

export interface Pivot {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
  /** False for the last, still-forming swing (no reversal yet). */
  confirmed: boolean;
}

export interface Trade {
  id: string;
  buy: { time: number; price: number };
  sell: { time: number; price: number };
  /** Fractional return, e.g. 0.124 = +12.4%. */
  returnFraction: number;
}

export interface Level {
  id: string;
  kind: "support" | "resistance";
  price: number;
  /** Swing highs/lows within tolerance of this price. */
  touches: number;
  lastTouchTime: number;
}

export interface TrendLine {
  from: { time: number; price: number };
  to: { time: number; price: number };
  /** Price closed below the line after its second anchor. */
  broken: boolean;
}

export interface Analysis {
  /** Reversal size used for swings, as a fraction (e.g. 0.035 = 3.5%). */
  swingThreshold: number;
  pivots: Pivot[];
  trades: Trade[];
  levels: Level[];
  trendSupport: TrendLine | null;
}

/** Wilder's Average True Range at the last candle, or null with too little data. */
export function averageTrueRange(candles: readonly Candle[], period = 14): number | null {
  if (candles.length <= period) return null;
  const trueRange = (i: number): number => {
    const candle = candles[i];
    const previous = candles[i - 1];
    if (!candle) return 0;
    if (!previous) return candle.high - candle.low;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    );
  };
  let value = 0;
  for (let i = 1; i <= period; i++) value += trueRange(i);
  value /= period;
  for (let i = period + 1; i < candles.length; i++) {
    value = (value * (period - 1) + trueRange(i)) / period;
  }
  return value;
}

/**
 * ZigZag swing pivots: a swing high is confirmed once price falls `threshold` below it, a swing
 * low once price rises `threshold` above it. Pivots alternate high/low. The final extreme is
 * included unconfirmed so the latest move is visible.
 */
export function swingPivots(candles: readonly Candle[], threshold: number): Pivot[] {
  const pivots: Pivot[] = [];
  const first = candles[0];
  if (!first) return pivots;
  const at = (index: number, kind: Pivot["kind"], confirmed: boolean): Pivot => {
    const candle = candles[index] ?? first;
    return {
      index,
      time: candle.time,
      price: kind === "high" ? candle.high : candle.low,
      kind,
      confirmed,
    };
  };
  const high = (i: number) => candles[i]?.high ?? 0;
  const low = (i: number) => candles[i]?.low ?? 0;

  let direction: 0 | 1 | -1 = 0;
  let extreme = 0;
  let highest = 0;
  let lowest = 0;
  for (let i = 1; i < candles.length; i++) {
    if (direction === 0) {
      if (high(i) > high(highest)) highest = i;
      if (low(i) < low(lowest)) lowest = i;
      if (high(highest) >= low(lowest) * (1 + threshold)) {
        // The first move of `threshold` decides which extreme came first.
        if (highest > lowest) {
          pivots.push(at(lowest, "low", true));
          direction = 1;
          extreme = highest;
        } else {
          pivots.push(at(highest, "high", true));
          direction = -1;
          extreme = lowest;
        }
      }
    } else if (direction === 1) {
      if (high(i) >= high(extreme)) extreme = i;
      else if (low(i) <= high(extreme) * (1 - threshold)) {
        pivots.push(at(extreme, "high", true));
        direction = -1;
        extreme = i;
      }
    } else {
      if (low(i) <= low(extreme)) extreme = i;
      else if (high(i) >= low(extreme) * (1 + threshold)) {
        pivots.push(at(extreme, "low", true));
        direction = 1;
        extreme = i;
      }
    }
  }
  if (direction !== 0) pivots.push(at(extreme, direction === 1 ? "high" : "low", false));
  return pivots;
}

/**
 * The `maxTrades` non-overlapping long round trips (buy at a swing low, sell at a later swing
 * high) with the greatest combined log return: exact dynamic programming over the pivots.
 */
export function bestTrades(pivots: readonly Pivot[], maxTrades: number): Trade[] {
  const n = pivots.length;
  if (n < 2 || maxTrades <= 0) return [];
  const logPrice = pivots.map((pivot) => Math.log(pivot.price));
  // best[t][i]: best total using ≤ t trades among pivots[0..i]; choice[t][i] = buy index or -1.
  const best = Array.from({ length: maxTrades + 1 }, () => new Array<number>(n).fill(0));
  const choice = Array.from({ length: maxTrades + 1 }, () => new Array<number>(n).fill(-1));
  for (let t = 1; t <= maxTrades; t++) {
    const row = best[t] ?? [];
    const previous = best[t - 1] ?? [];
    const picks = choice[t] ?? [];
    for (let i = 1; i < n; i++) {
      row[i] = row[i - 1] ?? 0;
      if (pivots[i]?.kind !== "high") continue;
      for (let j = 0; j < i; j++) {
        if (pivots[j]?.kind !== "low") continue;
        const gain = (logPrice[i] ?? 0) - (logPrice[j] ?? 0);
        if (gain <= 0) continue;
        const total = (j > 0 ? (previous[j - 1] ?? 0) : 0) + gain;
        if (total > (row[i] ?? 0)) {
          row[i] = total;
          picks[i] = j;
        }
      }
    }
  }

  const trades: Trade[] = [];
  let t = maxTrades;
  let i = n - 1;
  while (t > 0 && i > 0) {
    const row = best[t] ?? [];
    if ((row[i] ?? 0) === (row[i - 1] ?? 0)) {
      i--;
      continue;
    }
    const j = choice[t]?.[i] ?? -1;
    const buy = pivots[j];
    const sell = pivots[i];
    if (j < 0 || !buy || !sell) break;
    trades.push({
      id: "",
      buy: { time: buy.time, price: buy.price },
      sell: { time: sell.time, price: sell.price },
      returnFraction: sell.price / buy.price - 1,
    });
    t--;
    i = j - 1;
  }
  return trades.reverse().map((trade, index) => ({ ...trade, id: `T${index + 1}` }));
}

/**
 * Horizontal support/resistance: swing pivots clustered within `tolerance` of each other, kept
 * when touched at least twice. Up to `perSide` levels below (support) and above (resistance)
 * the last close, strongest first (more touches, then more recent).
 */
export function supportResistance(
  pivots: readonly Pivot[],
  lastClose: number,
  tolerance: number,
  perSide = 3,
): Level[] {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: Pivot[][] = [];
  for (const pivot of sorted) {
    const cluster = clusters.at(-1);
    const mean = cluster ? cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length : 0;
    if (cluster && pivot.price - mean <= tolerance) cluster.push(pivot);
    else clusters.push([pivot]);
  }
  const candidates = clusters
    .filter((cluster) => cluster.length >= 2)
    .map((cluster) => ({
      price: cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length,
      touches: cluster.length,
      lastTouchTime: Math.max(...cluster.map((p) => p.time)),
    }));
  const strongest = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
    b.touches - a.touches || b.lastTouchTime - a.lastTouchTime;
  const pick = (kind: Level["kind"], prefix: string) =>
    candidates
      .filter((c) => (kind === "support" ? c.price < lastClose : c.price > lastClose))
      .sort(strongest)
      .slice(0, perSide)
      .sort((a, b) => Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose))
      .map((c, index): Level => ({ id: `${prefix}${index + 1}`, kind, ...c }));
  return [...pick("support", "S"), ...pick("resistance", "R")];
}

/**
 * Rising trend support through the last two confirmed swing lows (a higher low), extended to the
 * last candle. Null when the last two lows are not rising.
 */
export function trendSupport(
  candles: readonly Candle[],
  pivots: readonly Pivot[],
): TrendLine | null {
  const lows = pivots.filter((pivot) => pivot.kind === "low" && pivot.confirmed);
  const first = lows.at(-2);
  const second = lows.at(-1);
  const last = candles.at(-1);
  if (!first || !second || !last || second.price <= first.price) return null;
  // Straight in bar-index space, which is how the chart lays candles out (no gaps).
  const slope = (second.price - first.price) / (second.index - first.index);
  const valueAt = (index: number) => first.price + slope * (index - first.index);
  let broken = false;
  for (let i = second.index + 1; i < candles.length; i++) {
    if ((candles[i]?.close ?? Number.POSITIVE_INFINITY) < valueAt(i)) broken = true;
  }
  return {
    from: { time: first.time, price: first.price },
    to: { time: last.time, price: valueAt(candles.length - 1) },
    broken,
  };
}

/** Full analysis with a volatility-adapted swing size (≈ 3 ATR, between 1% and 25%). */
export function analyzeChart(candles: readonly Candle[], maxTrades = 3): Analysis {
  const last = candles.at(-1);
  if (!last || candles.length < 20) {
    return { swingThreshold: 0, pivots: [], trades: [], levels: [], trendSupport: null };
  }
  const atr = averageTrueRange(candles) ?? (last.high - last.low || last.close * 0.01);
  const swingThreshold = Math.min(0.25, Math.max(0.01, (3 * atr) / last.close));
  const pivots = swingPivots(candles, swingThreshold);
  return {
    swingThreshold,
    pivots,
    trades: bestTrades(pivots, maxTrades),
    levels: supportResistance(
      pivots.filter((pivot) => pivot.confirmed),
      last.close,
      Math.max(0.5 * atr, last.close * 0.004),
    ),
    trendSupport: trendSupport(candles, pivots),
  };
}
