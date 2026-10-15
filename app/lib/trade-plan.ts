// Forward-looking trade plan from the chart's own levels (ADR 0016). Rule-based and transparent:
// where a pullback buy would make sense (nearest support), where the idea is wrong (stop), and
// where to take profit (resistances). A plan, not a prediction or advice.

import * as z from "zod";

import { type Analysis, averageTrueRange } from "./analysis";
import { ema } from "./indicators";
import type { Candle } from "./market";

export const TREND_BIASES = ["uptrend", "sideways", "downtrend"] as const;
export type TrendBias = (typeof TREND_BIASES)[number];

const PricePointSchema = z.object({ price: z.number(), basis: z.string() });

export const TradePlanSchema = z.object({
  lastPrice: z.number(),
  bias: z.enum(TREND_BIASES),
  /** Where to buy on a pullback: around the nearest support (or the 20 EMA in an uptrend). */
  buyZone: z.object({ low: z.number(), high: z.number(), basis: z.string() }).nullable(),
  /** Exit if price closes below: the idea is wrong. */
  stop: PricePointSchema.nullable(),
  /** Take-profit levels above the price, nearest first (at most 2). */
  targets: z.array(PricePointSchema),
  /** First target's reward per unit of risk from the middle of the buy zone. */
  riskReward: z.number().nullable(),
  /** Average true range (14) of the analysed candles, the plan's unit of "noise". */
  atr: z.number(),
});
export type TradePlan = z.infer<typeof TradePlanSchema>;

/** How far the slow EMA must move over 10 candles to count as trending (fraction of price). */
const SLOPE_THRESHOLD = 0.004;
/** A lower support only serves as the stop when it is this close (in ATRs) below the zone. */
const STOP_REACH_ATR = 3;

function trendBias(closes: readonly number[], last: number): TrendBias {
  const period = closes.length >= 60 ? 50 : 20;
  const line = ema(closes, period);
  const now = line.at(-1);
  const before = line.at(-11);
  if (now == null || before == null) return "sideways";
  const slope = (now - before) / now;
  if (last > now && slope > SLOPE_THRESHOLD) return "uptrend";
  if (last < now && slope < -SLOPE_THRESHOLD) return "downtrend";
  return "sideways";
}

/**
 * Builds a plan from the analysed candles and their support/resistance levels. Null with too few
 * candles for an ATR. In a downtrend there is no buy zone (no catching falling knives), only the
 * levels where a bounce would stall.
 */
export function buildTradePlan(candles: readonly Candle[], analysis: Analysis): TradePlan | null {
  const atr = averageTrueRange(candles);
  const last = candles.at(-1)?.close;
  if (atr === null || last === undefined || atr <= 0) return null;
  const closes = candles.map((candle) => candle.close);
  const bias = trendBias(closes, last);

  const supports = analysis.levels
    .filter((level) => level.kind === "support" && level.price < last)
    .sort((a, b) => b.price - a.price);
  const resistances = analysis.levels
    .filter((level) => level.kind === "resistance" && level.price > last)
    .sort((a, b) => a.price - b.price);

  let buyZone: TradePlan["buyZone"] = null;
  const nearest = supports[0];
  if (bias !== "downtrend" && nearest) {
    buyZone = {
      low: nearest.price - 0.25 * atr,
      high: Math.min(last, nearest.price + 0.5 * atr),
      basis: `${nearest.id} support`,
    };
  } else if (bias === "uptrend") {
    const fast = ema(closes, 20).at(-1);
    if (fast != null && fast < last) {
      buyZone = {
        low: fast - 0.25 * atr,
        high: Math.min(last, fast + 0.25 * atr),
        basis: "20 EMA",
      };
    }
  }

  let stop: TradePlan["stop"] = null;
  if (buyZone) {
    const zoneLow = buyZone.low;
    const below = supports.find((level) => level.price < zoneLow);
    stop =
      below && zoneLow - below.price <= STOP_REACH_ATR * atr
        ? { price: below.price - 0.25 * atr, basis: `below ${below.id}` }
        : { price: zoneLow - atr, basis: "1 ATR below the zone" };
  }

  const targets: TradePlan["targets"] = resistances
    .slice(0, 2)
    .map((level) => ({ price: level.price, basis: `${level.id} resistance` }));
  if (targets.length === 0) {
    const high = Math.max(...candles.map((candle) => candle.high));
    if (high > last * 1.001) targets.push({ price: high, basis: "period high" });
  }

  const mid = buyZone ? (buyZone.low + buyZone.high) / 2 : null;
  const first = targets[0];
  const riskReward =
    mid !== null && stop && first && mid > stop.price && first.price > mid
      ? (first.price - mid) / (mid - stop.price)
      : null;

  return { lastPrice: last, bias, buyZone, stop, targets, riskReward, atr };
}
