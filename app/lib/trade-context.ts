// Facts about each hindsight trade's entry and exit candles (ADR 0012), shown in the insights
// panel and given to the LLM so its notes cite real numbers instead of adjectives.
import type { Analysis, Level, Trade } from "./analysis";
import { ema, rsi } from "./indicators";
import type { Candle } from "./market";

export interface PointContext {
  /** RSI(14) at the candle, or null with too little history. */
  rsi: number | null;
  /** Candle volume ÷ average of the previous 20 candles. */
  volumeRatio: number | null;
  /** Close relative to EMA 50, as a fraction (−0.03 = 3% below). */
  vsEma50: number | null;
  /** Nearest S/R level within 1.5% of the price, if any. */
  nearLevel: { id: string; distance: number } | null;
}

export interface TradeContext {
  tradeId: string;
  /** Candles held, entry to exit. */
  bars: number;
  buy: PointContext;
  sell: PointContext;
}

function nearestLevel(levels: readonly Level[], price: number): PointContext["nearLevel"] {
  let best: PointContext["nearLevel"] = null;
  for (const level of levels) {
    const distance = (price - level.price) / level.price;
    if (Math.abs(distance) <= 0.015 && (!best || Math.abs(distance) < Math.abs(best.distance))) {
      best = { id: level.id, distance };
    }
  }
  return best;
}

export function tradeContexts(candles: readonly Candle[], analysis: Analysis): TradeContext[] {
  const indexByTime = new Map(candles.map((candle, index) => [candle.time, index]));
  const closes = candles.map((candle) => candle.close);
  const rsiValues = rsi(closes, 14);
  const ema50 = ema(closes, 50);

  const pointAt = (time: number, price: number): PointContext => {
    const index = indexByTime.get(time);
    if (index === undefined)
      return { rsi: null, volumeRatio: null, vsEma50: null, nearLevel: null };
    const window = candles.slice(Math.max(0, index - 20), index);
    const average =
      window.length > 0 ? window.reduce((sum, c) => sum + c.volume, 0) / window.length : 0;
    const candle = candles[index];
    const trend = ema50[index];
    return {
      rsi: rsiValues[index] ?? null,
      volumeRatio: candle && average > 0 ? candle.volume / average : null,
      vsEma50: candle && trend != null ? candle.close / trend - 1 : null,
      nearLevel: nearestLevel(analysis.levels, price),
    };
  };

  return analysis.trades.map((trade: Trade) => ({
    tradeId: trade.id,
    bars: (indexByTime.get(trade.sell.time) ?? 0) - (indexByTime.get(trade.buy.time) ?? 0),
    buy: pointAt(trade.buy.time, trade.buy.price),
    sell: pointAt(trade.sell.time, trade.sell.price),
  }));
}

/** Compact one-line facts, e.g. "RSI 27 · vol 2.1× · 4.2% < EMA50 · at S1". */
export function describePoint(point: PointContext): string {
  const parts: string[] = [];
  if (point.rsi !== null) parts.push(`RSI ${Math.round(point.rsi)}`);
  if (point.volumeRatio !== null) parts.push(`vol ${point.volumeRatio.toFixed(1)}×`);
  if (point.vsEma50 !== null) {
    parts.push(
      `${Math.abs(point.vsEma50 * 100).toFixed(1)}% ${point.vsEma50 < 0 ? "<" : ">"} EMA50`,
    );
  }
  if (point.nearLevel) parts.push(`at ${point.nearLevel.id}`);
  return parts.join(" · ");
}
