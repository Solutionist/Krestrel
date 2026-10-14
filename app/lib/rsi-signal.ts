// RSI overbought/oversold zones and the classic "leaves the zone" buy/sell signals (ADR 0014).
// A rule of thumb on momentum, not advice: the UI says so wherever a signal is shown.

import * as z from "zod";

import { bucketStart } from "./candles";
import type { IndicatorValue } from "./indicators";
import type { QuoteSnapshot } from "./market";

export const RSI_PERIOD = 14;

export const RsiLevelsSchema = z
  .object({
    overbought: z.number().int().min(55).max(95),
    oversold: z.number().int().min(5).max(45),
  })
  .refine((levels) => levels.oversold < levels.overbought);
export type RsiLevels = z.infer<typeof RsiLevelsSchema>;

export const DEFAULT_RSI_LEVELS: RsiLevels = { overbought: 70, oversold: 30 };

/**
 * - `oversold` / `overbought`: RSI is inside a zone (selling/buying may be overdone).
 * - `buy`: RSI rose back above the oversold level within the last few bars.
 * - `sell`: RSI fell back below the overbought level within the last few bars.
 */
export type RsiSignalKind = "buy" | "sell" | "oversold" | "overbought" | "neutral";

export interface RsiSignal {
  kind: RsiSignalKind;
  rsi: number;
  /** For buy/sell: bars since RSI left the zone (0 = this bar). */
  barsAgo: number | null;
}

/** How many bars a buy/sell signal stays "fresh" after the cross. */
export const SIGNAL_FRESH_BARS = 3;

export interface RsiCross {
  index: number;
  kind: "buy" | "sell";
}

/**
 * Bars where RSI leaves a zone: from ≤ oversold to above it (buy), or from ≥ overbought to below
 * it (sell). Gaps (null values) break a sequence.
 */
export function rsiCrosses(values: readonly IndicatorValue[], levels: RsiLevels): RsiCross[] {
  const crosses: RsiCross[] = [];
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous == null || current == null) continue;
    if (previous <= levels.oversold && current > levels.oversold)
      crosses.push({ index: i, kind: "buy" });
    else if (previous >= levels.overbought && current < levels.overbought) {
      crosses.push({ index: i, kind: "sell" });
    }
  }
  return crosses;
}

/** The signal at the latest RSI value; null until there is enough history for an RSI. */
export function rsiSignal(values: readonly IndicatorValue[], levels: RsiLevels): RsiSignal | null {
  const last = values.length - 1;
  const rsi = values[last];
  if (rsi == null) return null;
  if (rsi <= levels.oversold) return { kind: "oversold", rsi, barsAgo: null };
  if (rsi >= levels.overbought) return { kind: "overbought", rsi, barsAgo: null };
  // Most recent cross within the fresh window, if RSI has left a zone lately.
  for (let i = last; i >= Math.max(1, last - SIGNAL_FRESH_BARS + 1); i--) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous == null || current == null) break;
    if (previous <= levels.oversold && current > levels.oversold) {
      return { kind: "buy", rsi, barsAgo: last - i };
    }
    if (previous >= levels.overbought && current < levels.overbought) {
      return { kind: "sell", rsi, barsAgo: last - i };
    }
  }
  return { kind: "neutral", rsi, barsAgo: null };
}

export const SIGNAL_LABEL: Record<RsiSignalKind, string> = {
  buy: "Buy signal",
  sell: "Sell signal",
  oversold: "Oversold",
  overbought: "Overbought",
  neutral: "Neutral",
};

/** ▲ for buy-side states, ▼ for sell-side (colour is never the only cue). */
export const SIGNAL_GLYPH: Record<RsiSignalKind, string> = {
  buy: "▲",
  oversold: "▲",
  sell: "▼",
  overbought: "▼",
  neutral: "■",
};

/** One precise sentence on what the signal means. */
export function describeRsiSignal(signal: RsiSignal, levels: RsiLevels): string {
  const value = signal.rsi.toFixed(0);
  switch (signal.kind) {
    case "buy":
      return `RSI ${value} rose back above ${levels.oversold}: momentum turning up after being oversold.`;
    case "sell":
      return `RSI ${value} fell back below ${levels.overbought}: momentum turning down after being overbought.`;
    case "oversold":
      return `RSI ${value} ≤ ${levels.oversold}: selling may be overdone; a buy signal comes when RSI turns back up.`;
    case "overbought":
      return `RSI ${value} ≥ ${levels.overbought}: buying may be overdone; a sell signal comes when RSI turns back down.`;
    case "neutral":
      return `RSI ${value} between ${levels.oversold} and ${levels.overbought}: no signal.`;
  }
}

/**
 * Daily closes with the live price folded in: it replaces today's close, or starts today when
 * the history ends on an earlier day. Older ticks are ignored.
 */
export function liveCloses(
  closes: readonly number[],
  lastTime: number | null,
  quote: QuoteSnapshot | undefined,
): number[] {
  if (!quote || quote.lastPrice === null || quote.lastTs === null) return [...closes];
  const day = bucketStart(quote.lastTs, "1D");
  if (lastTime === null || day > lastTime) return [...closes, quote.lastPrice];
  if (day === lastTime) return [...closes.slice(0, -1), quote.lastPrice];
  return [...closes];
}

/** GET /api/signals: daily closes per watchlist symbol, oldest first. */
export const SignalsResponseSchema = z.object({
  series: z.record(
    z.string(),
    z.object({ closes: z.array(z.number()), lastTime: z.number().nullable() }),
  ),
});
export type SignalsResponse = z.infer<typeof SignalsResponseSchema>;
